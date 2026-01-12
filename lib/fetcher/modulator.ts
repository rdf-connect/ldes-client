import { getLoggerFor } from "../utils/";

import type { ClientStateManager } from "../state";
import { Level } from "level";

export type Notifier<Events, S> = {
    [K in keyof Events]: (event: Events[K], state: S) => unknown;
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


export interface Modulator<F, M> {
    /**
     * Initializes the modulator and loads any previously existing state from the state manager.
     * @returns {Promise<boolean>} True if the modulator was initialized successfully.
    */
    init(): Promise<boolean>;
    /**
     * Starts the handling of a fragment by adding it to the todo list.
     * @param {F} fragment The fragment to be handled.
    */
    push(fragments: F[]): Promise<void>;

    /**
     * Checks if the modulator is ready to trigger the ready event.
    */
    checkReady(): Promise<void>;

    /**
     * Called when a fragment has been handled, which removes it from the inflight list.
     * @param index The index of the fragment that has been handled.
    */
    finished(index: number): void;

    /**
     * Closes the modulator, which removes it from the factory.
    */
    close(): void;

    /**
     * Returns the number of fragments that are still pending.
    */
    pendingCount(): Promise<number>;

    /**
     * Returns whether a fragment has been encountered before and is in the immutable list.
     * @param {string} url The URL of the element to check.
     * @return {Promise<boolean>} True if the element is in the immutable list.
    */
    seen(url: string): Promise<boolean>;

    /**
     * Returns all fragments that are mutable.
     * @returns {Promise<ReadonlyArray<F>>} The mutable list.
    */
    getAllMutable(): Promise<Array<F>>

    /**
     * Returns all data entities that have been extracted but not emitted yet.
     * @returns {Promise<ReadonlyArray<M>>} The unemitted list.
    */
    getAllUnemitted(): Promise<ReadonlyArray<M>>

    /**
     * Returns all fragments that are currently in flight.
     * @returns {Promise<ReadonlyArray<F>>} The inflight list.
    */
    getAllInFlight(): Promise<ReadonlyArray<F>>

    /**
     * Returns all fragments that are currently in todo.
     * @returns {Promise<ReadonlyArray<F>>} The todo list.
    */
    getAllTodo(): Promise<ReadonlyArray<F>>

    /**
     * Records the fact that an element is mutable
     * @param {string} url The URL of the element to record.
     * @param {F} fragment The element to record.
     * @returns {Promise<boolean>} True if all is good to proceed, false if must not emit new notifications.
    */
    addMutable(url: string, fragment: F): Promise<boolean>

    /**
     * Records the fact that an element is immutable.
     * @param {string} url The URL of the element to record.
     * @returns {Promise<boolean>} True if all is good to proceed, false if must not emit new notifications.
    */
    addImmutable(url: string): Promise<boolean>

    /**
     * Records the fact that a data entity has been emitted.
     * @param {string} url The URL of the emitted data entity.
     * @returns {Promise<boolean>} True if all is good to proceed, false if must not emit new notifications.
    */
    addEmitted(url: string): Promise<boolean>

    /**
     * Records the fact that a data entity has been extracted but not emitted yet.
     * @param {string} url The URL of the data entity.
     * @param {M} member The extracted data entity.
     * @returns {Promise<boolean>} True if all is good to proceed, false if must not emit new notifications.
    */
    addUnemitted(url: string, member: M): Promise<boolean>

    /**
     * Returns whether a data entity has been emitted.
     * @param {string} url The URL of the data entity.
     * @returns {Promise<boolean>} True if the data entity has been emitted.
    */
    wasEmitted(url: string): Promise<boolean>

    /**
     * Removes a data entity from the unemitted list.
     * @param {string} url The URL of the data entity.
     * @returns {Promise<boolean>} True if all is good to proceed, false if must not emit new notifications.
    */
    deleteUnemitted(url: string): Promise<boolean>

    /**
     * Returns whether the modulator is tracking latest versions
     * @returns {boolean} True if the modulator is tracking latest versions
    */
    hasLatestVersions(): boolean;

    /**
     * Filter out older versions of a member.
     * @param {string} memberId The ID of the member (isVersionOf).
     * @param {number} version The version of the member.
     * @returns {Promise<boolean>} True if the member is old and should be filtered out.
     * @throws {Error} If processing was cancelled and must not continue.
    */
    filterLatest(memberId: string, version: number): Promise<boolean>

}

type ModulatorState<F, M> = {
    todo: Level<number, F>;
    inflight: Level<number, F>;
    mutable: Level<string, F>;
    emitted: Level<string, boolean>;
    immutable?: Level<string, boolean>;
    unemitted?: Level<string, M>;
    latestVersions?: Level<string, number>;
    fragmentEncoder?: (item: F) => unknown;
    fragmentParser?: (item: unknown) => F;
    memberEncoder?: (item: M) => unknown;
    memberParser?: (item: unknown) => M;
};

/**
 * Factory that creates Modulators
 * This is a factory to keep track whether the Modulator should be paused or not.
 */
export class ModulatorFactory {
    concurrent: number;
    paused: boolean = false;
    saveState: boolean = false;
    lastVersionOnly: boolean = false;

    clientStateManager: ClientStateManager;
    children: { [key: string]: Modulator<unknown, unknown> } = {};

    constructor(
        clientStateManager: ClientStateManager,
        saveState?: boolean,
        concurrent?: number,
        lastVersionOnly?: boolean
    ) {
        this.clientStateManager = clientStateManager;
        this.saveState = saveState!!;
        this.concurrent = concurrent || 10;
        this.lastVersionOnly = lastVersionOnly!!;
    }

    create<F, M>(
        name: string,
        ranker: Ranker<Indexed<F>>,
        notifier: Notifier<ModulatorEvents<F>, unknown>,
        fragmentEncoder?: (item: F) => unknown,
        fragmentParser?: (item: unknown) => F,
        memberEncoder?: (item: M) => unknown,
        memberParser?: (item: unknown) => M,
    ): Modulator<F, M> {
        const modulatorState: ModulatorState<F, M> = {
            todo: this.clientStateManager.build<number, F>("todo"),
            inflight: this.clientStateManager.build<number, F>("inflight"),
            mutable: this.clientStateManager.build<string, F>("mutable"),
            emitted: this.clientStateManager.build<string, boolean>("emitted"),
            fragmentEncoder,
            fragmentParser,
            memberEncoder,
            memberParser,
        };

        // Build all state tracking objects (if needed)
        if (this.saveState) {
            modulatorState.immutable = this.clientStateManager.build<string, boolean>("immutable");
            modulatorState.unemitted = this.clientStateManager.build<string, M>("unemitted");
        }

        // Build a state object to record the latest version of every member (if required)
        if (this.lastVersionOnly) {
            modulatorState.latestVersions = this.clientStateManager.build<string, number>("latestVersions");
        }

        const modulator = new ModulatorInstance(
            modulatorState,
            ranker,
            notifier,
            this
        );
        this.children[name] = modulator;
        return modulator;
    }

    pause() {
        this.paused = true;
    }

    unpause() {
        this.paused = false;
        Object.values(this.children).forEach(async (modulator) => await modulator.checkReady());
    }

    close() {
        Object.values(this.children).forEach((modulator) => modulator.close());
    }
}

export class ModulatorInstance<F, M> {
    at: number = 0;
    index: number = 0;

    private modulatorState: ModulatorState<F, M>;
    private ranker: Ranker<Indexed<F>>;
    private notifier: Notifier<ModulatorEvents<F>, unknown>;
    private factory: ModulatorFactory;

    private logger = getLoggerFor(this);
    private closed = false;
    private versionStateSync = Promise.resolve();

    constructor(
        state: ModulatorState<F, M>,
        ranker: Ranker<Indexed<F>>,
        notifier: Notifier<ModulatorEvents<F>, unknown>,
        factory: ModulatorFactory,
    ) {
        this.modulatorState = state;
        this.ranker = ranker;
        this.notifier = notifier;
        this.factory = factory;
    }

    async init(): Promise<boolean> {
        if (this.closed) return false;
        try {
            this.logger.debug("Initializing modulator");
            const pending = (await Promise.all([
                this.getAllTodo(),
                this.getAllInFlight(),
            ])).flat();

            // Clean up previous record lists
            await Promise.all([
                this.clearAllTodo(),
                this.clearAllInFlight(),
            ]);

            this.logger.verbose(`Initializing and loading ${pending.length} pending fragments from a previous run`);
            await this.push(pending);
            return true;
        } catch (e) {
            this.logger.error("Failed to initialize modulator, shutting down: ", e);
            return false;
        }
    }

    async push(fragments: F[]) {
        for (const fragment of fragments) {
            const indexed = { item: fragment, index: this.index };
            await this.addTodo(this.index, fragment);
            this.index += 1;
            this.ranker.push(indexed);
        }
        await this.checkReady();
    }

    async checkReady() {
        if (this.factory.paused || this.closed) {
            return;
        }

        while (this.at < this.factory.concurrent) {
            const indexedItem = this.ranker.pop();
            if (indexedItem) {
                const { todo } = this.modulatorState;

                // This item is no longer todo and is now inflight
                await Promise.all([
                    todo.del(indexedItem.index),
                    this.addInFlight(indexedItem.index, indexedItem.item),
                ]);

                this.at += 1;
                this.notifier.ready(indexedItem, {});
            } else {
                break;
            }
        }
    }

    async finished(index: number) {
        const { inflight } = this.modulatorState;
        try {
            await inflight.del(index);
            this.at -= 1;
            await this.checkReady();
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return;
            }
            throw err;
        }
    }

    close() {
        this.closed = true;
    }

    async pendingCount(): Promise<number> {
        if (this.closed) return 0;
        const { todo, inflight } = this.modulatorState;
        if (!todo || !inflight) {
            return 0;
        }
        const [a, b] = await Promise.all([
            todo.values().all(),
            inflight.values().all(),
        ]);
        return a.length + b.length;
    }

    async seen(url: string): Promise<boolean> {
        if (this.closed) return false;
        const { immutable } = this.modulatorState;
        if (!immutable) {
            return false;
        }
        try {
            return await immutable.has(url);
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return false;
            }
            throw err;
        }
    }

    async getAllMutable(): Promise<Array<F>> {
        if (this.closed) return [];
        const { mutable, fragmentParser } = this.modulatorState;
        try {
            const values = await mutable.values().all();
            return fragmentParser ? values.map(fragmentParser) : values;
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return [];
            }
            throw err;
        }
    }

    async getAllUnemitted(): Promise<ReadonlyArray<M>> {
        if (this.closed) return [];
        const { unemitted, memberParser } = this.modulatorState;
        if (!unemitted) {
            return [];
        }
        try {
            const values = await unemitted.values().all();
            return memberParser ? values.map(memberParser) : values;
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return [];
            }
            throw err;
        }
    }

    async getAllInFlight(): Promise<ReadonlyArray<F>> {
        if (this.closed) return [];
        const { inflight, fragmentParser } = this.modulatorState;
        if (!inflight) {
            return [];
        }
        try {
            const values = await inflight.values().all();
            return fragmentParser ? values.map(fragmentParser) : values;
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return [];
            }
            throw err;
        }
    }

    async getAllTodo(): Promise<ReadonlyArray<F>> {
        if (this.closed) return [];
        const { todo, fragmentParser } = this.modulatorState;
        if (!todo) {
            return [];
        }
        try {
            const values = await todo.values().all();
            return fragmentParser ? values.map(fragmentParser) : values;
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return [];
            }
            throw err;
        }
    }

    async addMutable(url: string, fragment: F): Promise<boolean> {
        // If things are shutting down, relay back that we must not emit new notifications
        if (this.closed) return false;
        const { mutable, fragmentEncoder } = this.modulatorState;

        try {
            if (await mutable.has(url)) {
                // Fragment is already in mutable, so notifications may proceed
                return true;
            }
            await mutable.put(
                url,
                fragmentEncoder ? <F>fragmentEncoder(fragment) : fragment
            );
            // State was updated successfully, so notifications may proceed
            return true;
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                // Database is closed, relay back that we must not emit new notifications
                return false;
            }
            throw err;
        }
    }

    async addImmutable(url: string): Promise<boolean> {
        // If things are shutting down, relay back that we must not emit new notifications
        if (this.closed) return false;
        const { immutable, mutable } = this.modulatorState;

        try {
            // Remove from mutable list
            await mutable.del(url);
            if (!immutable) {
                // State is not being tracked, so notifications may proceed
                return true;
            }
            // Add to immutable list
            await immutable.put(url, true);
            // State was updated successfully, so notifications may proceed
            return true;
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                // Database is closed, relay back that we must not emit new notifications
                return false;
            }
            throw err;
        }
    }

    async addEmitted(url: string): Promise<boolean> {
        // If things are shutting down, relay back that we must not emit new notifications
        if (this.closed) return false;
        const { emitted, unemitted } = this.modulatorState;
        try {
            // Add to emitted list
            await emitted.put(url, true);
            if (!unemitted) {
                // State is not being tracked, so notifications may proceed
                return true;
            }
            // Remove from unemitted list too
            await unemitted.del(url);
            // State was updated successfully, so notifications may proceed
            return true;
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                // Database is closed, relay back that we must not emit new notifications
                return false;
            }
            throw err;
        }
    }

    async addUnemitted(url: string, member: M): Promise<boolean> {
        // If things are shutting down, relay back that we must not emit new notifications
        if (this.closed) return false;
        const { unemitted, memberEncoder } = this.modulatorState;
        if (!unemitted) {
            // State is not being tracked, so notifications may proceed
            return true;
        }
        try {
            await unemitted.put(
                url,
                memberEncoder ? <M>memberEncoder(member) : member
            );
            // State was updated successfully, so notifications may proceed
            return true;
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                // Database is closed, relay back that we must not emit new notifications
                return false;
            }
            throw err;
        }
    }

    async wasEmitted(url: string): Promise<boolean> {
        if (this.closed) return false;
        const { emitted } = this.modulatorState;
        try {
            return await emitted.has(url);
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return false;
            }
            throw err;
        }
    }

    async deleteUnemitted(url: string): Promise<boolean> {
        // If things are shutting down, relay back that we must not emit new notifications
        if (this.closed) return false;
        const { unemitted } = this.modulatorState;
        if (!unemitted) {
            // State is not being tracked, so notifications may proceed
            return true;
        }
        try {
            await unemitted.del(url);
            // State was updated successfully, so notifications may proceed
            return true;
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                // Database is closed, relay back that we must not emit new notifications
                return false;
            }
            throw err;
        }
    }

    hasLatestVersions(): boolean {
        if (this.closed) return false;
        return !!this.modulatorState.latestVersions;
    }

    /**
     * This method uses a promise-chain (versionStateSync) to serialize all version checks and updates, 
     * preventing race conditions when multiple fragment extractions occur in parallel.
    */
    async filterLatest(memberId: string, version: number): Promise<boolean> {
        // If things are shutting down, relay back that we must not emit new notifications
        if (this.closed) throw new Error('Modulator is closed');
        const { latestVersions } = this.modulatorState;
        // If version state is not being tracked, then this member can't be filtered as an old one
        if (!latestVersions) return false;

        const p = this.versionStateSync.then(async () => {
            // Again, if things are shutting down, relay back that we must not emit new notifications
            if (this.closed) throw new Error('Modulator is closed');
            try {
                const latestVersion = await latestVersions.get(memberId).catch(() => undefined);
                if (latestVersion === undefined || version > latestVersion) {
                    // This member is a newer version
                    await latestVersions.put(memberId, version);
                    return false;
                }
                return version < latestVersion;
            } catch (ex) {
                // Database is closed or something else went wrong, relay back that we must not emit new notifications
                throw ex;
            }
        });
        this.versionStateSync = p.then(() => { })
            .catch((err) => {
                // Things are shutting down or something went wrong, relay back that we must not emit new notifications
                throw err;
            });
        return await p;
    }

    /**
     * Clears the todo list.
    */
    async clearAllTodo(): Promise<void> {
        if (this.closed) return;
        const { todo } = this.modulatorState;
        try {
            await todo.clear();
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return;
            }
            throw err;
        }
    }

    /**
     * Adds a fragment to the todo list.
    */
    async addTodo(index: number, fragment: F): Promise<void> {
        if (this.closed) return;
        const { todo, fragmentEncoder } = this.modulatorState;
        try {
            await todo.put(
                index,
                fragmentEncoder ? <F>fragmentEncoder(fragment) : fragment
            );
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return;
            }
            throw err;
        }
    }

    /**
     * Clears the in-flight list.
    */
    async clearAllInFlight(): Promise<void> {
        if (this.closed) return;
        const { inflight } = this.modulatorState;
        try {
            await inflight.clear();
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return;
            }
            throw err;
        }
    }

    /**
     * Adds a fragment to the in-flight list.
    */
    async addInFlight(index: number, fragment: F): Promise<void> {
        if (this.closed) return;
        const { inflight, fragmentEncoder } = this.modulatorState;
        try {
            await inflight.put(
                index,
                fragmentEncoder ? <F>fragmentEncoder(fragment) : fragment
            );
        } catch (err) {
            if ((err as Error & { code: string }).code === 'LEVEL_DATABASE_NOT_OPEN') {
                return;
            }
            throw err;
        }
    }
}