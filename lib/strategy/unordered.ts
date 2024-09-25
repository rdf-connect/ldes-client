import { Manager, MemberEvents } from "../memberManager";
import { FetchedPage, Fetcher, FetchEvent, Node } from "../pageFetcher";
import { Modulator, ModulatorFactory, Notifier } from "../utils";

import { StrategyEvents } from ".";
import { getLoggerFor } from "../utils/logUtil";

export class UnorderedStrategy {
    private manager: Manager;
    private fetcher: Fetcher;
    private notifier: Notifier<StrategyEvents, unknown>;

    private inFlight: number = 0;

    private fetchNotifier: Notifier<FetchEvent, { index: number }>;
    private memberNotifier: Notifier<MemberEvents, unknown>;

    private modulator: Modulator<Node>;

    private cacheList: Node[] = [];
    private polling: boolean;
    private pollInterval?: number;

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

        // Callbacks for the fetcher
        // - seen: the strategy wanted to fetch an uri, but it was already seen
        //         so one fetch request is terminated, inFlight -= 1
        // - pageFetched: a complete page is fetched and the relations have been extracted
        //         start member extraction
        // - relationFound: a relation has been found, inFlight += 1 and put it in the queue
        this.fetchNotifier = {
            error: (error: unknown) => {
                this.logger.error(`[fetch] Error: ${JSON.stringify(error)}`);
                this.notifier.error(error, {});
            },
            scheduleFetch: (node: Node) => {
                this.cacheList.push(node);
                this.notifier.mutable({}, {});
            },
            pageFetched: (page, { index }) => {
                this.logger.debug(`Paged fetched ${page.url}`);
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
            done: () => {
                this.logger.debug("[member] Members on page done");
                this.inFlight -= 1;
                this.checkEnd();
                this.notifier.fragment({}, {});
            },
            extracted: (mem) => this.notifier.member(mem, {}),
        };

        this.modulator = modulatorFactory.create<Node>("fetcher", [], {
            ready: ({ item, index }) =>
                this.fetcher.fetch(item, { index }, this.fetchNotifier),
        });
    }

    start(url: string) {
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

    cancel() {
        this.canceled = true;
    }

    private handleFetched(page: FetchedPage, index: number) {
        this.modulator.finished(index);
        this.manager.extractMembers(page, {}, this.memberNotifier);
    }

    private checkEnd() {
        if (this.canceled) return;
        if (this.inFlight == 0) {
            if (this.polling) {
                setTimeout(() => {
                    if (this.canceled) return;

                    this.notifier.pollCycle({}, {});
                    const cl = this.cacheList.slice();
                    this.cacheList = [];
                    for (const cache of cl) {
                        this.inFlight += 1;
                        this.modulator.push(cache);
                    }
                }, this.pollInterval || 1000);
            } else {
                this.logger.debug("Closing the notifier, polling is not set");
                this.canceled = true;
                this.notifier.close({}, {});
            }
        }
    }
}
