import { Term } from "@rdfjs/types";
import { Member } from "./page";
import { FetchedPage } from "./pageFetcher";
import { State } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { TREE } from "@treecg/types";
import Heap from "heap-js";
import { LDESInfo } from "./client";
import debug from "debug";

const log = debug("manager");

export interface Options {
  ldesId?: Term;
  shapeId?: Term;
  callback?: (member: Member) => void;
  extractor?: CBDShapeExtractor;
}

export type ExtractedMember = {
  member: Member;
};

export class Manager {
  private members: Heap<Member>;
  public queued: number = 0;
  private resolve?: () => void;
  private callback: (member: Member) => void;
  private ldesId: Term;

  private currentPromises: Promise<void>[] = [];

  private state: State;
  private extractor: CBDShapeExtractor;
  private shapeId?: Term;

  private timestampPath?: Term;
  private isVersionOfPath?: Term;

  constructor(
    ldesId: Term,
    state: State,
    callback: (member: Member) => void,
    info: LDESInfo,
  ) {
    const logger = log.extend("constructor");
    this.callback = callback;
    this.ldesId = ldesId;
    this.state = state;
    this.extractor = info.extractor;
    this.timestampPath = info.timestampPath;
    this.isVersionOfPath = info.isVersionOfPath;
    this.shapeId = info.shape;

    logger("new %s %o", ldesId.value, info);

    this.members = new Heap((a, b) => {
      if (a.id.equals(b.id)) return 0;
      if (a.timestamp == b.timestamp) return 0;
      if (!a && b) return 1;
      if (a && !b) return -1;
      if (a.timestamp! < b.timestamp!) return -1;
      return 1;
    });
  }

  // Extract members found in this page, this does not yet emit the members
  extractMembers(page: FetchedPage, ordered: boolean) {
    const logger = log.extend("extract");

    const members = page.data.getObjects(this.ldesId, TREE.terms.member, null);

    const extractMember = async (member: Term) => {
      const quads = await this.extractor.extract(
        page.data,
        member,
        this.shapeId,
      );

      if (this.state.seen(member.value)) {
        return;
      }
      this.state.add(member.value);

      // Get timestamp
      let timestamp: string | undefined;
      if (this.timestampPath) {
        timestamp = quads.find(
          (x) =>
            x.subject.equals(member) && x.predicate.equals(this.timestampPath),
        )?.object.value;
      }

      let isVersionOf: string | undefined;
      if (this.isVersionOfPath) {
        isVersionOf = quads.find(
          (x) =>
            x.subject.equals(member) &&
            x.predicate.equals(this.isVersionOfPath),
        )?.object.value;
      }

      this.members.push({ id: member, quads, timestamp, isVersionOf });

      if (!ordered) this.emitAll();
    };

    logger("%d members", members.length);

    for (let member of members) {
      if (!this.state.seen(member.value)) {
        this.queued += 1;
        if (ordered) {
          this.currentPromises.push(extractMember(member));
        } else {
          extractMember(member);
        }
      }
    }

    logger("%d queued %d promises", this.queued, this.currentPromises.length);
  }

  // Wait for the current bunch of members to be extracted
  async marker(value: any, ordered: boolean) {
    const logger = log.extend("marker");
    if (!ordered) {
      logger("not ordered, no need for marker");
      return;
    }

    logger("value %o", value);

    const promises = this.currentPromises;
    this.currentPromises = [];
    logger("Awaiting %d promises", promises.length);
    await Promise.all(promises);
    logger("succesful");

    let head = this.members.pop();
    while (head) {
      // Potentially this member is not yet ready
      if (!head.timestamp) {
        logger("Emitting member without timestamp!");
        this.emit(head);
      } else if (head.timestamp < value) {
        this.emit(head);
      }
    }
    if (head) this.members.push(head);
  }

  emitAll() {
    const logger = log.extend("emitAll");
    logger("Emitting %d members", this.members.length);

    let head = this.members.pop();
    while (head) {
      this.emit(head);
      head = this.members.pop();
    }
  }

  /// Get a promsie that resolves when a member is submitted
  /// Only listen to this promise if a member is queued
  reset(): Promise<void> {
    const logger = log.extend("reset");
    logger("Resetting with %d members in queue", this.queued);

    this.queued = 0;
    return new Promise((res) => (this.resolve = res));
  }

  private emit(member: Member) {
    if (this.callback) {
      this.callback(member);
    }
    if (this.resolve) {
      this.resolve();
      this.resolve = undefined;
    }
  }
}
