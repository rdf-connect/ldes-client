import { RdfDereferencer } from "rdf-dereference";
import { streamToArray } from "./utils";
import { State } from "./state";
import { DataFactory, Store } from "n3";
import { extractRelations, Relation } from "./page";
import { ReadableWebToNodeStream } from "readable-web-to-node-stream";
import { Heap } from "heap-js";
import rdfParser from "rdf-parse";

const { namedNode } = DataFactory;

export type SimpleRelation = {
  important: boolean;
  value: any;
};

// This relation chian is important to better understand the order of fragments to fetch
// First fetch all not important relations
// Then fetch an important relation with the smallest value (for timestamp path)
// This new relation can access other unimportant relations, but these should only be fetched after full unimportant relation chains
export class RelationChain {
  relations: SimpleRelation[];
  readonly target: string;
  private cmp?: (a: any, b: any) => number;

  constructor(
    target: string,
    relations: SimpleRelation[] = [],
    additional?: SimpleRelation,
    cmp?: (a: any, b: any) => number,
  ) {
    this.target = target;
    this.cmp = cmp;
    this.relations = relations.slice();
    if (additional) {
      this.relations.push(additional);
      while (this.relations.length >= 2) {
        // Second to last element
        const a = this.relations[this.relations.length - 2];
        // Last element
        const b = this.relations[this.relations.length - 1];

        if (a.important && !b.important) {
          break; // This cannot be compacted
        }
        // A and B are important, compact on value
        if (a.important) {
          const va = a.value;
          const vb = b.value;
          if (this.cmp) {
            if (this.cmp(va, vb) > 0) {
              a.value = b.value;
            }
          } else {
            a.value = va < vb ? va : vb;
          }
        } else {
          // a is not important, so we can just take b values
          a.important = b.important;
          a.value = b.value;
        }

        this.relations.pop();
      }
    }
  }

  push(target: string, relation: SimpleRelation): RelationChain {
    return new RelationChain(target, this.relations, relation, this.cmp);
  }

  /**
   * If the returned number is less than 0, it indicates that the first item should come before the second item in the sorted order.
   * If the returned number is greater than 0, it indicates that the first item should come after the second item in the sorted order.
   * If the returned number is equal to 0, it means that the two items are considered equivalent in terms of sorting order.
   */
  ordering(other: RelationChain): number {
    const la = this.relations.length;
    const lb = other.relations.length;
    for (let i = 0; i < Math.min(la, lb); i++) {
      if (!this.relations[i].important && !other.relations[i].important) {
        return 0;
      }
      if (!this.relations[i].important) return -1;
      if (!other.relations[i].important) return 1;

      // Both are important
      if (this.cmp) {
        const v = this.cmp(this.relations[i].value, other.relations[i].value);
        if (v !== 0) return v;
      } else {
        if (this.relations[i].value < other.relations[i].value) return -1;
        if (this.relations[i].value > other.relations[i].value) return 1;
      }
    }

    return 0;
  }
}

export type TimeBound = {
  open_relations: number;
  time?: Date;
};

export type FetchedPage = {
  url: string;
  data: Store;
};

// At most concurrentRequests + maxFetched pages will be stored in memory
// First maxFetched can be ready, but already concurrentRequests are sent out
export type FetcherConfig = {
  concurrentRequests: number;
  maxFetched: number;
};

export const DefaultFetcherConfig: FetcherConfig = {
  concurrentRequests: 10,
  maxFetched: 10,
};

type LongPromise = {
  waiting: Promise<void>;
  callback: () => void;
};

function longPromise(): LongPromise {
  const out = {} as LongPromise;
  out.waiting = new Promise((res) => (out.callback = res));
  return out;
}

function resetPromise(promise: LongPromise) {
  const cb = promise.callback;
  promise.waiting = new Promise((res) => (promise.callback = res));
  cb();
}

type PageAndRelation = {
  page: FetchedPage;
  relation: RelationChain;
};

export interface Helper {
  extractRelation(relation: Relation): { rel: SimpleRelation; node: string };
  handleFetchedPage(page: FetchedPage, marker?: any): void | Promise<void>;
}

export class Fetcher {
  private dereferencer: RdfDereferencer;

  private readyPages: Heap<PageAndRelation>;
  private inFlight = 0;

  private state: State;

