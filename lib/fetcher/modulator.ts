import { StateT } from "../state";
import { getLoggerFor } from "../utils/";

import type { StateFactory } from "../state";

export type Notifier<Events, S> = {
    [K in keyof Events]: (event: Events[K], state: S) => void;
};

type Indexed<T> = {
    item: T;
    index: number;
};

/**
 * Generic interface that represents a structure that ranks elements.
 * Most common is a Priority Queue (heap like) that pops elements in order.
 * An array is also a Ranker, without ordering.
 */
export interface Ranker<T> {
    push(item: T): void;
    pop(): T | undefined;
}

export type ModulatorEvents<T> = {
    ready: Indexed<T>;
};

/**
 * Modulator is a state and flow management structure that buffers, ranks and handles elements (T)
 * when its factory is not paused and when not too many elements are active at once.
 * It keeps track of the state of all encountered elements and data entities (M) derived from such elements.
 * 
 * Possible states for elements T are:
 * - Todo: element has been encountered but it has not been handled yet.
 * - InFlight: element is currently being handled.
 * - Mutable: element has been handled but it needs to be handled again in the future.
 * - Immutable: element has been handled and there is no need to handle it again anymore.
 * 
 * Possible states for data entities M are:
 * - Unemitted: data entity has been extracted but has not been emitted yet. 
 *              This is relevant when the modulator follows a ordered strategy, 
 *              where data entities are buffered and are emitted only when possible. 
 * - Emitted: data entity has been emitted.
 */
export interface Modulator<T, M> {
    /**
     * Starts the handling of an element by adding it to the todo list.
     * @param {T} item The element to be handled.
    */
    push(item: T): void;

    /**
     * Called when an element has been handled, which removes it from the inflight list.
     * @param index The index of the element that has been handled.
    */
    finished(index: number): void;

    /**
     * @returns The number of elements in the todo list.
    */
    length(): number;

    /**
     * Returns whether an element has been encountered before and is in the immutable list.
     * @param {string} url The URL of the element to check.
     * @return {boolean} True if the element is in the immutable list.
    */
    seen(url: string): boolean;

    /**
     * Records the fact that an element is mutable
     * @param {string} url The URL of the element to record.
     * @param {T} item The element to record.
    */
    recordMutable(url: string, item: T): void

    /**
     * Records the fact that an element is immutable.
     * @param {string} url The URL of the element to record.
    */
    recordImmutable(url: string): void

    /**
     * Records the fact that a data entity has been emitted.
     * @param {string} url The URL of the emitted data entity.
    */
    recordEmitted(url: string): void

    /**
     * Records the fact that a data entity has been extracted but not emitted yet.
     * @param {string} url The URL of the data entity.
     * @param {M} member The extracted data entity.
    */
    recordUnemitted(url: string, member: M): void

    /**
     * Returns all elements that are still in the todo list.
     * @returns {ReadonlyArray<T>} The todo list.
    */
    getTodo(): ReadonlyArray<T>

    /**
     * Returns all elements that are currently being handled.
     * @returns {ReadonlyArray<T>} The inflight list.
    */
    getInFlight(): ReadonlyArray<T>

    /**
     * Returns all elements that are mutable.
     * @returns {ReadonlyMap<string, T>} The mutable list.
    */
    getMutable(): ReadonlyMap<string, T>

    /**
     * Returns all data entities that have been extracted but not emitted yet.
     * @returns {ReadonlyArray<M>} The unemitted list.
    */
    getUnemitted(): ReadonlyArray<M>

    /**
     * Returns all data entities that have been emitted.
     * @returns {ReadonlySet<string>} The emitted list.
    */
    getEmitted(): ReadonlySet<string>
}

type ModulatorInstanceState<T, M> = {
    todo: Map<number, T>;
    inflight: Map<number, T>;
    mutable: Map<string, T>;
    immutable: Set<string>;
    emitted: Set<string>;
    unemitted: Map<string, M>;
};

/**
 * Factory that creates Modulators
 * This is a factory to keep track whether the Modulator should be paused or not.
 */
export class ModulatorFactory {
    concurrent = 10;
    paused: boolean = false;

    factory: StateFactory;
    children: ModulatorInstance<unknown, unknown>[] = [];

    constructor(stateFactory: StateFactory, concurrent?: number) {
        this.factory = stateFactory;
        if (concurrent) {
            this.concurrent = concurrent;
        }
    }

