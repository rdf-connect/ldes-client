import { Term } from "@rdfjs/types";
import { Member } from "./page";
import { FetchedPage } from "./pageFetcher";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { LDESInfo } from "./client";
import { Notifier } from "./utils";
export interface Options {
    ldesId?: Term;
    shapeId?: Term;
    callback?: (member: Member) => void;
    extractor?: CBDShapeExtractor;
}
export type ExtractedMember = {
    member: Member;
};
export type MemberEvents = {
    extracted: Member;
    done: Member[];
};
export declare class Manager {
    private members;
    queued: number;
    private resolve?;
    private ldesId;
    private currentPromises;
    private state;
    private extractor;
    private shapeMap?;
    private timestampPath?;
    private isVersionOfPath?;
    constructor(ldesId: Term, state: Set<string>, info: LDESInfo);
    close(): Promise<void>;
    length(): number;
    private extractMember;
    extractMembers<S>(page: FetchedPage, state: S, notifier: Notifier<MemberEvents, S>): void;
    reset(): Promise<void>;
}
