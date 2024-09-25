import { Heap } from "heap-js";
import { Manager, MemberEvents } from "../memberManager";
import { Member, Relations } from "../page";
import { FetchedPage, Fetcher, FetchEvent } from "../pageFetcher";
import { Modulator, ModulatorFactory, Notifier } from "../utils";
import { RelationChain, SimpleRelation } from "../relation";

import { Ordered } from "../client";
import { GTRs, LTR, PageAndRelation, StrategyEvents } from ".";
import { getLoggerFor } from "../utils/logUtil";
import { Value } from "../condition";

export type StateItem = {
    rel: RelationChain;
    closed: boolean;
    inFlight: number;
    extracting: number;
};

export class OrderedStrategy {
    private members: Heap<Member>;

    private manager: Manager;
    private fetcher: Fetcher;

    // This can be T: controller or something
    private notifier: Notifier<StrategyEvents, unknown>;

    // Contains a heap with all relations that have been launched
    // The heap will first handle unimportant relations,
    //   so when an important relation is handled, we can try to emit members
    //
    // With ordering ascending GT relations are important
    // With ordering descending LT relations are important
    private readonly launchedRelations: Heap<RelationChain>;

    private modulator: Modulator<{ chain: RelationChain; expected: string[] }>;

    private fetchNotifier: Notifier<
        FetchEvent,
        { chain: RelationChain; index: number }
    >;
    private memberNotifer: Notifier<MemberEvents, RelationChain>;
    private fetchedPages: Heap<PageAndRelation>;
    private state: Array<StateItem>;

    private ordered: Ordered;

    private polling: boolean;
    private toPoll: Heap<{ chain: RelationChain; expected: string[] }>;
    private pollInterval?: number;

    private cancled = false;

    private logger = getLoggerFor(this);

    constructor(
        memberManager: Manager,
        fetcher: Fetcher,
        notifier: Notifier<StrategyEvents, unknown>,
        factory: ModulatorFactory,
        ordered: Ordered,
        polling: boolean,
        pollInterval?: number,
    ) {
        this.ordered = ordered;
        this.manager = memberManager;
        this.fetcher = fetcher;
        this.notifier = notifier;
        this.polling = polling;
        this.pollInterval = pollInterval;

        this.toPoll = new Heap((a, b) => a.chain.ordering(b.chain));
        this.launchedRelations = new Heap((a, b) => a.ordering(b));
        this.fetchedPages = new Heap((a, b) => a.relation.ordering(b.relation));
        this.state = [];

        // Callbacks for the fetcher
        // - seen: the strategy wanted to fetch an uri, but it was already seen
        //         so one fetch request is terminated, inFlight -= 1, and remove it from the launchedRelations
        // - pageFetched: a complete page is fetched and the relations have been extracted
        //         start member extraction
        // - relationFound: a relation has been found, put the extended chain in the queue
        this.fetchNotifier = {
            error: (error: unknown) => {
                this.notifier.error(error, {});
            },
            scheduleFetch: ({ target, expected }, { chain }) => {
                chain.target = target;
                this.toPoll.push({ chain, expected });
                this.notifier.mutable({}, {});
            },
            pageFetched: (page, { chain, index }) => {
                this.logger.debug(`Page fetched ${page.url}`);
                this.modulator.finished(index);
                this.handleFetched(page, chain);
            },
            relationFound: ({ from, target }, { chain }) => {
                from.expected.push(target.node);
                this.logger.debug(`Relation found ${target.node}`);
                const newChain = chain.push(
                    target.node,
                    this.extractRelation(target),
                );
                if (newChain.ordering(chain) >= 0) {
                    this.fetch(newChain, [from.target]);
                } else {
                    this.logger.error(
                        "Found relation backwards in time, this indicates wrong tree structure. Ignoring",
                    );
                }
            },
        };

        // Callbacks for member manager
        // - done: extracting is done, indicate this
        // - extract: a member is extracted, add it to our heap
        this.memberNotifer = {
            error: (error) => {
                this.notifier.error(error, {});
            },
            done: (_member, rel) => {
                this.logger.debug(`Member done ${rel.target}`);
                const found = this.findOrDefault(rel);
                found.extracting -= 1;
                this.notifier.fragment({}, {});
                this.checkEmit();
            },
            extracted: (member) => {
                this.members.push(member);
            },
        };

        this.modulator = factory.create(
            "fetcher",
            new Heap((a, b) => a.item.chain.ordering(b.item.chain)),
            {
                ready: ({ item: { chain, expected }, index }) => {
                    this.fetcher.fetch(
                        { target: chain.target, expected },
                        { chain, index },
                        this.fetchNotifier,
                    );
                },
            },
            (inp: unknown) => {
                const { chain, expected } = <
                    {
                        chain: RelationChain;
                        expected: string[];
                    }
                >inp;
                const cmp =
                    this.ordered === "ascending"
                        ? (a: Value, b: Value) => {
                              if (a > b) return 1;
                              if (a < b) return -1;
                              return 0;
                          }
                        : (a: Value, b: Value) => {
                              if (a > b) return -1;
                              if (a < b) return 1;
                              return 0;
                          };

                return {
                    chain: new RelationChain(
                        chain.source,
                        chain.target,
                        chain.relations,
                        undefined,
                        cmp,
                    ),
                    expected,
                };
            },
        );

        if (ordered == "ascending") {
            this.members = new Heap((a, b) => {
                if (a.id.equals(b.id)) return 0;
                if (a.timestamp == b.timestamp) return 0;
                if (!a && b) return 1;
                if (a && !b) return -1;
                if (a.timestamp! < b.timestamp!) return -1;
                return 1;
            });
        } else {
            this.members = new Heap((a, b) => {
                if (a.id.equals(b.id)) return 0;
                if (a.timestamp == b.timestamp) return 0;
                if (!a && b) return -1;
                if (a && !b) return 1;
                if (a.timestamp! < b.timestamp!) return 1;
                return -1;
            });
        }
    }

