import { StateT } from "../state";
import { getLoggerFor } from "../utils/";

import type { StateFactory } from "../state";

export type Notifier<Events, S> = {
    [K in keyof Events]: (event: Events[K], state: S) => void;
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

export type ModulartorEvents<T> = {
    ready: Indexed<T>;
};

/**
 * Factory that creates Modulator's
 * This is a factory to keep track whether or not the Modulator should be paused or not.
 */
export class ModulatorFactory {
    concurrent = 10;
    paused: boolean = false;

    factory: StateFactory;
    children: ModulatorInstance<unknown>[] = [];

    constructor(stateFactory: StateFactory, concurrent?: number) {
        this.factory = stateFactory;
        if (concurrent) {
            this.concurrent = concurrent;
        }
    }

    /**
     * Note: `T` should be plain javascript objects (because that how state is saved)
     */
    create<T>(
        name: string,
        ranker: Ranker<Indexed<T>>,
        notifier: Notifier<ModulartorEvents<T>, unknown>,
        parse?: (item: unknown) => T,
    ): Modulator<T> {
        const state = this.factory.build<ModulatorInstanceState<T>>(
            name,
            JSON.stringify,
            JSON.parse,
            () => ({
                todo: [],
                inflight: [],
            }),
        );

        if (parse) {
            state.item.todo = state.item.todo.map(({ item, index }) => ({
                index,
                item: parse(item),
            }));
            state.item.inflight = state.item.inflight.map(
                ({ item, index }) => ({
                    index,
                    item: parse(item),
                }),
            );
        }

        const modulator = new ModulatorInstance(state, ranker, notifier, this);
        this.children.push(<ModulatorInstance<unknown>>modulator);
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

class ModulatorInstance<T> implements Modulator<T> {
    at: number = 0;
    index = 0;

    private state: StateT<ModulatorInstanceState<T>>;

    private ranker: Ranker<Indexed<T>>;
    private notifier: Notifier<ModulartorEvents<T>, unknown>;
    private factory: ModulatorFactory;

    private logger = getLoggerFor(this);

    constructor(
        state: StateT<ModulatorInstanceState<T>>,
        ranker: Ranker<Indexed<T>>,
        notifier: Notifier<ModulartorEvents<T>, unknown>,
        factory: ModulatorFactory,
    ) {
        this.state = state;
        const readd = [...this.state.item.todo, ...this.state.item.inflight];
        this.state.item.todo.push(...this.state.item.inflight);
        while (this.state.item.inflight.pop()) {
            // pass
        }
        while (this.state.item.todo.pop()) {
            // pass
        }
        this.ranker = ranker;
        this.notifier = notifier;
        this.factory = factory;
        for (const item of readd) {
            this.push(item.item);
        }
    }

    length(): number {
        return this.state.item.todo.length;
    }

    push(item: T) {
        const indexed = { item, index: this.index };
        this.state.item.todo.push(indexed);
        this.index += 1;
        this.ranker.push(indexed);
        this.checkReady();
    }

    finished(index: number) {
        const removeIdx = this.state.item.inflight.findIndex(
            (x) => x.index == index,
        );
        if (removeIdx >= 0) {
            this.state.item.inflight.splice(removeIdx, 1);
        } else {
            this.logger.error(
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
            const item = this.ranker.pop();
            if (item) {
                // This item is no longer todo
                // I'm quite afraid to use filter for this
                const removeIdx = this.state.item.todo.findIndex(
                    (x) => x.index == item.index,
                );
                if (removeIdx >= 0) {
                    this.state.item.todo.splice(removeIdx, 1);
                } else {
                    this.logger.error(
                        "[checkReady] Expected to be able to remove inflight item",
                    );
                }

                // This item is now inflight
                this.state.item.inflight.push(item);

                this.at += 1;
                this.notifier.ready(item, {});
            } else {
                break;
            }
        }
    }
}