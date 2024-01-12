import { RdfDereferencer } from "rdf-dereference";
import { Notifier, streamToArray } from "./utils";
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

export type LongPromise = {
  waiting: Promise<void>;
  callback: () => void;
};

export function longPromise(): LongPromise {
  const out = {} as LongPromise;
  out.waiting = new Promise((res) => (out.callback = res));
  return out;
}

export function resetPromise(promise: LongPromise) {
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

export type FetchEvent = {
  relationFound: Relation;
  pageFetched: FetchedPage;
  seen: {};
  scheduleFetch: string;
};

export type Cache = {
  immutable?: boolean;
  maxAge?: number;
};

export class Fetcher {
  private dereferencer: RdfDereferencer;

  private state: State;

  private readonly config: FetcherConfig;

  public bound: TimeBound;

  constructor(
    dereferencer: RdfDereferencer,
    state: State,
    config = DefaultFetcherConfig,
  ) {
    const logger = log.extend("constructor");

    this.bound = {
      open_relations: 1,
    };
    this.dereferencer = dereferencer;
    this.state = state;
    this.config = config;

    logger("new fetcher %o", config);
  }

  async fetch<S>(
    url: string,
    force: boolean,
    state: S,
    notifier: Notifier<FetchEvent, S>,
  ) {
    if (!force && this.state.seen(url)) {
      notifier.seen({}, state);
      return;
    }

    this.state.add(url);

    const logger = log.extend("fetch");
    const resp = await this.dereferencer.dereference(url);
    const page = await streamToArray(resp.data);
    const cache = {} as Cache;
    if (resp.headers) {
      const cacheControlCandidate = resp.headers.get("cache-control");
      if (cacheControlCandidate) {
        const controls = cacheControlCandidate
          .split(",")
          .map((x) => x.split("=", 2).map((x) => x.trim()));

        for (let control of controls) {
          if (control[0] == "max-age") {
            cache.maxAge = parseInt(control[1]);
          }

          if (control[0] == "immutable") {
            cache.immutable = true;
          }
        }
      }
    }

    if (!cache.immutable) {
      notifier.scheduleFetch(url, state);
    }

    logger("Cache for  %s %o", url, cache);

    const data = new Store(page);
    logger("Got data %s (%d quads)", url, page.length);

    for (let rel of extractRelations(data, namedNode(url))) {
      notifier.relationFound(rel, state);
    }

    if (url !== resp.url) {
      for (let rel of extractRelations(data, namedNode(resp.url))) {
        notifier.relationFound(rel, state);
      }
    }

    notifier.pageFetched({ data, url }, state);
  }
}
