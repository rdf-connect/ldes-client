import { Term } from "@rdfjs/types";
import { Member } from "./page";
import { FetchedPage } from "./pageFetcher";
import { State } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { TREE } from "@treecg/types";
import Heap from "heap-js";
import { LDESInfo } from "./client";
import debug from "debug";
import { Store } from "n3";
import { Notifier } from "./utils";

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

export type MemberEvents = {
  extracted: Member;
  done: Member[];
};

export class Manager {
  private members: Heap<Member>;
  public queued: number = 0;
  private resolve?: () => void;
  private ldesId: Term;

  private currentPromises: Promise<void>[] = [];

  private state: State;
  private extractor: CBDShapeExtractor;
  private shapeId?: Term;

  private timestampPath?: Term;
  private isVersionOfPath?: Term;

  constructor(ldesId: Term, state: State, info: LDESInfo) {
    const logger = log.extend("constructor");
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

  async close() {
    log("Closing");
    await Promise.all(this.currentPromises);
    if (this.resolve) {
      this.resolve();
      this.resolve = undefined;
    }
    log("this.resolve()");
  }

  private async extractMember(
    member: Term,
    data: Store,
  ): Promise<Member | undefined> {
    const quads = await this.extractor.extract(data, member, this.shapeId);

    if (this.state.seen(member.value)) {
      return;
    }
    this.state.add(member.value);

    // Get timestamp
    let timestamp: Date | string | undefined;
    if (this.timestampPath) {
      const ts = quads.find(
        (x) =>
          x.subject.equals(member) && x.predicate.equals(this.timestampPath),
      )?.object.value;
      if (ts) {
        try {
          timestamp = new Date(ts);
        } catch (ex: any) {
          timestamp = ts;
        }
      }
    }

    let isVersionOf: string | undefined;
    if (this.isVersionOfPath) {
      isVersionOf = quads.find(
        (x) =>
          x.subject.equals(member) && x.predicate.equals(this.isVersionOfPath),
      )?.object.value;
    }

    this.members.push({ id: member, quads, timestamp, isVersionOf });
    return { id: member, quads, timestamp, isVersionOf };
  }

  // Extract members found in this page, this does not yet emit the members
  extractMembers<S>(
    page: FetchedPage,
    state: S,
    notifier: Notifier<MemberEvents, S>,
  ) {
    const logger = log.extend("extract");
    const members = page.data.getObjects(this.ldesId, TREE.terms.member, null);

    logger("%d members", members.length);

    const promises: Promise<Member | undefined>[] = [];

    for (let member of members) {
      if (!this.state.seen(member.value)) {
        const promise = this.extractMember(member, page.data).then((member) => {
          if (member) {
            notifier.extracted(member, state);
          }
          return member;
        });

        promises.push(promise);
      }
    }

    Promise.all(promises).then((members) => {
      logger("All members extracted");
      notifier.done(
        members.flatMap((x) => (x ? [x] : [])),
        state,
      );
    });
  }

  /// Get a promsie that resolves when a member is submitted
  /// Only listen to this promise if a member is queued
  reset(): Promise<void> {
    const logger = log.extend("reset");
    logger("Resetting with %d members in queue", this.queued);

    this.queued = 0;
    return new Promise((res) => (this.resolve = res));
  }
}
