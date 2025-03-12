
import { RdfDereferencer } from "rdf-dereference";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { getLoggerFor } from "../utils";
import { extractRelations } from "./relation";

import type { IDereferenceOptions } from "rdf-dereference";
import type { Condition } from "../condition";
import type { Notifier } from "./modulator";
import type { SimpleRelation, Relation, Relations } from "./relation";

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
    immutable: boolean;
    created?: Date;
    updated?: Date;
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

export async function statelessPageFetch(
    location: string,
    dereferencer: RdfDereferencer,
    fetch_f?: typeof fetch,
): Promise<FetchedPage> {
    const resp = await dereferencer.dereference(location, {
        localFiles: true,
        fetch: fetch_f,
    });
    const url = resp.url;
    const data = RdfStore.createDefault();
    await new Promise((resolve, reject) => {
        data.import(resp.data).on("end", resolve).on("error", reject);
    });
    return <FetchedPage>{ url, data };
}

export type FetchEvent = {
    relationFound: { from: Node; target: Relations };
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
    private includeMetadata: boolean;

    private closed = false;

    private logger = getLoggerFor(this);

    constructor(
        dereferencer: RdfDereferencer,
        loose: boolean,
        condition: Condition,
        defaultTimezone: string,
        includeMetadata: boolean,
        fetch_f?: typeof fetch,
    ) {
        this.dereferencer = dereferencer;
        this.loose = loose;
        this.fetch_f = fetch_f;
        this.condition = condition;
        this.defaultTimezone = defaultTimezone;
        this.includeMetadata = includeMetadata;
    }

    close() {
        this.closed = true;
    }

    async fetch<S>(node: Node, state: S, notifier: Notifier<FetchEvent, S>) {
        try {
            const options: IDereferenceOptions = {
                localFiles: true,
                fetch: this.fetch_f,
            };
            if (this.includeMetadata) {
                options.headers = {
                    Accept: "application/metadata+trig",
                };
            }
            const resp = await this.dereferencer.dereference(node.target, options);

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
                notifier.pageFetched({ 
                    data, 
                    url: resp.url,
                    immutable: !!cache.immutable,
                }, state);
            }
        } catch (ex) {
            this.logger.error(`[fetch] Fetch failed for ${node.target} ${JSON.stringify(ex)}`);
            notifier.error(ex, state);
        }
    }
}
