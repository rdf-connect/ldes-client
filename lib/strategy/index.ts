import type { NamedNode } from "@rdfjs/types";
import { Fragment, Member } from "../page";
import { FetchedPage } from "../pageFetcher";
import { RelationChain } from "../relation";
import { TREE } from "@treecg/types";

export { UnorderedStrategy } from "./unordered";
export { OrderedStrategy } from "./ordered";

/**
 * Predicates representing greater than relations
 */
export const GTRs: NamedNode[] = [
    TREE.terms.GreaterThanRelation,
    TREE.terms.GreaterThanOrEqualToRelation,
];

/**
 * Predicates representing less than relations
 */
export const LTR: NamedNode[] = [
    TREE.terms.LessThanRelation,
    TREE.terms.LessThanOrEqualToRelation,
];

export type PageAndRelation = {
    page: FetchedPage;
    relation: RelationChain;
};

export type StrategyEvents = {
    member: Member;
    fragment: Fragment;
    /* eslint-disable  @typescript-eslint/no-empty-object-type */
    mutable: {};
    /* eslint-disable  @typescript-eslint/no-empty-object-type */
    pollCycle: {};
    /* eslint-disable  @typescript-eslint/no-empty-object-type */
    close: {};
    error: unknown;
};
