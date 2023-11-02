import { RdfDereferencer } from "rdf-dereference";
import { streamToArray } from "./utils";
import { State } from "./state";
import { DataFactory, Store } from "n3";
import { extractRelations, Relation } from "./page";
import { Heap } from "heap-js";
import debug from "debug";
import { RelationChain, SimpleRelation } from "./relation";

const log = debug("fetcher");
const { namedNode } = DataFactory;

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
  close(): void | Promise<void>;
}

export class Fetcher {
  private dereferencer: RdfDereferencer;

  private inFlight = 0;

  private state: State;

  private toFetchHeap: Heap<RelationChain>;

  // Heap keeping track pages that are fetched
  private fetchedPages: Heap<PageAndRelation>;
  // Heap keeping track the relations that are launched
  private readonly launchedRelations: Heap<RelationChain>;
  private readonly config: FetcherConfig;

  private helper: Helper;
  private isFinished = false;

  public bound: TimeBound;

  constructor(
    dereferencer: RdfDereferencer,
    state: State,
    helper: Helper,
    config = DefaultFetcherConfig,
  ) {
    const logger = log.extend("constructor");

    this.helper = helper;
    this.bound = {
      open_relations: 1,
    };
    this.dereferencer = dereferencer;
    this.state = state;

    this.toFetchHeap = new Heap((a, b) => a.ordering(b));
    this.launchedRelations = new Heap((a, b) => a.ordering(b));
    this.fetchedPages = new Heap((a, b) => a.relation.ordering(b.relation));

    this.config = config;

    logger("new fetcher %o", config);
  }

  start(url: string, cmp: (a: any, b: any) => number) {
    const logger = log.extend("start");
    logger("Starting at %s", url);
    const rel = new RelationChain(url, [], undefined, cmp);
    this._fetchPage(rel);
  }

  private launchNewRequests() {
    const logger = log.extend("launch");
    while (this.inFlight < this.config.concurrentRequests) {
      const item = this.toFetchHeap.pop();
      logger("Checking item %o", item?.target);
      if (item) {
        if (!this.state.seen(item.target)) {
          this.state.add(item.target);

          this._fetchPage(item);
          logger("ready to fetch %s", item.target);
        }
      } else {
        logger("breaking");
        break;
      }
    }
  }

  private async handleFetchedPages() {
    const logger = log.extend("handleFetched");
    // Loop over ready pages and inFlightRelations
    //
    let a = this.fetchedPages.pop();
    let b = this.launchedRelations.pop();

    if (a && b) {
      logger(
        "Maybe handling page! %d %s %s %s",
        a.relation.ordering(b),
        a.relation.ordering(b) == 0,
        a.relation.target,
        b.target,
      );
    } else {
      logger(" first a %o b %o", a?.relation.target, b?.target);
    }

    while (a && b && a.relation.ordering(b) === 0) {
      logger("Handling page!", a.relation.target);
      // This page is ready and can be activated

      // Try to find a marker
      let marker = undefined;
      if (a.relation.relations[0]?.important) {
        marker = a.relation.relations[0].value;
      }
      logger(
        "%s is ready and should be handled (marker %s)",
        a.relation.target,
        marker,
      );

      await this.helper.handleFetchedPage(a.page, marker);

      a = this.fetchedPages.pop();
      b = this.launchedRelations.pop();
    }

    if (a) this.fetchedPages.push(a);
    if (b) this.launchedRelations.push(b);

    logger(" second a %o b %o", a?.relation.target, b?.target);
  }

  private async fetched(relation: RelationChain, page: FetchedPage) {
    const logger = log.extend("fetched");
    logger(
      "target %s inflight %d concurrentRequests %d",
      relation.target,
      this.inFlight,
      this.config.concurrentRequests,
    );

    this.fetchedPages.add({ relation, page });
    this.inFlight -= 1;

    this.launchNewRequests();
    await this.handleFetchedPages();

    await this.checkFinished();
  }

  async checkFinished(): Promise<boolean> {
    const logger = log.extend("finished");
    const closing =
      this.inFlight === 0 &&
      this.fetchedPages.length === 0 &&
      this.toFetchHeap.length === 0;
    logger("Finished %o", closing);
    if (closing && !this.isFinished) {
      this.isFinished = true;
      await this.helper.close();
    }
    return closing;
  }

  private extractRelationsForUri(
    data: Store,
    relation: RelationChain,
    uri: string,
  ): number {
    let out = 0;
    for (let rel of extractRelations(data, namedNode(uri))) {
      const target = this.helper.extractRelation(rel);
      const chain = relation.push(target.node, target.rel);
      this.toFetchHeap.push(chain);
      out += 1;
    }
    return out;
  }

  private async _fetchPage(relation: RelationChain) {
    const logger = log.extend("fetch");

    this.inFlight += 1;
    this.launchedRelations.push(relation);

    const resp = await this.dereferencer.dereference(relation.target);
    const url = resp.url;
    const page = await streamToArray(resp.data);
    const data = new Store(page);

    logger("Got data %s (%d quads)", url, page.length);

    let foundRelations = this.extractRelationsForUri(
      data,
      relation,
      relation.target,
    );

    if (url !== relation.target) {
      foundRelations += this.extractRelationsForUri(data, relation, url);
    }

    logger("%s produced %d relations", relation.target, foundRelations);

    await this.fetched(relation, { data, url });
  }
}
