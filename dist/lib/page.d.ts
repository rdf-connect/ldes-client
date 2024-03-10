import { Quad, Term } from "@rdfjs/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { State } from "./state";
import { RdfStore } from "rdf-stores";
export interface Member {
    id: Term;
    quads: Quad[];
    timestamp?: string | Date;
    isVersionOf?: string;
    isLastOfTransaction?: boolean;
}
export interface Relation {
    source: string;
    node: string;
    type: Term;
    value?: Term[];
    path?: Term;
}
export interface Page {
    relations: Relation[];
    node: string;
}
export declare function extractMembers(store: RdfStore, stream: Term, extractor: CBDShapeExtractor, state: State, cb: (member: Member) => void, shapeId?: Term, timestampPath?: Term, isVersionOfPath?: Term): Promise<void>[];
export declare function extractRelations(store: RdfStore, node: Term, loose: boolean, after?: Date, before?: Date): Relation[];
