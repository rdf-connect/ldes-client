import { Member, Relation } from "../page";
import { FetchedPage } from "../pageFetcher";
import { RelationChain } from "../relation";
import { TREE } from "@treecg/types";

export { UnorderedStrategy } from "./unordered";
export { OrderedStrategy } from "./ordered";

/**
 * Predicates representing greater than relations
 */
export const GTRs = [
  TREE.terms.GreaterThanRelation,
  TREE.terms.GreaterThanOrEqualToRelation,
];

/**
 * Predicates representing less than relations
 */
export const LTR = [
  TREE.terms.LessThanRelation,
  TREE.terms.LessThanOrEqualToRelation,
];

export type PageAndRelation = {
  page: FetchedPage;
  relation: RelationChain;
};

export type StrategyEvents = {
  relation: Relation;
  member: Member;
  fragment: { url: string };
  mutable: {};
  pollCycle: {};
  close: {};
  error: any;
};