    start(url: string) {
        this.logger.debug(`Starting at ${url}`);
        const cmp = (a: Value, b: Value) => {
            if (a > b) return 1;
            if (a < b) return -1;
            return 0;
        };

        if (this.ordered === "ascending") {
            this.fetch(
                new RelationChain(
                    "",
                    url,
                    [],
                    undefined,
                    (a, b) => +1 * cmp(a, b),
                ).push(url, {
                    important: false,
                    value: 0,
                }),
                [],
            );
        } else {
            this.fetch(
                new RelationChain(
                    "",
                    url,
                    [],
                    undefined,
                    (a, b) => -1 * cmp(a, b),
                ).push(url, {
                    important: false,
                    value: 0,
                }),
                [],
            );
        }
    }

    cancel() {
        this.cancled = true;
    }

    checkEnd() {
        if (this.cancled) return;

        // There are no relations more to be had, emit the other members
        if (this.launchedRelations.isEmpty()) {
            this.logger.debug("No more launched relations");
            let member = this.members.pop();
            while (member) {
                this.notifier.member(member, {});
                member = this.members.pop();
            }

            if (this.polling) {
                this.logger.debug("Polling is enabled, settings timeout");
                setTimeout(() => {
                    if (this.cancled) return;

                    this.notifier.pollCycle({}, {});
                    const toPollArray = this.toPoll.toArray();
                    this.logger.debug(
                        `Let's repoll (${JSON.stringify(
                            toPollArray.map((x) => x.chain.target),
                        )})`,
                    );
                    this.toPoll.clear();

                    for (const rel of toPollArray) {
                        this.launchedRelations.push(rel.chain);
                        this.findOrDefault(rel.chain).inFlight += 1;
                        this.findOrDefault(rel.chain).closed = false;
                        this.modulator.push(rel);
                    }
                }, this.pollInterval || 1000);
            } else {
                this.logger.debug("Closing the notifier, polling is not set");
                this.cancled = true;
                this.notifier.close({}, {});
            }
        }
    }

