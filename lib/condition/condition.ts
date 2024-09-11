import { Quad, Term } from "@rdfjs/types";
import { NamedNode, Parser } from "n3";
import { BasicLensM, Cont, extractShapes } from "rdf-lens";
import { RdfStore } from "rdf-stores";
import { Member } from "../page";
import { TREE } from "@treecg/types";
import { SHAPES } from "./shapes";
import { cbdEquals, Path } from "./range";
import { getLoggerFor } from "../utils/logUtil";

type RdfThing = {
    entry: Term;
    quads: Quad[];
};

export interface Condition {
    matchRelation(
        range: Range | undefined,
        cbdId: Path,
    ): boolean;

    matchMember(member: Member): boolean;

    toString(): string;
}

export function empty_condition(): Condition {
    return new EmptyCondition();
}

export function parse_condition(source: string, baseIRI: string): Condition {
    const shapeQuads = new Parser().parse(SHAPES);
    const output = extractShapes(shapeQuads, {
        "https://w3id.org/tree#And": (obj: any) => new AndCondition(obj),
        "https://w3id.org/tree#Or": (obj: any) => new OrCondition(obj),
        "https://w3id.org/tree#Condition": (obj: any) => new LeafCondition(obj),
    });

    const dataQuads = new Parser({ baseIRI: baseIRI }).parse(source);

    return <Condition>output.lenses[
        "https://w3id.org/rdf-lens/ontology#TypedExtract"
        ].execute({
        quads: dataQuads,
        id: new NamedNode(baseIRI),
    });
}

type CompareTypes = "string" | "date" | "integer" | "float";

export class Range {
    min?: any;
    eqMin: boolean = true;

    max?: any;
    eqMax: boolean = true;

    constructor(value: any, type: string) {
        switch (type) {
            case TREE.EqualToRelation:
                this.min = value;
                this.max = value;
                return;
            case TREE.LessThanRelation:
                this.max = value;
                this.eqMax = false;
                return;
            case TREE.LessThanOrEqualToRelation:
                this.max = value;
                return;
            case TREE.GreaterThanRelation:
                this.min = value;
                this.eqMin = false;
                return;
            case TREE.GreaterThanOrEqualToRelation:
                this.min = value;
                return;
        }
    }

    static empty(): Range {
        return new Range(null, TREE.Relation);
    }

    add(value: any, type: string) {
        switch (type) {
            case TREE.EqualToRelation:
                this.min = value;
                this.max = value;
                return;
            case TREE.LessThanRelation:
                if (!this.max || value < this.max) {
                    this.max = value;
                    this.eqMax = false;
                }
                return;
            case TREE.LessThanOrEqualToRelation:
                if (!this.max || value < this.max) {
                    this.max = value;
                }
                return;
            case TREE.GreaterThanRelation:
                if (!this.min || value > this.min) {
                    this.min = value;
                    this.eqMin = false;
                }
                return;
            case TREE.GreaterThanOrEqualToRelation:
                if (!this.min || value > this.min) {
                    this.min = value;
                }
                return;
        }
    }

    contains(value: any): boolean {
        if (this.min) {
            if (this.eqMin) {
                if (this.min > value) return false;
            } else {
                if (this.min >= value) return false;
            }
        }
        if (this.max) {
            if (this.eqMax) {
                if (this.max < value) return false;
            } else {
                if (this.max <= value) return false;
            }
        }
        return true;
    }

    overlaps(other: Range): boolean {
        if (this.min && other.max) {
            if (this.eqMin && other.eqMax) {
                if (this.min > other.max) return false;
            } else {
                if (this.min >= other.max) return false;
            }
        }

        if (this.max && other.min) {
            if (this.eqMax && other.eqMin) {
                if (other.min > this.max) return false;
            } else {
                if (other.min >= this.max) return false;
            }
        }

        return true;
    }

    toString(valueToString?: (value: any) => string): string {
        const vts = valueToString || ((x: any) => x.toString());
        const comma = !!this.min && !!this.max ? "," : "";
        const start = this.min ? (this.eqMin ? "[" : "(") + vts(this.min) : "]";
        const end = this.max ? vts(this.max) + (this.eqMax ? "]" : ")") : "[";
        return start + comma + end;
    }
}

