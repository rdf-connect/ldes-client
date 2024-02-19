import { RdfDereferencer } from "rdf-dereference";
import { Notifier, streamToArray } from "./utils";
import { DataFactory, Store } from "n3";
import { extractRelations, Relation } from "./page";
import debug from "debug";
import { SimpleRelation } from "./relation";

const log = debug("fetcher");
const { namedNode } = DataFactory;

/**
 * target: url to fetch
 * expected: relations that can be found, and should be ignored
 *   examples are the originating url
 */
export type Node = {
  target: string;
  expected: string[];
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

export interface Helper {
  extractRelation(relation: Relation): { rel: SimpleRelation; node: string };
  handleFetchedPage(page: FetchedPage, marker?: any): void | Promise<void>;
  close(): void | Promise<void>;
}

export type FetchEvent = {
  relationFound: { from: Node; target: Relation };
  pageFetched: FetchedPage;
  // seen: {};
  scheduleFetch: Node;
};

export type Cache = {
  immutable?: boolean;
  maxAge?: number;
};

export class Fetcher {
  private dereferencer: RdfDereferencer;
  private loose: boolean;

  constructor(dereferencer: RdfDereferencer, loose: boolean) {
    this.dereferencer = dereferencer;
    this.loose = loose;
  }

  async fetch<S>(node: Node, state: S, notifier: Notifier<FetchEvent, S>) {
    const logger = log.extend("fetch");

    const resp = await this.dereferencer.dereference(node.target);
    const page = await streamToArray(resp.data);

    node.target = resp.url;

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
      notifier.scheduleFetch(node, state);
    }

    logger("Cache for  %s %o", node.target, cache);

    const data = new Store(page);
    logger("Got data %s (%d quads)", node.target, page.length);

    for (let rel of extractRelations(data, namedNode(resp.url), this.loose)) {
      if (!node.expected.some((x) => x == rel.node)) {
        notifier.relationFound({ from: node, target: rel }, state);
      }
    }

    // TODO check this, is node.target correct?
    notifier.pageFetched({ data, url: resp.url }, state);
  }
}
