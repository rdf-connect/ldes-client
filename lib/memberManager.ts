import { Quad, Term } from "@rdfjs/types";
import { Member } from "./page";
import { FetchedPage } from "./pageFetcher";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { RDF, TREE } from "@treecg/types";
import { LDESInfo } from "./client";
import debug from "debug";
import { getObjects, Notifier } from "./utils";
import { RdfStore } from "rdf-stores";

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

export type ExtractError = {
  type: "extract";
  memberId: Term;
  error: any;
};
export type Error = ExtractError;
export type MemberEvents = {
  extracted: Member;
  done: Member[];
  error: Error;
};

export class Manager {
  public queued: number = 0;

  private closed = false;
  private resolve?: () => void;
  private ldesId: Term;

  private state: Set<string>;
  private extractor: CBDShapeExtractor;
  private shapeId?: Term;

  private timestampPath?: Term;
  private isVersionOfPath?: Term;

  constructor(ldesId: Term, state: Set<string>, info: LDESInfo) {
    const logger = log.extend("constructor");
    this.ldesId = ldesId;
    this.state = state;
    this.extractor = info.extractor;
    this.timestampPath = info.timestampPath;
    this.isVersionOfPath = info.isVersionOfPath;
    this.shapeId = info.shape;

    logger("new %s %o", ldesId.value, info);
  }

  // Extract members found in this page, this does not yet emit the members
  extractMembers<S>(
    page: FetchedPage,
    state: S,
    notifier: Notifier<MemberEvents, S>,
  ) {
    const logger = log.extend("extract");
    const members = getObjects(page.data, this.ldesId, TREE.terms.member, null);

    logger("%d members", members.length);

    const promises: Promise<Member | undefined | void>[] = [];

    for (let member of members) {
      if (!this.state.has(member.value)) {
        const promise = this.extractMember(member, page.data)
          .then((member) => {
            if (member) {
              if (!this.closed) {
                notifier.extracted(member, state);
              }
            }
            return member;
          })
          .catch((ex) => {
            logger("Error %o", ex);
            notifier.error(
              { error: ex, type: "extract", memberId: member },
              state,
            );
          });

        promises.push(promise);
      }
    }

    Promise.all(promises).then((members) => {
      logger("All members extracted");
      if (!this.closed) {
        notifier.done(
          members.flatMap((x) => (x ? [x] : [])),
          state,
        );
      }
    });
  }

  close() {
    log("Closing");
    if (this.resolve) {
      this.resolve();
      this.resolve = undefined;
    }
    this.closed = true;
    log("this.resolve()");
  }

  length(): number {
    return this.state.size;
  }

  private async extractMemberQuads(
    member: Term,
    data: RdfStore,
  ): Promise<Quad[]> {
    return await this.extractor.extract(data, member, this.shapeId);
  }

  private async extractMember(
    member: Term,
    data: RdfStore,
  ): Promise<Member | undefined> {
    const quads: Quad[] = await this.extractMemberQuads(member, data);

    // let the extractor do it's thing
    return await this.extractor.extract(data, member);
  }

  private async extractMember(
    member: Term,
    data: RdfStore,
  ): Promise<Member | undefined> {
    const quads: Quad[] = await this.extractMemberQuads(member, data);

    if (this.state.has(member.value)) {
      return;
    }

    if (quads.length > 0) {
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
            x.subject.equals(member) &&
            x.predicate.equals(this.isVersionOfPath),
        )?.object.value;
      }

      return { id: member, quads, timestamp, isVersionOf };
    }
  }

  /// Only listen to this promise if a member is queued
  reset(): Promise<void> {
    const logger = log.extend("reset");
    logger("Resetting with %d members in queue", this.queued);

    this.queued = 0;
    return new Promise((res) => (this.resolve = res));
  }
}