export class LeafCondition implements Condition {
    relationType: Term;
    value: string;
    compareType: CompareTypes;

    path: BasicLensM<Cont, Cont>;
    pathQuads: Path;

    range: Range;

    private logger = getLoggerFor(this);

    constructor(inp: {
        relationType: Term;
        value: string;
        compareType?: string;
        path: BasicLensM<Cont, Cont>;
        pathQuads: RdfThing;
    }) {
        this.relationType = inp.relationType;
        this.value = inp.value;
        this.compareType = <CompareTypes>inp.compareType || "string";
        this.path = inp.path;
        const store = RdfStore.createDefault();
        inp.pathQuads.quads.forEach((x) => store.addQuad(x));
        this.pathQuads = { id: inp.pathQuads.entry, store };

        this.range = new Range(this.parseValue(inp.value), inp.relationType.value);
    }

    toString(): string {
        const vts =
            this.compareType === "date" ? (x: Date) => x.toISOString() : undefined;
        return `${this.pathQuads.id.value} ∈ ${this.range.toString(vts)}`;
    }

    matchRelation(
        range: Range | undefined,
        cbdId: Path,
    ): boolean {
        if (!cbdEquals(this.pathQuads, cbdId)) {
            return true;
        }
        if (!range) {
            this.logger.debug("[matchRelation] Range is here also undefined, returning false");
            return false;
        }

        const vts = this.compareType === "date" ? (x: Date) => new Date(x).toISOString() : undefined;
        this.logger.verbose(`${this.range.toString(vts)} contains ${range.toString(vts)}. Overlaps: ${this.range.overlaps(range)}`);

        return this.range.overlaps(range);
    }

    matchMember(member: Member): boolean {
        const value = this.parseValue(this.path.execute(member)[0].id.value);
        return this.range.contains(value);
    }

    private parseValue(value: string): any {
        switch (this.compareType) {
            case "string":
                return value;
            case "date":
                return new Date(value);
            case "integer":
                return parseInt(value);
            case "float":
                return parseFloat(value);
            default:
                return value;
        }
    }
}

abstract class BiCondition implements Condition {
    alpha: Condition;
    beta: Condition;

    private logger = getLoggerFor(this);

    constructor(inp: { alpha: Condition; beta: Condition }) {
        this.alpha = inp.alpha;
        this.beta = inp.beta;
    }

    abstract combine(alpha: boolean, beta: boolean): boolean;

    matchRelation(
        range: Range | undefined,
        cbdId: Path,
    ): boolean {
        const alpha = this.alpha.matchRelation(range, cbdId);
        const beta = this.beta.matchRelation(range, cbdId);

        this.logger.verbose(`> ${this.combine(alpha, beta)}`);

        return this.combine(alpha, beta);
    }

    matchMember(member: Member): boolean {
        const alpha = this.alpha.matchMember(member);
        const beta = this.beta.matchMember(member);
        return this.combine(alpha, beta);
    }
}

export class AndCondition extends BiCondition {
    combine(alpha: boolean, beta: boolean): boolean {
        return alpha && beta; // TODO those might be null if something cannot make a statement about it, important for not condition
    }

    toString(): string {
        return `(${this.alpha.toString()} ^ ${this.beta.toString()})`;
    }
}

export class OrCondition extends BiCondition {
    combine(alpha: boolean, beta: boolean): boolean {
        return alpha || beta; // TODO those might be null if something cannot make a statement about it, important for not condition
    }

    toString(): string {
        return `(${this.alpha.toString()} V ${this.beta.toString()})`;
    }
}

export class EmptyCondition implements Condition {
    private logger = getLoggerFor(this);

    matchRelation(_range: Range, _cbdId: Path): boolean {
        this.logger.verbose("[matchRelation] Returning true");
        return true;
    }

    matchMember(_member: Member): boolean {
        return true;
    }

    toString() {
        return "all";
    }
}
