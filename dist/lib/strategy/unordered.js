"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnorderedStrategy = void 0;
class UnorderedStrategy {
    manager;
    fetcher;
    notifier;
    inFlight = 0;
    fetchNotifier;
    memberNotifier;
    modulator;
    cacheList = [];
    polling;
    pollInterval;
    cancled = false;
    constructor(memberManager, fetcher, notifier, modulatorFactory, polling, pollInterval) {
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
            error: (error) => {
                this.notifier.error(error, {});
            },
            scheduleFetch: (node) => {
                this.cacheList.push(node);
                this.notifier.mutable({}, {});
            },
            pageFetched: (page, { index }) => this.handleFetched(page, index),
            relationFound: ({ from, target }) => {
                from.expected.push(target.node);
                this.inFlight += 1;
                this.modulator.push({ target: target.node, expected: [from.target] });
            },
        };
        // Callbacks for the member extractor
        // - done: all members have been extracted, we are finally done with a page inFlight -= 1
        // - extracted: a member has been found, yeet it
        this.memberNotifier = {
            done: () => {
                this.inFlight -= 1;
                this.checkEnd();
                this.notifier.fragment({}, {});
            },
            extracted: (mem) => this.notifier.member(mem, {}),
        };
        this.modulator = modulatorFactory.create("fetcher", [], {
            ready: ({ item, index }) => this.fetcher.fetch(item, { index }, this.fetchNotifier),
        });
    }
    start(url) {
        this.inFlight = this.modulator.length();
        if (this.inFlight < 1) {
            this.inFlight = 1;
            this.modulator.push({ target: url, expected: [] });
            console.log("Nothing in flight, adding start url");
        }
        else {
            console.log("Things are already inflight, not adding start url");
        }
    }
    cancle() {
        this.cancled = true;
    }
    handleFetched(page, index) {
        this.modulator.finished(index);
        this.manager.extractMembers(page, {}, this.memberNotifier);
    }
    checkEnd() {
        if (this.cancled)
            return;
        if (this.inFlight == 0) {
            if (this.polling) {
                setTimeout(() => {
                    if (this.cancled)
                        return;
                    this.notifier.pollCycle({}, {});
                    const cl = this.cacheList.slice();
                    this.cacheList = [];
                    for (let cache of cl) {
                        this.inFlight += 1;
                        this.modulator.push(cache);
                    }
                }, this.pollInterval || 1000);
            }
            else {
                console.log("Closing notifier");
                this.cancled = true;
                this.notifier.close({}, {});
            }
        }
    }
}
exports.UnorderedStrategy = UnorderedStrategy;
