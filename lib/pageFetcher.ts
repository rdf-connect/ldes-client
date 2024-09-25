import { RdfDereferencer } from "rdf-dereference";
import { Notifier } from "./utils";
import { extractRelations, Relation } from "./page";
import { SimpleRelation } from "./relation";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { Condition } from "./condition";
import { getLoggerFor } from "./utils/logUtil";

const { namedNode } = new DataFactory();

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

    handleFetchedPage(
        page: FetchedPage,
        marker?: unknown,
    ): void | Promise<void>;

    close(): void | Promise<void>;
}

export type FetchEvent = {
    relationFound: { from: Node; target: Relation };
    pageFetched: FetchedPage;
    scheduleFetch: Node;
    error: unknown;
};

export type Cache = {
    immutable?: boolean;
    maxAge?: number;
};

export class Fetcher {
    private dereferencer: RdfDereferencer;
    private loose: boolean;
    private fetch_f?: typeof fetch;
    private condition: Condition;
    private defaultTimezone: string;

    private closed = false;

    private logger = getLoggerFor(this);

    constructor(
        dereferencer: RdfDereferencer,
        loose: boolean,
        condition: Condition,
        defaultTimezone: string,
        fetch_f?: typeof fetch,
    ) {
        this.dereferencer = dereferencer;
        this.loose = loose;
        this.fetch_f = fetch_f;
        this.condition = condition;
        this.defaultTimezone = defaultTimezone;
    }

    close() {
        this.closed = true;
    }

    async fetch<S>(node: Node, state: S, notifier: Notifier<FetchEvent, S>) {
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

                    for (const control of controls) {
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

            this.logger.debug(
                `[fetch] Cache for ${node.target} ${JSON.stringify(cache)}`,
            );

            const data = RdfStore.createDefault();
            let quadCount = 0;
            await new Promise((resolve, reject) => {
                resp.data
                    .on("data", (quad) => {
                        data.addQuad(quad);
                        quadCount++;
                    })
                    .on("end", resolve)
                    .on("error", reject);
            });

            this.logger.debug(
                `[fetch] Got data ${node.target} (${quadCount} quads)`,
            );
            for (const rel of extractRelations(
                data,
                namedNode(resp.url),
                this.loose,
                this.condition,
                this.defaultTimezone,
            )) {
                if (!node.expected.some((x) => x == rel.node)) {
                    if (!this.closed) {
                        notifier.relationFound(
                            { from: node, target: rel },
                            state,
                        );
                    }
                }
            }

            if (!this.closed) {
                notifier.pageFetched({ data, url: resp.url }, state);
            }
        } catch (ex) {
            this.logger.error(`[fetch] Fetch failed ${JSON.stringify(ex)}`);
            notifier.error(ex, state);
        }
    }
}
