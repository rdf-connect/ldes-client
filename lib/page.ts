import { Quad, Term } from "@rdfjs/types";
import { RDF, TREE } from "@treecg/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { State } from "./state";
import { RdfStore } from "rdf-stores";
import { getObjects, memberFromQuads } from "./utils";
import { Condition } from "./condition";
import { RelationCondition } from "./condition/range";
import { getLoggerFor } from "./utils/logUtil";

export interface Member {
    id: Term;
    quads: Quad[];
    timestamp?: string | Date;
    isVersionOf?: string;
    type?: Term;
}

export interface Relations {
    source: string;
    node: string;
    relations: Relation[];
}

export interface Relation {
    id?: Term;
    type: Term;
    value?: Term[];
    path?: Term;
}

export interface Page {
    relations: Relation[];
    node: string;
}

export interface Fragment {
    id: Term;
    created?: Date;
    updated?: Date;
}

export function extractMembers(
    store: RdfStore,
    stream: Term,
    extractor: CBDShapeExtractor,
    state: State,
    cb: (member: Member) => void,
    shapeId?: Term,
    timestampPath?: Term,
    isVersionOfPath?: Term,
): Promise<void>[] {
    const members = getObjects(store, stream, TREE.terms.member, null);

    async function extractMember(member: Term) {
        const quads = await extractor.extract(store, member, shapeId);
        cb(memberFromQuads(member, quads, timestampPath, isVersionOfPath));
    }

    const out: Promise<void>[] = [];
    for (const member of members) {
        if (!state.seen(member.value)) {
            state.add(member.value);
            out.push(extractMember(member));
        }
    }

    return out;
}

export function extractRelations(
    store: RdfStore,
    node: Term,
    loose: boolean,
    condition: Condition,
    defaultTimezone: string,
): Relations[] {
    const logger = getLoggerFor("extractRelations");

    const relationIds = loose
        ? getObjects(store, null, TREE.terms.relation, null)
        : getObjects(store, node, TREE.terms.relation, null);

    const source = node.value;

    const conditions = new Map<
        string,
        { cond: RelationCondition; relation: Relations }
    >();

    for (const relationId of relationIds) {
        const node = getObjects(store, relationId, TREE.terms.node, null)[0];
        const ty =
            getObjects(store, relationId, RDF.terms.type, null)[0] ||
            TREE.Relation;
        const path = getObjects(store, relationId, TREE.terms.path, null)[0];
        const value = getObjects(store, relationId, TREE.terms.value, null);

        const relation = {
            type: ty,
            path,
            value,
            id: relationId,
        };
        const found = conditions.get(node.value);
        if (!found) {
            const condition = new RelationCondition(store, defaultTimezone);
            condition.addRelation(relationId);
            conditions.set(node.value, {
                cond: condition,
                relation: {
                    node: node.value,
                    source,
                    relations: [relation],
                },
            });
        } else {
            found.relation.relations.push(relation);
            found.cond.addRelation(relationId);
        }
    }

    const allowed = [];
    for (const cond of conditions.values()) {
        if (cond.cond.allowed(condition)) {
            allowed.push(cond.relation);
        }
    }

    logger.debug(`allowed ${JSON.stringify(allowed.map((x) => x.node))}`);
    return allowed;
}
