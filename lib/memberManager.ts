import { Term, Quad } from "@rdfjs/types";
import { Member } from "./page";
import { FetchedPage } from "./pageFetcher";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { LDES, RDF, TREE } from "@treecg/types";
import Heap from "heap-js";
import { LDESInfo } from "./client";
import debug from "debug";
import { Notifier } from "./utils";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "n3";

const { namedNode } = DataFactory;

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
const getObjects = function (store: RdfStore, subject: Term | null, predicate: Term | null, graph?: Term | null) {
  return store.getQuads(subject, predicate, null, graph).map((quad) => {
    return quad.object;
  });
}
export class Manager {
  private members: Heap<Member>;
  public queued: number = 0;
  private resolve?: () => void;
  private ldesId: Term;

  private currentPromises: Promise<void>[] = [];

  private state: Set<string>;
  private extractor: CBDShapeExtractor;
  private shapeMap?: Map<string, Term>;

  private timestampPath?: Term;
  private isVersionOfPath?: Term;

  constructor(ldesId: Term, state: Set<string>, info: LDESInfo) {
    const logger = log.extend("constructor");
    this.ldesId = ldesId;
    this.state = state;
    this.extractor = info.extractor;
    this.timestampPath = info.timestampPath;
    this.isVersionOfPath = info.isVersionOfPath;
    this.shapeMap = info.shapeMap;

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

  length(): number {
    return this.state.size;
  }

  private async extractMember(
    member: Term,
    data: RdfStore,
  ): Promise<Member | undefined> {

    let quads: Quad[] = [];

    if (this.shapeMap) {
      if (this.shapeMap.size === 1) {
        // Use the only shape available
        quads = await this.extractor.extract(data, member, Array.from(this.shapeMap.values())[0]);
      } else if (this.shapeMap.size > 1) {
        // Find what is the proper shape for this member based on its rdf:type
        const memberType = getObjects(data, member, RDF.terms.type)[0];
        if (memberType) {
          const shapeId = this.shapeMap.get(memberType.value);
          if (shapeId) {
            quads = await this.extractor.extract(data, member, shapeId);
          }
        } else {
          // There is no rdf:type defined for this member. Fallback to CBD extraction
          quads = await this.extractor.extract(data, member);
        }
      } else {
        // Do a simple CBD extraction
        quads = await this.extractor.extract(data, member);
      }
    } else {
      // Do a simple CBD extraction
      quads = await this.extractor.extract(data, member);
    }

    if (quads.length > 0) {
      if (this.state.has(member.value)) {
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

      // Get canonical identifier of this member
      let isVersionOf: Term | undefined;
      if (this.isVersionOfPath) {
        isVersionOf = quads.find(
          (x) =>
            x.subject.equals(member) && x.predicate.equals(this.isVersionOfPath),
        )?.object;
      }

      // This needs to be revised based on what is set on the spec
      const isLastOfTransaction = quads.find(
        (x) =>
          x.subject.equals(member) && x.predicate.equals(namedNode(LDES.custom("isLastOfTransaction")))
      )?.object.value === "true";


      this.members.push({ id: member, quads, timestamp, isVersionOf: isVersionOf ? isVersionOf.value : undefined });
      return {
        id: member,
        quads,
        timestamp,
        isVersionOf: isVersionOf ? isVersionOf.value : undefined,
        isLastOfTransaction
      };
    }
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

    const promises: Promise<Member | undefined>[] = [];

    for (let member of members) {
      if (!this.state.has(member.value)) {
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
