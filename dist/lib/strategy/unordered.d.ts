import { Manager } from "../memberManager";
import { Fetcher } from "../pageFetcher";
import { ModulatorFactory, Notifier } from "../utils";
import { StrategyEvents } from ".";
export declare class UnorderedStrategy {
    private manager;
    private fetcher;
    private notifier;
    private inFlight;
    private fetchNotifier;
    private memberNotifier;
    private modulator;
    private cacheList;
    private polling;
    private pollInterval?;
    private cancled;
    constructor(memberManager: Manager, fetcher: Fetcher, notifier: Notifier<StrategyEvents, {}>, modulatorFactory: ModulatorFactory, polling: boolean, pollInterval?: number);
    start(url: string): void;
    cancle(): void;
    private handleFetched;
    private checkEnd;
}
