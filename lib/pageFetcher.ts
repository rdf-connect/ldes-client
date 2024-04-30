import { RdfDereferencer } from "rdf-dereference";
import { Notifier } from "./utils";
import { extractRelations, Relation } from "./page";
import debug from "debug";
import { SimpleRelation } from "./relation";
import { RdfStore, RdfStoreIndexNestedMapQuoted, TermDictionaryNumberRecordFullTerms } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
const log = debug("fetcher");
const df = new DataFactory();

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
  data: RdfStore;
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
  scheduleFetch: Node;
  error: any;
};

export type Cache = {
  immutable?: boolean;
  maxAge?: number;
};

export class Fetcher {
  private dereferencer: RdfDereferencer;
  private loose: boolean;
  private fetch_f?: typeof fetch;
  private after?: Date;
  private before?: Date;

  private closed = false;

  constructor(
    dereferencer: RdfDereferencer,
    loose: boolean,
    fetch_f?: typeof fetch,
    after?: Date,
    before?: Date,
  ) {
    this.dereferencer = dereferencer;
    this.loose = loose;
    this.fetch_f = fetch_f;
    if (after) this.after = after;
    if (before) this.before = before;
  }

  close() {
    this.closed = true;
  }

  async fetch<S>(node: Node, state: S, notifier: Notifier<FetchEvent, S>) {
    const logger = log.extend("fetch");

    try {
      const resp = await this.dereferencer.dereference(node.target, {
        localFiles: true,
        fetch: this.fetch_f,
      });

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
        if (!this.closed) {
          notifier.scheduleFetch(node, state);
        }
      }

      logger("Cache for  %s %o", node.target, cache);

      const data = new RdfStore<number>({
        indexCombinations: [
          [ 'graph', 'object', 'predicate', 'subject' ],
          [ 'graph', 'subject', 'predicate', 'object' ],
          [ 'graph', 'predicate', 'object', 'subject' ],
          [ 'graph', 'object', 'subject', 'predicate' ],
        ],
        indexConstructor: subOptions => new RdfStoreIndexNestedMapQuoted(subOptions),
        dictionary: new TermDictionaryNumberRecordFullTerms(),
        dataFactory: df,
        termsCardinalitySets: ['graph'] //enable quick overview of graphs
      });
      logger("Start loading " + node.target + "into store");
      await new Promise((resolve, reject) => {
        data.import(resp.data).on("end", resolve)
          .on("error", reject);
      });
      logger("Imported data %s (%d quads)", node.target, data.size);
      for (let rel of extractRelations(
        data,
        df.namedNode(resp.url),
        this.loose,
        this.after,
        this.before,
      )) {
        if (!node.expected.some((x) => x == rel.node)) {
          if (!this.closed) {
            notifier.relationFound({ from: node, target: rel }, state);
          }
        }
      }

      if (!this.closed) {
        notifier.pageFetched({ data, url: resp.url }, state);
      }
    } catch (ex) {
      logger("Fetch failed %o", ex);
      notifier.error(ex, state);
    }
  }
}