  private toFetchHeap: Heap<RelationChain>;
  private inFlightHeap: Heap<RelationChain>;
  private readonly config: FetcherConfig;

  private pageFetched: LongPromise;
  private pageUsed: LongPromise;

  private helper: Helper;

  public bound: TimeBound;

  constructor(
    dereferencer: RdfDereferencer,
    state: State,
    helper: Helper,
    config = DefaultFetcherConfig,
  ) {
    this.helper = helper;
    this.bound = {
      open_relations: 1,
    };
    this.dereferencer = dereferencer;
    this.state = state;

    this.toFetchHeap = new Heap((a, b) => a.ordering(b));
    this.inFlightHeap = new Heap((a, b) => a.ordering(b));
    this.readyPages = new Heap((a, b) => a.relation.ordering(b.relation));

    this.config = config;

    this.pageFetched = longPromise();
    this.pageUsed = longPromise();
  }

  private async fetched(relation: RelationChain, page: FetchedPage) {
    console.log(
      "Fetched",
      relation.target,
      this.inFlight,
      this.config.concurrentRequests,
    );
    this.readyPages.add({ relation, page });
    resetPromise(this.pageFetched);

    while (this.inFlight < this.config.concurrentRequests) {
      const item = this.toFetchHeap.pop();
      if (item) {
        console.log("Maybe fetch", item.target);
        if (!this.state.seen(item.target)) {
          console.log("Fetch", item.target);
          this.state.add(item.target);
          this.inFlight += 1;
          this._fetchPage(item);
        }
      }
    }

    let a = this.readyPages.pop();
    let b = this.inFlightHeap.pop();

    while (a && b && a.relation.ordering(b) === 0) {
      // This page is actaully and can be activated

      // Try to find a marker
      let marker = undefined;
      if (a.relation.relations[0]?.important) {
        marker = a.relation.relations[0].value;
      }
      await this.helper.handleFetchedPage(a.page, marker);

      a = this.readyPages.pop();
      b = this.inFlightHeap.pop();
    }

    if (a && b) {
      this.readyPages.push(a);
      this.inFlightHeap.push(b);
    }
  }

  start(url: string, cmp: (a: any, b: any) => number) {
    const rel = new RelationChain(url, [], undefined, cmp);
    this._fetchPage(rel);
    this.inFlight = 1;
  }

  private async _fetchPage(relation: RelationChain) {
    console.log("_fetchPage");
    this.inFlightHeap.push(relation);
    console.log(
      "_fetchPage: gonna dereference",
      relation.target,
      encodeURI(relation.target),
    );

    const resp = await fetch(relation.target, {
      referrerPolicy: "no-referrer",
      referrer: "http://example.com/ldes-client",
      cache: "reload",
    });
    const url = resp.url;
    console.log("_fetchPage: gonna dereferenced");

    if (resp.ok) {
      const page = await streamToArray(
        rdfParser.parse(new ReadableWebToNodeStream(resp.body!), {
          baseIRI: relation.target,
          contentType: resp.headers.get("Content-Type") || "text/turtle",
        }),
      );
      // const resp = await this.dereferencer.dereference(relation.target);
      // const url = resp.url;
      console.log("Got resp");
      // const page = await streamToArray(resp.data);
      const data = new Store(page);
      console.log("Got data", page.length, "quads");

      for (let rel of extractRelations(data, namedNode(relation.target))) {
        const target = this.helper.extractRelation(rel);
        const chain = relation.push(target.node, target.rel);
        console.log("Adding toFetchHeap", chain.target);
        this.toFetchHeap.push(chain);
      }

      if (url !== relation.target) {
        for (let rel of extractRelations(data, namedNode(url))) {
          const target = this.helper.extractRelation(rel);
          const chain = relation.push(target.node, target.rel);
          console.log("Adding toFetchHeap", chain.target);
          this.toFetchHeap.push(chain);
        }
      }
      this.inFlight -= 1;
      await this.fetched(relation, { data, url });
    } else {
      this.inFlight -= 1;
    }
  }

  // /// Get a page that is ready
  // async getPage(): Promise<FetchedPage> {
  //   if (this.readyPages.length > 0) {
  //     const out = this.readyPages.pop()!;
  //     resetPromise(this.pageUsed);
  //     return out.page;
  //   }
  //
  //   await this.pageFetched.waiting;
  //
  //   return this.getPage();
  // }
}
