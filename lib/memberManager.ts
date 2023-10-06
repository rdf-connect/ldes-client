import { Term } from "@rdfjs/types";
import { Member } from "./page";
import { FetchedPage } from "./pageFetcher";
import { State } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { TREE } from "@treecg/types";
import * as N3 from "n3";

export interface Options {
  ldesId?: Term;
  shapeId?: Term;
  callback?: (member: Member) => void;
}

export class Manager {
  public queued: number = 0;
  private resolve?: () => void;
  private callback?: (member: Member) => void;
  private ldesId: Term;

  private state: State;
  private extractor: CBDShapeExtractor;
  private shapeId?: Term;

  constructor(ldesId: Term, state: State, extractor: CBDShapeExtractor) {
    this.ldesId = ldesId;
    this.state = state;
    this.extractor = extractor;
  }

  setOptions(options: Partial<Options>) {
    if(options.callback) {
      this.callback = options.callback;
    }
    if(options.shapeId) {
      this.shapeId = options.shapeId;
    }
    if(options.ldesId) {
      this.ldesId = options.ldesId;
    }
  }

  extractMembers(page: FetchedPage) {
    const members = page.data.getObjects(this.ldesId, TREE.terms.member, null);

    const extractMember = async (member: Term) => {
      this.state.add(member.value);
      const quads = await this.extractor.extract(
        page.data,
        <N3.Term>member,
        <N3.Term>this.shapeId,
      );
      this.memberFound({ id: member, quads });
    };

    const out = [];
    for (let member of members) {
      if (!this.state.seen(member.value)) {
        this.state.add(member.value);
        this.queued += 1;
        out.push(extractMember(member));
      }
    }
  }

  /// Get a promsie that resolves when a member is submitted
  /// Only listen to this promise if a member is queued
  reset(): Promise<void> {
    this.queued = 0;
    return new Promise((res) => (this.resolve = res));
  }

  private memberFound(member: Member) {
    if (this.callback) {
      this.callback(member);
    }
    if (this.resolve) {
      this.resolve();
      this.resolve = undefined;
    }
  }
}
