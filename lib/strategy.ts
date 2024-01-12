import Heap from "heap-js";
import { Manager, MemberEvents } from "./memberManager";
import { Member, Relation } from "./page";
import { FetchedPage, Fetcher, FetchEvent } from "./pageFetcher";
import { Modulator, ModulatorFactory, Notifier, Ranker } from "./utils";
import { RelationChain, SimpleRelation } from "./relation";
import { TREE } from "@treecg/types";

import debug from "debug";
import { Ordered } from "./client";
const log = debug("strategy");

/**
 * Predicates representing greater than relations
 */
const GTRs = [
  TREE.terms.GreaterThanRelation,
  TREE.terms.GreaterThanOrEqualRelation,
];

/**
 * Predicates representing less than relations
 */
const LTR = [TREE.terms.LessThanRelation, TREE.terms.LessThanOrEqualToRelation];

type PageAndRelation = {
  page: FetchedPage;
  relation: RelationChain;
};

type StateItem = {
  rel: RelationChain;
  closed: boolean;
  inFlight: number;
  extracting: number;
};

export type StrategyEvents = {
  member: Member;
  close: {};
};

export class OrderedStrategy {
  private members: Heap<Member>;

  private manager: Manager;
  private fetcher: Fetcher;

  // This can be T: controller or something
  private notifier: Notifier<StrategyEvents, {}>;

  // Contains a heap with all relations that have been launched
  // The heap will first handle unimportant relations,
  //   so when an important relation is handled, we can try to emit members
  //
  // With ordering ascending GT relations are important
  // With ordering descending LT relations are important
  private readonly launchedRelations: Heap<RelationChain>;

  private modulator: Modulator<{ chain: RelationChain; force?: boolean }>;

  private fetchNotifier: Notifier<FetchEvent, RelationChain>;
  private memberNotifer: Notifier<MemberEvents, RelationChain>;
  private fetchedPages: Heap<PageAndRelation>;
  private state: Array<StateItem>;

  private ordered: Ordered;

  private polling: boolean;
  private toPoll: Heap<RelationChain>;

  constructor(
    memberManager: Manager,
    fetcher: Fetcher,
    notifier: Notifier<StrategyEvents, {}>,
    factory: ModulatorFactory,
    ordered: Ordered,
    polling: boolean,
  ) {
    const logger = log.extend("constructor");
    this.ordered = ordered;
    this.manager = memberManager;
    this.fetcher = fetcher;
    this.notifier = notifier;
    this.polling = polling;

    this.toPoll = new Heap((a, b) => a.ordering(b));
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
      scheduleFetch: (_url, chain) => {
        this.toPoll.push(chain);
      },
      seen: (_, relation) => {
        this.modulator.finished();
        this.launchedRelations.remove(relation, (a, b) => a.ordering(b) === 0);
        logger("Already seen %s", relation.target);
        // We put the same relation multiple times in launchedRelations, but only once with findOrDefault
        // This keeps track of how many are in transit / member extracting
        const found = this.findOrDefault(relation);
        found.inFlight -= 1;
        this.checkEmit();
      },
      pageFetched: (page, relation) => {
        logger("Page fetched %s", page.url);
        this.modulator.finished();
        this.handleFetched(page, relation);
      },
      relationFound: (rel, chain) => {
        logger("Relation found %s", rel.node);
        const newChain = chain.push(rel.node, this.extractRelation(rel));
        this.fetch(newChain);
      },
    };

    // Callbacks for member manager
    // - done: extracting is done, indicate this
    // - extract: a member is extracted, add it to our heap
    this.memberNotifer = {
      done: (_member, rel) => {
        logger("Member done %s", rel.target);
        const found = this.findOrDefault(rel);
        found.extracting -= 1;
        this.checkEmit();
      },
      extracted: (member) => {
        this.members.push(member);
      },
    };

