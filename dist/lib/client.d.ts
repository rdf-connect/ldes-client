import { Config } from "./config";
import { Member } from "./page";
import { RdfDereferencer } from "rdf-dereference";
import { State } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { Term } from "@rdfjs/types";
import { ModulatorFactory } from "./utils";
import type { Writer } from "@ajuvercr/js-runner";
export { intoConfig } from "./config";
export { retry_fetch } from "./utils";
export type { Member, Page, Relation } from "./page";
export type { Config, MediatorConfig, ShapeConfig } from "./config";
export type Ordered = "ascending" | "descending" | "none";
export declare function replicateLDES(config: Config, states?: {
    membersState?: State;
    fragmentState?: State;
    dereferencer?: RdfDereferencer;
}, streamId?: Term, ordered?: Ordered): Client;
export type LDESInfo = {
    shapeMap?: Map<string, Term>;
    extractor: CBDShapeExtractor;
    timestampPath?: Term;
    isVersionOfPath?: Term;
};
type EventMap = Record<string, any>;
type EventKey<T extends EventMap> = string & keyof T;
type EventReceiver<T> = (params: T) => void;
export type ClientEvents = {
    fragment: void;
    mutable: void;
    poll: void;
    error: any;
};
export declare class Client {
    private config;
    private dereferencer;
    private fetcher;
    private memberManager;
    private strategy;
    streamId?: Term;
    private ordered;
    private modulatorFactory;
    private stateFactory;
    private listeners;
    constructor(config: Config, { dereferencer, }?: {
        membersState?: State;
        fragmentState?: State;
        dereferencer?: RdfDereferencer;
    }, stream?: Term, ordered?: Ordered);
    on<K extends EventKey<ClientEvents>>(key: K, fn: EventReceiver<ClientEvents[K]>): void;
    private emit;
    init(emit: (member: Member) => void, close: () => void, factory: ModulatorFactory): Promise<void>;
    stream(strategy?: {
        highWaterMark?: number;
        size?: (chunk: Member) => number;
    }): ReadableStream<Member>;
}
export declare function processor(writer: Writer<string>, url: string, before?: Date, after?: Date, ordered?: string, follow?: boolean, pollInterval?: number, shapes?: string[], noShape?: boolean, save?: string, loose?: boolean, urlIsView?: boolean, verbose?: boolean): Promise<() => Promise<void>>;
