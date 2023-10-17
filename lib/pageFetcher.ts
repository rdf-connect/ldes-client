import { RdfDereferencer } from "rdf-dereference";
import { streamToArray } from "./utils";
import { State } from "./state";
import { DataFactory, Store } from "n3";
import { extractRelations, Relation } from "./page";

import { Comparator, Heap } from "heap-js";

const { namedNode } = DataFactory;

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
  relation: Relation;
};

export class Fetcher {
  private dereferencer: RdfDereferencer;

  private readyPages: Heap<PageAndRelation>;
  private inFlight = 0;

  private state: State;

  private heap: Heap<Relation>;
  private readonly config: FetcherConfig;

  private pageFetched: LongPromise;
  private pageUsed: LongPromise;

  constructor(
    dereferencer: RdfDereferencer,
    state: State,
    config = DefaultFetcherConfig,
    comp?: Comparator<Relation>,
  ) {
    this.dereferencer = dereferencer;
    this.state = state;
    this.heap = new Heap(comp);
    const compPage = comp
      ? (a: PageAndRelation, b: PageAndRelation) => comp(a.relation, b.relation)
      : undefined;
    this.readyPages = new Heap(compPage);
    this.config = config;

    this.pageFetched = longPromise();
    this.pageUsed = longPromise();
  }

  private fetched(relation: Relation, page: FetchedPage) {
    this.readyPages.add({ relation, page });
    resetPromise(this.pageFetched);

    while (this.inFlight < this.config.concurrentRequests) {
      const item = this.heap.pop();
      if (item) {
        if (!this.state.seen(item.node)) {
          this.state.add(item.node);
          this.inFlight += 1;
          this._fetchPage(item);
        }
      }
    }
  }

  start(url: string) {
    this._fetchPage({ node: url, type: [] });
  }

  private async _fetchPage(relation: Relation) {
    const resp = await this.dereferencer.dereference(relation.node);
    const url = resp.url;
    const page = await streamToArray(resp.data);
    const data = new Store(page);

    this.heap.addAll(extractRelations(data, namedNode(relation.node)));

    if (url !== relation.node) {
      this.heap.addAll(extractRelations(data, namedNode(url)));
    }

    while (this.readyPages.length >= this.config.maxFetched) {
      await this.pageUsed.waiting;
    }

    this.inFlight -= 1;
    this.fetched(relation, { data, url });
  }

  /// Get a page that is ready
  async getPage(): Promise<FetchedPage> {
    if (this.readyPages.length > 0) {
      const out = this.readyPages.pop()!;
      resetPromise(this.pageUsed);
      return out.page;
    }

    await this.pageFetched.waiting;

    return this.getPage();
  }
}
