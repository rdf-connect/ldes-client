import { RdfDereferencer } from "rdf-dereference";
import { Notifier } from "./utils";
import { Relation } from "./page";
import { SimpleRelation } from "./relation";
import { RdfStore } from "rdf-stores";
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
export type FetcherConfig = {
    concurrentRequests: number;
    maxFetched: number;
};
export declare const DefaultFetcherConfig: FetcherConfig;
export type LongPromise = {
    waiting: Promise<void>;
    callback: () => void;
};
export declare function longPromise(): LongPromise;
export declare function resetPromise(promise: LongPromise): void;
export interface Helper {
    extractRelation(relation: Relation): {
        rel: SimpleRelation;
        node: string;
    };
    handleFetchedPage(page: FetchedPage, marker?: any): void | Promise<void>;
    close(): void | Promise<void>;
}
export type FetchEvent = {
    relationFound: {
        from: Node;
        target: Relation;
    };
    pageFetched: FetchedPage;
    scheduleFetch: Node;
    error: any;
};
export type Cache = {
    immutable?: boolean;
    maxAge?: number;
};
export declare class Fetcher {
    private dereferencer;
    private loose;
    private fetch_f?;
    private after?;
    private before?;
    constructor(dereferencer: RdfDereferencer, loose: boolean, fetch_f?: typeof fetch, after?: Date, before?: Date);
    fetch<S>(node: Node, state: S, notifier: Notifier<FetchEvent, S>): Promise<void>;
}