    /**
     * Note: `T` and `M` should be plain javascript objects (because that is how state is saved)
     */
    create<T, M>(
        name: string,
        ranker: Ranker<Indexed<T>>,
        notifier: Notifier<ModulatorEvents<T>, unknown>,
        parse?: (item: unknown) => T,
    ): Modulator<T, M> {
        const state = this.factory.build<ModulatorInstanceState<T, M>>(
            name,
            (stateObj) => JSON.stringify(stateObj, (_, value) => {
                if (value instanceof Set) {
                    return { datatype: "Set", value: Array.from(value) };
                } else if (value instanceof Map) {
                    return { datatype: "Map", value: Array.from(value.entries()) };
                } else {
                    return value;
                }
            }),
            (input) => {
                return JSON.parse(input, (_, value) => {
                    if (value && value.datatype === "Set") {
                        return new Set(value.value);
                    } else if (value && value.datatype === "Map") {
                        return new Map(value.value);
                    } else {
                        return value;
                    }
                }) as ModulatorInstanceState<T, M>;
            },
            () => ({
                todo: new Map(),
                inflight: new Map(),
                mutable: new Map(),
                immutable: new Set(),
                emitted: new Set(),
                unemitted: new Map(),
            }),
        );

        if (parse) {
            state.item.todo = new Map(
                Array.from(state.item.todo.entries())
                    .map(([k, v]) => [k, parse(v)])
            );
            state.item.inflight = new Map(
                Array.from(state.item.inflight.entries())
                    .map(([k, v]) => [k, parse(v)])
            );
            state.item.mutable = new Map(
                Array.from(state.item.mutable.entries())
                    .map(([k, v]) => [k, parse(v)])
            );
        }

        const modulator = new ModulatorInstance(state, ranker, notifier, this);
        this.children.push(<ModulatorInstance<unknown, unknown>>modulator);
        return modulator;
    }

    pause() {
        this.paused = true;
    }

    unpause() {
        this.paused = false;
        this.children.forEach((x) => x.checkReady());
    }
}

export class ModulatorInstance<T, M> implements Modulator<T, M> {
    at: number = 0;
    index = 0;

    private state: StateT<ModulatorInstanceState<T, M>>;
    private ranker: Ranker<Indexed<T>>;
    private notifier: Notifier<ModulatorEvents<T>, unknown>;
    private factory: ModulatorFactory;

    private logger = getLoggerFor(this);

    constructor(
        state: StateT<ModulatorInstanceState<T, M>>,
        ranker: Ranker<Indexed<T>>,
        notifier: Notifier<ModulatorEvents<T>, unknown>,
        factory: ModulatorFactory,
    ) {
        this.state = state;
        const read = [
            ...this.state.item.todo.values(),
            ...this.state.item.inflight.values(),
        ];

        // Clean up previous record lists
        this.state.item.inflight.clear();
        this.state.item.todo.clear();

        this.ranker = ranker;
        this.notifier = notifier;
        this.factory = factory;
        for (const item of read) {
            this.push(item);
        }
    }

    length(): number {
        return this.state.item.todo.size;
    }

    push(item: T) {
        const indexed = { item, index: this.index };
        this.state.item.todo.set(this.index, item);
        this.index += 1;
        this.ranker.push(indexed);
        this.checkReady();
    }

    seen(url: string): boolean {
        return this.state.item.immutable.has(url);
    }

    recordMutable(url: string, item: T): void {
        this.state.item.mutable.set(url, item);
    }

    recordImmutable(url: string): void {
        this.state.item.immutable.add(url);
        // Remove from mutable list
        this.state.item.mutable.delete(url);
    }

    recordEmitted(url: string): void {
        this.state.item.emitted.add(url);
        // Remove form unemitted list
        this.state.item.unemitted.delete(url);
    }

    recordUnemitted(url: string, member: M): void {
        this.state.item.unemitted.set(url, member);
    }

    getTodo(): ReadonlyArray<T> {
        return <ReadonlyArray<T>>Array.from(this.state.item.todo.values());
    }

    getInFlight(): ReadonlyArray<T> {
        return <ReadonlyArray<T>>Array.from(this.state.item.inflight.values());
    }

    getMutable(): ReadonlyMap<string, T> {
        return <ReadonlyMap<string, T>>this.state.item.mutable;
    }

    getUnemitted(): ReadonlyArray<M> {
        return <ReadonlyArray<M>>Array.from(this.state.item.unemitted.values());
    }

    getEmitted(): ReadonlySet<string> {
        return <ReadonlySet<string>>this.state.item.emitted;
    }

    finished(index: number) {
        const deleted = this.state.item.inflight.delete(index);

        if (!deleted) {
            this.logger.warn(
                "[finished] Expected to be able to remove inflight item",
            );
        }

        this.at -= 1;
        this.checkReady();
    }

    checkReady() {
        if (this.factory.paused) {
            return;
        }

        while (this.at < this.factory.concurrent) {
            const indexedItem = this.ranker.pop();
            if (indexedItem) {
                // This item is no longer todo
                const removed = this.state.item.todo.delete(indexedItem.index);
                if (!removed) {
                    this.logger.warn(
                        "[checkReady] Expected to be able to remove todo item",
                    );
                }

                // This item is now inflight
                this.state.item.inflight.set(indexedItem.index, indexedItem.item);

                this.at += 1;
                this.notifier.ready(indexedItem, {});
            } else {
                break;
            }
        }
    }
}