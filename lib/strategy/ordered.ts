import { Heap } from "heap-js";
import { TREE } from "@treecg/types";
import { Fetcher, ModulatorFactory, RelationChain, Manager } from "../fetcher";
import { parseInBetweenRelation, getLoggerFor, deserializeMember, serializeMember } from "../utils";
import { GTRs, LTR } from "./types";

import type {
    Member,
    Relations,
    RelationValue,
    FetchedPage,
    FetchEvent,
    Notifier,
    SimpleRelation,
    MemberEvents,
    Modulator
} from "../fetcher";
import type { StrategyEvents, Ordered, SerializedMember } from ".";

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

    private modulator: Modulator<
        { chain: RelationChain; expected: string[] },
        SerializedMember
    >;
    private fetchNotifier: Notifier<
        FetchEvent,
        { chain: RelationChain; index: number }
    >;
    private memberNotifier: Notifier<
        MemberEvents,
        {
            chain: RelationChain;
            index: number;
            emitted: ReadonlySet<string>
        }
    >;

    private ordered: Ordered;

    private polling: boolean;
    private toPoll: Heap<{ chain: RelationChain; expected: string[] }>;
    private pollInterval?: number;
    private pollingIsScheduled: boolean;

    private canceled = false;

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
        this.pollingIsScheduled = false;

        this.toPoll = new Heap((a, b) => a.chain.ordering(b.chain));
        this.launchedRelations = new Heap((a, b) => a.ordering(b));

        // Callbacks for the fetcher
        // - scheduleFetch: a mutable page was fetched, we keep track of it for future polling
        // - pageFetched: a complete page is fetched and the relations have been extracted
        //         start member extraction
        // - relationFound: a relation has been found, put the extended chain in the queue
        this.fetchNotifier = {
            error: (error: unknown) => {
                this.notifier.error(error, {});
            },
            scheduleFetch: ({ target, expected }, { chain }) => {
                this.logger.debug(`[fetchNotifier - scheduleFetch] Scheduling fetch for mutable page: ${target}`);
                chain.target = target;
                this.toPoll.push({ chain, expected });
                // Register in the state that this page needs to be refetched in the future
                this.modulator.recordMutable(target, { chain, expected });
                this.notifier.mutable({}, {});
            },
            pageFetched: (page, state) => {
                this.logger.debug(`[fetchNotifier - pageFetched] Page fetched ${page.url}`);
                this.handleFetched(page, state);
            },
            relationFound: ({ from, target }, { chain }) => {
                from.expected.push(target.node);
                this.logger.debug(`[fetchNotifier - relationFound] Relation found ${target.node}`);
                const newChain = chain.push(
                    target.node,
                    this.extractRelation(target),
                );
                if (newChain.ordering(chain) >= 0) {
                    // Only launch the fetching of this relation if it hasn't been launched already
                    if (!this.launchedRelations.contains(newChain, (e, o) => e.target === o.target)) {
                        this.fetch(newChain, [from.target]);
                    }
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
            done: (fragment: FetchedPage, { chain, index }) => {
                this.logger.debug(`[memberNotifier - done] Member extraction done for ${chain.target}`);
                this.modulator.finished(index);
                this.notifier.fragment(fragment, {});

                if (fragment.immutable) {
                    this.logger.debug(`[memberNotifier - done] Remembering immutable page to avoid future refetching: ${fragment.url}`);
                    this.modulator.recordImmutable(fragment.url);
                }

                this.checkEmit();
            },
            extracted: (member) => {
                // Only proceed to emit if the member is not already in process of being emitted
                if (!this.members.contains(member, (e, o) => e.id.value === o.id.value)) {
                    this.members.push(member);
                    // Register extracted member in the unemitted list
                    this.modulator.recordUnemitted(member.id.value, serializeMember(member));
                }
            },
        };

        this.modulator = factory.create(
            "fetcher",
            new Heap((a, b) => a.item.chain.ordering(b.item.chain)),
            {
                ready: ({ item: { chain, expected }, index }) => {
                    if (!this.modulator.seen(chain.target)) {
                        this.logger.debug(`[modulator - ready] Ready to fetch page: ${chain.target}`);
                        this.fetcher.fetch(
                            { target: chain.target, expected },
                            { chain, index },
                            this.fetchNotifier,
                        );
                    } else {
                        this.logger.debug(`[modulator - ready] Skipping fetch for previously fetched immutable page: ${chain.target}`);
                        this.modulator.finished(index);
                        // See if we can emit some members or end the process
                        this.checkEmit();
                    }
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
                        ? (a: RelationValue, b: RelationValue) => {
                            if (a > b) return 1;
                            if (a < b) return -1;
                            return 0;
                        }
                        : (a: RelationValue, b: RelationValue) => {
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

    start(url: string, root?: FetchedPage) {
        // Check for any unemitted members from a previous run
        const unemitted = this.modulator.getUnemitted();
        if (unemitted.length > 0) {
            this.logger.debug(`[start] Found ${unemitted.length} unemitted members in the saved state`);
            unemitted
                .map(deserializeMember)
                .forEach((member) => this.members.push(member));
        }

        if (root) {
            // This is a local dump. Proceed to extract members
            this.manager.extractMembers(
                root,
                {
                    chain: new RelationChain("", ""),
                    index: 0,
                    emitted: new Set<string>()
                },
                this.memberNotifer
            );
        } else if (this.modulator.length() < 1) {
            this.logger.debug(`[start] Starting at ${url}`);
            const cmp = (a: RelationValue, b: RelationValue) => {
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
        } else {
            this.logger.debug(
                "[start] Things are already inflight, not adding start url",
            );
        }
    }

    cancel() {
        this.canceled = true;
    }

    checkEnd() {
        if (this.canceled) return;

        // There are no relations more to be had, emit the other members
        if (this.launchedRelations.isEmpty()) {
            this.logger.debug("[checkEnd] No more launched relations");
            let member = this.members.pop();
            while (member) {
                this.notifier.member(member, {});
                this.modulator.recordEmitted(member.id.value);
                member = this.members.pop();
            }

            // Make sure polling task is only scheduled once
            if (this.polling && !this.pollingIsScheduled) {
                this.logger.debug(`[checkEnd] Polling is enabled, setting timeout of ${this.pollInterval || 1000} ms to poll`);
                setTimeout(() => {
                    if (this.canceled) return;

                    this.pollingIsScheduled = false;
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
                        this.modulator.push(rel);
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
        const betweens = rel.relations
            .filter((x) => x.type.value === TREE.custom("InBetweenRelation"))
            .flatMap((x) => x.value || [])
            .flatMap((x) => {
                let dataType = undefined;
                if (x.termType === "Literal") {
                    dataType = x.datatype.value;
                }
                const between = parseInBetweenRelation(x.value, dataType, "Z");
                if (between) {
                    return [between];
                }
                return [];
            });

        if (this.ordered === "ascending") {
            value = betweens
                .map((x) => <undefined | number | Date>x.min)
                .reduce((a, b) => {
                    if (!a) return b;
                    if (!b) return a;
                    if (a > b) {
                        return b;
                    } else {
                        return a;
                    }
                }, value);
        }
        if (this.ordered === "descending") {
            value = betweens
                .map((x) => <undefined | number | Date>x.max)
                .reduce((a, b) => {
                    if (!a) return b;
                    if (!b) return a;
                    if (a > b) {
                        return a;
                    } else {
                        return b;
                    }
                }, value);
        }

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
                }, value);
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
                }, value);
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
        this.modulator.push({ chain: rel, expected });
    }

    private handleFetched(page: FetchedPage, state: { chain: RelationChain, index: number }) {
        // Page is fetched and will now be extracted
        this.manager.extractMembers(
            page,
            {
                emitted: this.modulator.getEmitted(),
                ...state
            },
            this.memberNotifer
        );
    }

    /**
     * Maybe we can emit a member
     * Only the case when our current relation is important
     */
    private checkEmit() {
        if (this.canceled) return;

        let head = this.launchedRelations.pop();
        while (head) {
            // Earlier we looked at head.relations[0] whether or not that relation was important
            // I don't think that was correct, because we actually want to check if the next relation will be important, so we can already emit member from this page
            // root -GTE 3> first. When root is handled it will see important marker (>3), as the next relation, thus already emitting member <3
            const marker = this.launchedRelations.peek()?.relations[0] || {
                value: 0,
                important: false,
            };

            // If this relation still has things in transit, or getting extracted, we must wait
            const inTransit = 
                this.modulator.getInFlight().find((x) => x.chain.ordering(head!) == 0)
                || this.modulator.getTodo().find((x) => x.chain.ordering(head!) == 0)

            if (inTransit) {
                break;
            }

            // Actually emit some members in order
            if (marker.important) {
                let member = this.members.pop();
                while (member) {
                    // Euhm yeah, what to do if there is no timestamp?
                    if (!member.timestamp) {
                        this.notifier.member(member, {});
                        this.modulator.recordEmitted(member.id.value);
                    } else if (
                        this.ordered == "ascending"
                            ? member.timestamp < marker.value
                            : member.timestamp > marker.value
                    ) {
                        this.notifier.member(member, {});
                        // Record member as emitted
                        this.modulator.recordEmitted(member.id.value);
                    } else {
                        break;
                    }
                    member = this.members.pop();
                }

                // This member failed, let's put him back
                if (member) {
                    this.members.push(member);
                    this.modulator.recordUnemitted(member.id.value, serializeMember(member));
                }
            }

            // At this point we are done with this relation
            head = this.launchedRelations.pop();
        }

        if (head) {
            this.launchedRelations.push(head);
        }

        this.checkEnd();
    }
}
