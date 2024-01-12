import { Manager, MemberEvents } from "../memberManager";
import { FetchedPage, Fetcher, FetchEvent } from "../pageFetcher";
import { Modulator, ModulatorFactory, Notifier, Ranker } from "../utils";

import { StrategyEvents } from ".";

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
