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

    private inFlight: number = 0;

    private fetchNotifier: Notifier<FetchEvent, { index: number }>;
    private memberNotifier: Notifier<
        MemberEvents,
        { index: number, emitted: ReadonlySet<string> }
    >;

    private modulator: Modulator<Node, SerializedMember>;

    private toPoll: Node[] = [];
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
        // - relationFound: a relation has been found, inFlight += 1 and put it in the queue
        this.fetchNotifier = {
            error: (error: unknown) => {
                this.logger.error(`[fetchNotifier] Error: ${JSON.stringify(error)}`);
                this.notifier.error(error, {});
            },
            scheduleFetch: (node: Node) => {
                this.logger.debug(`[fetchNotifier - pageFetched] Scheduling fetch for mutable page: ${node.target}`);
                this.toPoll.push(node);
                // Register in the state that this page needs to be refetched in the future
                this.modulator.recordMutable(node.target, node);
                this.notifier.mutable({}, {});
            },
            pageFetched: (page, { index }) => {
                this.logger.debug(`[fetchNotifier - pageFetched] Paged fetched ${page.url}`);
                this.handleFetched(page, index);
            },
            relationFound: ({ from, target }) => {
                from.expected.push(target.node);
                this.inFlight += 1;
                this.modulator.push({
                    target: target.node,
                    expected: [from.target],
                });
            },
        };

        // Callbacks for the member extractor
        // - done: all members have been extracted, we are finally done with a page inFlight -= 1
        // - extracted: a member has been found, yeet it
        this.memberNotifier = {
            error: (error) => {
                this.notifier.error(error, {});
            },
            done: (fragment: FetchedPage) => {
                this.logger.debug("[memberNotifier - done] Members on page done");
                this.inFlight -= 1;
                this.notifier.fragment(fragment, {});

                if (fragment.immutable) {
                    this.logger.debug(`[memberNotifier - done] Remembering immutable page to avoid future refetching: ${fragment.url}`);
                    this.modulator.recordImmutable(fragment.url);
                }
                this.checkEnd();
            },
            extracted: (mem) => {
                // Member is emitted immediately after extraction, so no need to record it in the not emitted state
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
                }
            },
        });
    }

    start(url: string, root?: FetchedPage) {
        // Here we would check for unemitted members from a previous run,
        // but in this strategy we never have any unemitted members.

        // Check for any mutable pages from a previous run
        const mutable = Array.from(this.modulator.getMutable().values());
        if (mutable.length > 0) {
            this.logger.debug(`[start] Found ${mutable.length} mutable pages in the saved state`);
            mutable.forEach((node) => {
                this.toPoll.push(node);
                this.notifier.mutable({}, {});
                this.inFlight += 1;
                this.modulator.push(node);
            });
        }

        if (root) {
            // This is a local dump. Proceed to extract members
            this.manager.extractMembers(
                root,
                { index: 0, emitted: new Set<string>() },
                this.memberNotifier
            );
        } else {
            this.inFlight = this.modulator.length();
            if (this.inFlight < 1) {
                this.inFlight = 1;
                this.modulator.push({ target: url, expected: [] });
                this.logger.debug("[start] Nothing in flight, adding start url");
            } else {
                this.logger.debug(
                    "[start] Things are already inflight, not adding start url",
                );
            }
        }
    }

    cancel() {
        this.canceled = true;
    }

    private handleFetched(page: FetchedPage, index: number) {
        this.modulator.finished(index);
        this.manager.extractMembers(
            page, 
            { index, emitted: this.modulator.getEmitted() }, 
            this.memberNotifier
        );
    }

    private checkEnd() {
        if (this.canceled) return;
        if (this.inFlight <= 0) {
            // Make sure we don't schedule multiple polling cycles
            if (this.polling && !this.pollingIsScheduled) {
                this.logger.debug(`[checkEnd] Polling is enabled, setting timeout of ${this.pollInterval || 1000} ms to poll`);
                setTimeout(() => {
                    if (this.canceled) return;

                    this.pollingIsScheduled = false;
                    this.notifier.pollCycle({}, {});
                    const tp = this.toPoll.slice();
                    this.toPoll = [];
                    for (const mutable of tp) {
                        this.inFlight += 1;
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
