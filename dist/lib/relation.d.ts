export type SimpleRelation = {
    important: boolean;
    value: any;
};
/**
 * This relation chain is important to better understand the order of fragments to fetch
 * First fetch all not important relations
 * Then fetch an important relation with the smallest value (for timestamp path)
 * This new relation can access other unimportant relations, but these should only be fetched after full unimportant relation chains
 */
export declare class RelationChain {
    source: string;
    relations: SimpleRelation[];
    target: string;
    private cmp?;
    constructor(source: string, target: string, relations?: SimpleRelation[], additional?: SimpleRelation, cmp?: (a: any, b: any) => number);
    push(target: string, relation: SimpleRelation): RelationChain;
    important(): boolean;
    /**
     * If the returned number is less than 0, it indicates that the first item should come before the second item in the sorted order.
     * If the returned number is greater than 0, it indicates that the first item should come after the second item in the sorted order.
     * If the returned number is equal to 0, it means that the two items are considered equivalent in terms of sorting order.
     */
    ordering(other: RelationChain): number;
}
