import { Literal, Quad, Term } from "@rdfjs/types";
import { RdfStore } from "rdf-stores";
import { getObjects } from "../utils";
import { RDF, TREE } from "@treecg/types";
import { Condition, Range } from "./condition";
import { getLoggerFor } from "../utils/logUtil";

export type Path = {
    store: RdfStore;
    id: Term;
};

export function cbdEquals(a: Path, b: Path): boolean {
    const sort = (a: Quad, b: Quad) => {
        const ap = a.predicate.value;
        const bp = b.predicate.value;
        if (ap == bp) return 0;
        return ap < bp ? -1 : 1;
    };
    const alphaQuads = a.store.getQuads(a.id, null, null, null).sort(sort);
    const betaQuads = b.store.getQuads(b.id, null, null, null).sort(sort);

    if (alphaQuads.length != betaQuads.length) return false;

    for (let i = 0; i < alphaQuads.length; i++) {
        if (!alphaQuads[i].predicate.equals(betaQuads[i].predicate)) return false;

        const av = alphaQuads[i].object;
        const bv = betaQuads[i].object;

        if (av.termType !== bv.termType) return false;
        if (av.termType === "BlankNode") {
            if (!cbdEquals({ id: av, store: a.store }, { id: bv, store: b.store })) {
                return false;
            }
        } else {
            if (av.value !== bv.value) {
                return false;
            }
        }
    }

    return true;
}

type PathRange = {
    cbdEntry: Term;
    range?: Range;
};

export class RelationCondition {
    store: RdfStore<any, Quad>;

    defaultTimezone: string;

    ranges: PathRange[] = [];

    constructor(store: RdfStore<any, Quad>, defaultTimezone: string) {
        this.store = store;
        this.defaultTimezone = defaultTimezone;
    }

    allowed(condition: Condition): boolean {
        return this.ranges.every((x) => {
            /*if (!x.range) {
              console.log("range is undefined!", condition);
            }*/
            return condition.matchRelation(
                x.range,
                { id: x.cbdEntry, store: this.store }
            );
        });
    }

    addRelation(relationId: Term) {
        const ty =
            getObjects(this.store, relationId, RDF.terms.type, null)[0] ||
            TREE.Relation;
        const path = getObjects(this.store, relationId, TREE.terms.path, null)[0];
        const value = getObjects(this.store, relationId, TREE.terms.value, null)[0];

        //console.log("Add relation", { ty, path, value });

        let range = this.ranges.find((range) =>
            cbdEquals(
                { id: path, store: this.store },
                { id: range.cbdEntry, store: this.store },
            ),
        );

        if (!range) {
            const newRange: PathRange = {
                cbdEntry: path,
                range: Range.empty(this.defaultTimezone),
            };
            this.ranges.push(newRange);
            range = newRange;
        }

        if (!value) {
            range.range = undefined;
            return;
        }

        range.range?.add(value.value, ty.value);
    }
}
