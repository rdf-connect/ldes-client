import { Fetcher, ModulatorFactory, Manager } from "../fetcher";
import { getLoggerFor } from "../utils";

import type {
    FetchedPage,
    FetchEvent,
    Node,
    Modulator,
    Notifier,
    MemberEvents
} from "../fetcher";
import type { StrategyEvents, SerializedMember } from ".";

export class UnorderedStrategy {
    private manager: Manager;
    private fetcher: Fetcher;
    private notifier: Notifier<StrategyEvents, unknown>;

    private fetchNotifier: Notifier<FetchEvent, { index: number }>;
    private memberNotifier: Notifier<
        MemberEvents,
        { index: number, emitted: ReadonlySet<string> }
    >;

    private modulator: Modulator<Node, SerializedMember>;

    private polling: boolean;
    private pollInterval?: number;
    private pollingIsScheduled: boolean;

    private canceled = false;

    private logger = getLoggerFor(this);

    constructor(
        memberManager: Manager,
        fetcher: Fetcher,
        notifier: Notifier<StrategyEvents, unknown>,
        modulatorFactory: ModulatorFactory,
        polling: boolean,
        pollInterval?: number,
    ) {
        this.pollInterval = pollInterval;
        this.notifier = notifier;
        this.manager = memberManager;
        this.fetcher = fetcher;
        this.polling = polling;
        this.pollingIsScheduled = false;

        // Callbacks for the fetcher
        // - scheduleFetch: a mutable page was fetched, we keep track of it for future polling
        // - pageFetched: a complete page is fetched and the relations have been extracted
        //         start member extraction
        // - relationFound: a relation has been found, put it in the queue
        this.fetchNotifier = {
            error: (error: unknown) => {
                this.logger.error(`[fetchNotifier] Error: ${JSON.stringify(error)}`);
                this.notifier.error(error, {});
            },
            scheduleFetch: (node: Node) => {
                this.logger.debug(`[fetchNotifier - pageFetched] Scheduling fetch for mutable page: ${node.target}`);
                // Register in the state that this page needs to be refetched in the future
                this.modulator.recordMutable(node.target, node);
                this.notifier.mutable({}, {});
            },
            pageFetched: (page, { index }) => {
                this.logger.debug(`[fetchNotifier - pageFetched] Paged fetched ${page.url}`);
                this.handleFetched(page, index);
            },
            relationFound: ({ from, target }) => {
                this.logger.debug(`[fetchNotifier - relationFound] Found relation leading to ${target.node}`);
                from.expected.push(target.node);
                this.modulator.push({
                    target: target.node,
                    expected: [from.target],
                });
            },
        };

        // Callbacks for the member extractor
        // - done: all members have been extracted
        // - extracted: a member has been found, yeet it
        this.memberNotifier = {
            error: (error) => {
                this.notifier.error(error, {});
            },
            done: (fragment: FetchedPage, { index }) => {
                this.logger.debug("[memberNotifier - done] Members on page done");
                this.notifier.fragment(fragment, {});
                this.modulator.finished(index)

                // Mark page as immutable if cache headers indicate so and page contains members.
                // This is to prevent that intermediary pages cannot be re-fetched in case of an interruption
                // or out-of-order page fetching. 
                if (fragment.immutable && fragment.memberCount > 0) {
                    this.logger.debug(`[memberNotifier - done] Remembering immutable page to avoid future refetching: ${fragment.url}`);
                    this.modulator.recordImmutable(fragment.url);
                }
                this.checkEnd();
            },
            extracted: (mem) => {
                // Member is emitted immediately after extraction, so no need to record it in the unemitted state
                this.notifier.member(mem, {});
                this.modulator.recordEmitted(mem.id.value);
            },
        };

        this.modulator = modulatorFactory.create<Node, SerializedMember>("fetcher", [], {
            ready: ({ item, index }) => {
                // Only fetch this node if it hasn't been fetched in the past
                if (!this.modulator.seen(item.target)) {
                    this.logger.debug(`[modulator - ready] Ready to fetch page: ${item.target}`);
                    this.fetcher.fetch(item, { index }, this.fetchNotifier);
                } else {
                    this.logger.debug(`[modulator - ready] Skipping fetch for previously fetched immutable page: ${item.target}`);
                    this.modulator.finished(index);
                    this.checkEnd();
                }
            },
        });
    }

    start(url: string, root?: FetchedPage) {
        if (root) {
            // This is a local dump. Proceed to extract members
            this.manager.extractMembers(
                root,
                { index: 0, emitted: new Set<string>() },
                this.memberNotifier
            );
        } else if (this.modulator.getInFlight().length < 1
            && this.modulator.getTodo().length < 1) {
            this.logger.debug("[start] Nothing in flight, adding start url");
            this.modulator.push({ target: url, expected: [] });
        } else {
            this.logger.debug(
                "[start] Things are already inflight, not adding start url",
            );
        }
    }

    cancel() {
        this.canceled = true;
    }

    private handleFetched(page: FetchedPage, index: number) {
        this.manager.extractMembers(
            page,
            { index, emitted: this.modulator.getEmitted() },
            this.memberNotifier
        );
    }

    private checkEnd() {
        if (this.canceled) return;
        if (this.modulator.getInFlight().length < 1
            && this.modulator.getTodo().length < 1) {
            // Make sure we don't schedule multiple polling cycles
            if (this.polling && !this.pollingIsScheduled) {
                this.logger.debug(`[checkEnd] Polling is enabled, setting timeout of ${this.pollInterval || 1000} ms to poll`);
                setTimeout(() => {
                    if (this.canceled) return;

                    this.pollingIsScheduled = false;
                    this.notifier.pollCycle({}, {});
                    const toPoll = Array.from(this.modulator.getMutable().values());

                    for (const mutable of toPoll) {
                        this.modulator.push(mutable);
                    }
                }, this.pollInterval || 1000);
                this.pollingIsScheduled = true;
            } else {
                this.logger.debug("[checkEnd] Closing the notifier, polling is not set");
                this.canceled = true;
                this.notifier.close({}, {});
            }
        }
    }
}
