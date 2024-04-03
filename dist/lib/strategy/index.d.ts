import { Member } from "../page";
import { FetchedPage } from "../pageFetcher";
import { RelationChain } from "../relation";
export { UnorderedStrategy } from "./unordered";
export { OrderedStrategy } from "./ordered";
/**
 * Predicates representing greater than relations
 */
export declare const GTRs: import("rdf-js").NamedNode<string>[];
/**
 * Predicates representing less than relations
 */
export declare const LTR: import("rdf-js").NamedNode<string>[];
export type PageAndRelation = {
    page: FetchedPage;
    relation: RelationChain;
};
export type StrategyEvents = {
    member: Member;
    fragment: {};
    mutable: {};
    pollCycle: {};
    close: {};
    error: any;
};
