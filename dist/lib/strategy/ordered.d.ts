import { Manager } from "../memberManager";
import { Fetcher } from "../pageFetcher";
import { ModulatorFactory, Notifier } from "../utils";
import { RelationChain } from "../relation";
import { Ordered } from "../client";
import { StrategyEvents } from ".";
export type StateItem = {
    rel: RelationChain;
    closed: boolean;
    inFlight: number;
    extracting: number;
};
export declare class OrderedStrategy {
    private members;
    private manager;
    private fetcher;
    private notifier;
    private readonly launchedRelations;
    private modulator;
    private fetchNotifier;
    private memberNotifer;
    private fetchedPages;
    private state;
    private ordered;
    private polling;
    private toPoll;
    private pollInterval?;
    private cancled;
    constructor(memberManager: Manager, fetcher: Fetcher, notifier: Notifier<StrategyEvents, {}>, factory: ModulatorFactory, ordered: Ordered, polling: boolean, pollInterval?: number);
    start(url: string): void;
    cancle(): void;
    private findOrDefault;
    /**
     * Extracting basic information from the relation, according to the current configuration
     * Sorting in ascending order: if a relation comes in with a LT relation, then that relation important, because it can be handled later
     * Sorting in descending order: if a relation comes in with a GT relation, then that relation important, because it can be handled later
     */
    private extractRelation;
    private fetch;
    private handleFetched;
    /**
     * Maybe we can emit a member
     * Only the case when our current relation is important
     */
    private checkEmit;
    checkEnd(): void;
}