    this.modulator = factory.create(
      new Heap((a, b) => a.chain.ordering(b.chain)),
      {
        ready: ({ chain, force }) => {
          this.fetcher.fetch(
            chain.target,
            force || false,
            chain,
            this.fetchNotifier,
          );
        },
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
    const logger = log.extend("start");
    logger("Starting at %s", url);
    const cmp = (a: string, b: string) => {
      if (a == b) return 0;
      if (a < b) return -1;
      return 1;
    };

    if (this.ordered === "ascending") {
      this.fetch(
        new RelationChain(url, [], undefined, (a, b) => cmp(a, b)).push(url, {
          important: false,
          value: 0,
        }),
      );
    } else {
      this.fetch(
        new RelationChain(url, [], undefined, (a, b) => -1 * cmp(a, b)).push(
          url,
          { important: false, value: 0 },
        ),
      );
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
  private extractRelation(rel: Relation): SimpleRelation {
    const val = (s: string) => {
      try {
        return new Date(s);
      } catch (ex: any) {
        return s;
      }
    };
    if (this.ordered === "ascending" && GTRs.some((x) => rel.type.equals(x))) {
      return {
        important: true,
        // Maybe this should create a date
        value: val(rel.value![0].value),
      };
    } else if (
      this.ordered === "descending" &&
      LTR.some((x) => rel.type.equals(x))
    ) {
      return {
        important: true,
        // Maybe this should create a date
        value: val(rel.value![0].value),
      };
    } else {
      return {
        important: false,
        value: 0,
      };
    }
  }

  private fetch(rel: RelationChain) {
    this.launchedRelations.push(rel);
    this.findOrDefault(rel).inFlight += 1;
    this.modulator.push({ chain: rel });
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
      const marker = head.relations[0] || { value: 0, important: false };
      const found = this.findOrDefault(head);

      // If this relation still has things in transit, or getting extracted, we must wait
      if (found.inFlight != 0 || found.extracting != 0) {
        break;
      }

      if (found.closed) {
        console.error("Found should never be closed before this moment");
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

  checkEnd() {
    const logger = log.extend("checkEnd");

    // There are no relations more to be had, emit the other members
    if (this.launchedRelations.isEmpty()) {
      logger("No more launched relations");
      let member = this.members.pop();
      while (member) {
        this.notifier.member(member, {});
        member = this.members.pop();
      }

      if (this.polling) {
        logger("Polling is enabled, settings timeout");
        setTimeout(() => {
          const toPollArray = this.toPoll.toArray();
          logger("Let's repoll (%o)", toPollArray.map(x => x.target));
          this.toPoll.clear();

          for (let rel of toPollArray) {
            this.launchedRelations.push(rel);
            this.findOrDefault(rel).inFlight += 1;
            this.modulator.push({ chain: rel, force: true });
          }
        }, 1000);
      } else {
        logger("Closing the notifier, polling is not set");
        this.notifier.close({}, {});
      }
    }
  }
}

export class UnorderedStrategy {
  private manager: Manager;
  private fetcher: Fetcher;
  private notifier: Notifier<StrategyEvents, {}>;

  private inFlight: number = 0;

  private fetchNotifier: Notifier<FetchEvent, {}>;
  private memberNotifier: Notifier<MemberEvents, {}>;

  private modulator: Modulator<{ url: string; force?: boolean }>;

  private cacheList: string[] = [];
  private polling: boolean;

  constructor(
    memberManager: Manager,
    fetcher: Fetcher,
    notifier: Notifier<StrategyEvents, {}>,
    modulatorFactory: ModulatorFactory,
    polling: boolean,
  ) {
    this.notifier = notifier;
    this.manager = memberManager;
    this.fetcher = fetcher;
    this.polling = polling;

    // Callbacks for the fetcher
    // - seen: the strategy wanted to fetch an uri, but it was already seen
    //         so one fetch request is terminated, inFlight -= 1
    // - pageFetched: a complete page is fetched and the relations have been extracted
    //         start member extraction
    // - relationFound: a relation has been found, inFlight += 1 and put it in the queueu
    this.fetchNotifier = {
      scheduleFetch: (url: string) => {
        this.cacheList.push(url);
      },
      seen: () => {
        this.inFlight -= 1;
        this.checkEnd();
        this.modulator.finished();
      },
      pageFetched: (page) => this.handleFetched(page),
      relationFound: (rel) => {
        this.inFlight += 1;
        this.modulator.push({ url: rel.node });
      },
    };

    // Callbacks for the member extractor
    // - done: all members have been extracted, we are finally done with a page inFlight -= 1
    // - extracted: a member has been found, yeet it
    this.memberNotifier = {
      done: () => {
        this.inFlight -= 1;
        this.checkEnd();
      },
      extracted: (mem) => this.notifier.member(mem, {}),
    };

    // Create a modulator, fancy name for something that can pause if we found enough members
    this.modulator = modulatorFactory.create(
      <Ranker<{ url: string; force?: boolean }>>[],
      {
        ready: (f) =>
          this.fetcher.fetch(f.url, f.force || false, {}, this.fetchNotifier),
      },
    );
  }

  start(url: string) {
    this.inFlight = 1;
    this.modulator.push({ url });
  }

  private handleFetched(page: FetchedPage) {
    this.modulator.finished();
    this.manager.extractMembers(page, {}, this.memberNotifier);
  }

  private checkEnd() {
    if (this.inFlight == 0) {
      if (this.polling) {
        setTimeout(() => {
          const cl = this.cacheList.slice();
          this.cacheList = [];
          for (let cache of cl) {
            this.inFlight += 1;
            this.modulator.push({ url: cache, force: true });
          }
        }, 1000);
      } else {
        console.log("Closing notifier");
        this.notifier.close({}, {});
      }
    }
  }
}
