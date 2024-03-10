import { NamedNode, Quad_Subject, Stream, Term } from "@rdfjs/types";
import { BaseQuad } from "n3";
import { StateFactory, StateT } from "./state";
import { RdfStore } from "rdf-stores";
export type Notifier<Events, S> = {
    [K in keyof Events]: (event: Events[K], state: S) => void;
};
export declare function getSubjects(store: RdfStore, predicate: Term | null, object: Term | null, graph?: Term | null): Quad_Subject[];
export declare function getObjects(store: RdfStore, subject: Term | null, predicate: Term | null, graph?: Term | null): import("@rdfjs/types").Quad_Object[];
export declare function readableToArray<T>(stream: ReadableStream<T>): Promise<T[]>;
/**
 * Converts a stream to an array, pushing all elements to an array
 * Resolving the promise with the 'end' event
 */
export declare function streamToArray<T extends BaseQuad>(stream: Stream<T>): Promise<T[]>;
/**
 * Find the main sh:NodeShape subject of a given Shape Graph.
 * We determine this by assuming that the main node shape
 * is not referenced by any other shape description.
 * If more than one is found an exception is thrown.
 */
export declare function extractMainNodeShape(store: RdfStore): NamedNode;
/**
 * Generic interface that represents a structure that ranks elements.
 * Most common is a Prority Queue (heap like) the pops elements in order.
 * An array is also a Ranker, without ordering.
 */
export interface Ranker<T> {
    push(item: T): void;
    pop(): T | undefined;
}
export type ModulartorEvents<T> = {
    ready: Indexed<T>;
};
/**
 * Factory that creates Modulators
 * This is a factory to keep track whether or not the Modulator should be paused or not.
 */
export declare class ModulatorFactory {
    concurrent: number;
    paused: boolean;
    factory: StateFactory;
    children: ModulatorInstance<any>[];
    constructor(stateFactory: StateFactory, concurrent?: number);
    /**
     * Note: `T` should be plain javascript objects (because that how state is saved)
     */
    create<T>(name: string, ranker: Ranker<Indexed<T>>, notifier: Notifier<ModulartorEvents<T>, {}>, parse?: (item: any) => T): Modulator<T>;
    pause(): void;
    unpause(): void;
}
/**
 * Modulator is a structure that only buffers elements and only handles elements
 * when the factory is not paused and when not too many items are active at once.
 */
export interface Modulator<T> {
    push(item: T): void;
    finished(index: number): void;
    length(): number;
}
type Indexed<T> = {
    item: T;
    index: number;
};
type ModulatorInstanceState<T> = {
    todo: Indexed<T>[];
    inflight: Indexed<T>[];
};
declare class ModulatorInstance<T> implements Modulator<T> {
    at: number;
    index: number;
    private state;
    private ranker;
    private notifier;
    private factory;
    constructor(state: StateT<ModulatorInstanceState<T>>, ranker: Ranker<Indexed<T>>, notifier: Notifier<ModulartorEvents<T>, {}>, factory: ModulatorFactory);
    length(): number;
    push(item: T): void;
    finished(index: number): void;
    checkReady(): void;
}
export {};