    private findOrDefault(chain: RelationChain): StateItem {
        const out = this.state.find((x) => x.rel.ordering(chain) == 0);
        if (out) {
            return out;
        }

        const nel = { rel: chain, inFlight: 0, extracting: 0, closed: false };
        this.state.push(nel);
        return nel;
    }

    /**
     * Extracting basic information from the relation, according to the current configuration
     * Sorting in ascending order: if a relation comes in with a LT relation, then that relation important, because it can be handled later
     * Sorting in descending order: if a relation comes in with a GT relation, then that relation important, because it can be handled later
     */
    private extractRelation(rel: Relations): SimpleRelation {
        const val = (s: string) => {
            try {
                return new Date(s);
            } catch (_ex: unknown) {
                return s;
            }
        };
        let value = undefined;

        if (this.ordered === "ascending") {
            value = rel.relations
                .filter((x) => GTRs.some((gr) => x.type.value === gr.value))
                .filter((a) => a.value)
                .map((a) => <undefined | number | Date>val(a.value![0].value))
                .reduce((a, b) => {
                    if (!a) return b;
                    if (!b) return a;
                    if (a > b) {
                        return b;
                    } else {
                        return a;
                    }
                }, undefined);
        } else if (this.ordered === "descending") {
            value = rel.relations
                .filter((x) => LTR.some((gr) => x.type.value === gr.value))
                .filter((a) => a.value)
                .map((a) => <undefined | number | Date>val(a.value![0].value))
                .reduce((a, b) => {
                    if (!a) return b;
                    if (!b) return a;
                    if (a > b) {
                        return a;
                    } else {
                        return b;
                    }
                }, undefined);
        }
        if (value !== undefined) {
            return {
                important: true,
                value,
            };
        } else {
            return {
                important: false,
                value: 0,
            };
        }
    }

    private fetch(rel: RelationChain, expected: string[]) {
        this.launchedRelations.push(rel);
        this.findOrDefault(rel).inFlight += 1;
        this.modulator.push({ chain: rel, expected });
    }

    private handleFetched(page: FetchedPage, relation: RelationChain) {
        this.fetchedPages.push({ page, relation });

        // Update internal state
        // Page is fetched and will now be extracted
        const found = this.findOrDefault(relation);
        found.extracting += 1;
        found.inFlight -= 1;

        this.manager.extractMembers(page, relation, this.memberNotifer);
    }

    /**
     * Maybe we can emit a member
     * Only the case when our current relation is important
     */
    private checkEmit() {
        let head = this.launchedRelations.pop();
        while (head) {
            // Earlier we looked at head.relations[0] whether or not that relation was important
            // I don't think that was correct, because we actually want to check if the next relation will be important, so we can already emit member from this page
            // root -GTE 3> first. When root is handled it will see important marker (>3), as the next relation, thus already emitting member <3
            const marker = this.launchedRelations.peek()?.relations[0] || {
                value: 0,
                important: false,
            };

            const found = this.findOrDefault(head);

            // If this relation still has things in transit, or getting extracted, we must wait
            if (found.inFlight != 0 || found.extracting != 0) {
                break;
            }

            // Actually emit some members in order
            if (marker.important) {
                found.closed = true;
                let member = this.members.pop();
                while (member) {
                    // Euhm yeah, what to do if there is no timestamp?
                    if (!member.timestamp) {
                        this.notifier.member(member, {});
                    } else if (
                        this.ordered == "ascending"
                            ? member.timestamp < marker.value
                            : member.timestamp > marker.value
                    ) {
                        this.notifier.member(member, {});
                    } else {
                        break;
                    }
                    member = this.members.pop();
                }

                // This member failed, let's put him back
                if (member) {
                    this.members.push(member);
                }
            }

            head = this.launchedRelations.pop();
        }

        if (head) {
            this.launchedRelations.push(head);
        }

        this.checkEnd();
    }
}
