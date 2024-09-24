import { Quad, Term } from "@rdfjs/types";
import { NamedNode, Parser } from "n3";
import { BasicLensM, Cont, extractShapes } from "rdf-lens";
import { RdfStore } from "rdf-stores";
import { Member } from "../page";
import { TREE, XSD } from "@treecg/types";
import { SHAPES } from "./shapes";
import { cbdEquals, Path } from "./range";
import { getLoggerFor } from "../utils/logUtil";

type RdfThing = {
    entry: Term;
    quads: Quad[];
};

export interface Condition {
    matchRelation(range: Range | undefined, cbdId: Path): boolean;

    matchMember(member: Member): boolean;

    toString(): string;
}

export function empty_condition(): Condition {
    return new EmptyCondition();
}

export function parse_condition(source: string, baseIRI: string): Condition {
    const shapeQuads = new Parser().parse(SHAPES);
    const output = extractShapes(shapeQuads, {
        "http://vocab.deri.ie/csp#And": (obj) =>
            new AndCondition(
                <ConstructorParameters<typeof AndCondition>[0]>obj,
            ),
        "http://vocab.deri.ie/csp#Or": (obj) =>
            new OrCondition(<ConstructorParameters<typeof OrCondition>[0]>obj),
        "http://vocab.deri.ie/csp#Condition": (obj) =>
            new LeafCondition(
                <ConstructorParameters<typeof LeafCondition>[0]>obj,
            ),
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
export type Value = string | Date | number;

export class Range {
    min?: Value;
    eqMin: boolean = true;

    max?: Value;
    eqMax: boolean = true;

    private logger = getLoggerFor(this);

    private defaultTimezone: string;

    constructor(
        value: Value,
        type: string,
        defaultTimezone: string,
        dataType?: string,
    ) {
        const tzRegex = /^(AoE|Z|[+-]((0[0-9]|1[0-3]):([0-5][0-9])|14:00))$/;
        if (!tzRegex.test(defaultTimezone)) {
            this.logger.warn(
                `Invalid timezone: '${defaultTimezone}'. Using default Anywhere on Earth (AoE) instead.`,
            );
            this.defaultTimezone = "AoE";
        } else {
            this.defaultTimezone = defaultTimezone;
        }
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
            case TREE.custom("InBetweenRelation"):
                if (typeof value !== "string") {
                    throw (
                        "InBetweenRelation can only handle string values, not" +
                        typeof value
                    );
                }
                if (dataType === XSD.custom("gYear")) {
                    const result = this.gYearToMinMax(value);
                    if (!result) return;
                    [this.min, this.max] = result;
                    this.eqMin = true;
                    this.eqMax = false;
                } else if (dataType === XSD.custom("gYearMonth")) {
                    const result = this.gYearMonthToMinMax(value);
                    if (!result) return;
                    [this.min, this.max] = result;
                    this.eqMin = true;
                    this.eqMax = false;
                } else if (dataType === XSD.custom("date")) {
                    const result = this.dateToMinMax(value);
                    if (!result) return;
                    [this.min, this.max] = result;
                    this.eqMin = true;
                    this.eqMax = false;
                } else {
                    // Check if it is a partial dateTime.
                    const result = this.partialDateTimeToMinMax(value);
                    if (!result) return;
                    [this.min, this.max] = result;
                    this.eqMin = true;
                    this.eqMax = false;
                }
                return;
        }
    }

    static empty(defaultTimezone: string): Range {
        return new Range("", TREE.Relation, defaultTimezone);
    }

    add(value: string, type: string, dataType?: string) {
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
            case TREE.custom("InBetweenRelation"):
                if (dataType === XSD.custom("gYear")) {
                    const result = this.gYearToMinMax(value);
                    if (!result) return;
                    const [min, max] = result;
                    if (!this.min || min <= this.min) {
                        this.min = min;
                        this.eqMin = true;
                    }
                    if (!this.max || max > this.max) {
                        this.max = max;
                        this.eqMax = false;
                    }
                } else if (dataType === XSD.custom("gYearMonth")) {
                    const result = this.gYearMonthToMinMax(value);
                    if (!result) return;
                    const [min, max] = result;
                    if (!this.min || min <= this.min) {
                        this.min = min;
                        this.eqMin = true;
                    }
                    if (!this.max || max > this.max) {
                        this.max = max;
                        this.eqMax = false;
                    }
                } else if (dataType === XSD.custom("date")) {
                    const result = this.dateToMinMax(value);
                    if (!result) return;
                    const [min, max] = result;
                    if (!this.min || min <= this.min) {
                        this.min = min;
                        this.eqMin = true;
                    }
                    if (!this.max || max > this.max) {
                        this.max = max;
                        this.eqMax = false;
                    }
                } else {
                    // Check if it is a partial dateTime
                    const result = this.partialDateTimeToMinMax(value);
                    if (!result) return;
                    const [min, max] = result;
                    if (!this.min || min <= this.min) {
                        this.min = min;
                        this.eqMin = true;
                    }
                    if (!this.max || max > this.max) {
                        this.max = max;
                        this.eqMax = false;
                    }
                }
                return;
        }
    }

    contains(value: string | Date | number): boolean {
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

    toString(valueToString?: (value: Value) => string): string {
        const vts = valueToString || ((x: Value) => x.toString());
        const comma = !!this.min && !!this.max ? "," : "";
        const start = this.min ? (this.eqMin ? "[" : "(") + vts(this.min) : "]";
        const end = this.max ? vts(this.max) + (this.eqMax ? "]" : ")") : "[";
        return start + comma + end;
    }

    private gYearToMinMax(value: string): [Date, Date] | undefined {
        const regex =
            /^(-?[1-9][0-9]{3,}|-?0[0-9]{3})(Z|(\+|-)((0[0-9]|1[0-3]):([0-5][0-9])|14:00))?$/;
        const match = value.match(regex);
        if (!match) {
            this.logger.warn(`Invalid gYear format: ${value}`);
            return;
        }
        const year = parseInt(match[1]);
        let minOffset = 0;
        let maxOffset = 0;
        const timezone = match[2] || this.defaultTimezone;
        if (timezone === "AoE") {
            // Anywhere on Earth approach.
            minOffset = -12 * 60;
            maxOffset = 12 * 60;
        } else if (timezone !== "Z") {
            const sign = match[3];
            const h = parseInt(match[5]);
            const m = parseInt(match[6]);
            const offset = (sign === "+" ? 1 : -1) * (h * 60 + m);
            minOffset = offset;
            maxOffset = offset;
        }
        return [
            new Date(Date.UTC(year, 0, 1) + minOffset * 60 * 1000),
            new Date(Date.UTC(year + 1, 0, 1) + maxOffset * 60 * 1000),
        ];
    }

    private gYearMonthToMinMax(value: string): [Date, Date] | undefined {
        const regex =
            /^(-?[1-9][0-9]{3,}|-?0[0-9]{3})-(0[1-9]|1[0-2])(Z|(\+|-)((0[0-9]|1[0-3]):([0-5][0-9])|14:00))?$/;
        const match = value.match(regex);
        if (!match) {
            this.logger.warn(`Invalid gYearMonth format: ${value}`);
            return;
        }
        const y = parseInt(match[1]);
        const m = parseInt(match[2]);
        let minOffset = 0;
        let maxOffset = 0;
        const timezone = match[3] || this.defaultTimezone;
        if (timezone === "AoE") {
            // Anywhere on Earth approach.
            minOffset = -12 * 60;
            maxOffset = 12 * 60;
        } else if (timezone !== "Z") {
            const sign = match[4];
            const h = parseInt(match[6]);
            const min = parseInt(match[7]);
            const offset = (sign === "+" ? 1 : -1) * (h * 60 + min);
            minOffset = offset;
            maxOffset = offset;
        }
        return [
            new Date(Date.UTC(y, m - 1, 1) + minOffset * 60 * 1000),
            new Date(Date.UTC(y, m, 1) + maxOffset * 60 * 1000),
        ];
    }

    private dateToMinMax(value: string): [Date, Date] | undefined {
        const regex =
            /^(-?[1-9][0-9]{3,}|-?0[0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(Z|(\+|-)((0[0-9]|1[0-3]):([0-5][0-9])|14:00))?$/;
        const match = value.match(regex);
        if (!match) {
            this.logger.warn(`Invalid date format: ${value}`);
            return;
        }
        const y = parseInt(match[1]);
        const m = parseInt(match[2]);
        const d = parseInt(match[3]);
        let minOffset = 0;
        let maxOffset = 0;
        const timezone = match[4] || this.defaultTimezone;
        if (timezone === "AoE") {
            // Anywhere on Earth approach.
            minOffset = -12 * 60;
            maxOffset = 12 * 60;
        } else if (timezone !== "Z") {
            const sign = match[5];
            const h = parseInt(match[7]);
            const min = parseInt(match[8]);
            const offset = (sign === "+" ? 1 : -1) * (h * 60 + min);
            minOffset = offset;
            maxOffset = offset;
        }
        return [
            new Date(Date.UTC(y, m - 1, d) + minOffset * 60 * 1000),
            new Date(Date.UTC(y, m - 1, d + 1) + maxOffset * 60 * 1000),
        ];
    }

    private partialDateTimeToMinMax(value: string): [Date, Date] | undefined {
        const dateHourMinSecRegex =
            /^(-?[1-9][0-9]{3,}|-?0[0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(Z|(\+|-)((0[0-9]|1[0-3]):([0-5][0-9])|14:00))?$/;
        const matchDHMS = value.match(dateHourMinSecRegex);
        if (matchDHMS) {
            const y = parseInt(matchDHMS[1]);
            const m = parseInt(matchDHMS[2]);
            const d = parseInt(matchDHMS[3]);
            const h = parseInt(matchDHMS[4]);
            const min = parseInt(matchDHMS[5]);
            const s = parseInt(matchDHMS[6]);
            let minOffset = 0;
            let maxOffset = 0;
            const timezone = matchDHMS[7] || this.defaultTimezone;
            if (timezone === "AoE") {
                // Anywhere on Earth approach.
                minOffset = -12 * 60;
                maxOffset = 12 * 60;
            } else if (timezone !== "Z") {
                const sign = matchDHMS[8];
                const hOff = parseInt(matchDHMS[10]);
                const minOff = parseInt(matchDHMS[11]);
                const offset = (sign === "+" ? 1 : -1) * (hOff * 60 + minOff);
                minOffset = offset;
                maxOffset = offset;
            }
            return [
                new Date(
                    Date.UTC(y, m - 1, d, h, min, s) + minOffset * 60 * 1000,
                ),
                new Date(
                    Date.UTC(y, m - 1, d, h, min, s + 1) +
                        maxOffset * 60 * 1000,
                ),
            ];
        }
        const dateHourMinRegex =
            /^(-?[1-9][0-9]{3,}|-?0[0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9])(Z|(\+|-)((0[0-9]|1[0-3]):([0-5][0-9])|14:00))?$/;
        const matchDHM = value.match(dateHourMinRegex);
        if (matchDHM) {
            const y = parseInt(matchDHM[1]);
            const m = parseInt(matchDHM[2]);
            const d = parseInt(matchDHM[3]);
            const h = parseInt(matchDHM[4]);
            const min = parseInt(matchDHM[5]);
            let minOffset = 0;
            let maxOffset = 0;
            const timezone = matchDHM[6] || this.defaultTimezone;
            if (timezone === "AoE") {
                // Anywhere on Earth approach.
                minOffset = -12 * 60;
                maxOffset = 12 * 60;
            } else if (timezone !== "Z") {
                const sign = matchDHM[7];
                const hOff = parseInt(matchDHM[9]);
                const minOff = parseInt(matchDHM[10]);
                const offset = (sign === "+" ? 1 : -1) * (hOff * 60 + minOff);
                minOffset = offset;
                maxOffset = offset;
            }
            return [
                new Date(Date.UTC(y, m - 1, d, h, min) + minOffset * 60 * 1000),
                new Date(
                    Date.UTC(y, m - 1, d, h, min + 1) + maxOffset * 60 * 1000,
                ),
            ];
        }
        const dateHourRegex =
            /^(-?[1-9][0-9]{3,}|-?0[0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3])(Z|(\+|-)((0[0-9]|1[0-3]):([0-5][0-9])|14:00))?$/;
        const matchDH = value.match(dateHourRegex);
        if (matchDH) {
            const y = parseInt(matchDH[1]);
            const m = parseInt(matchDH[2]);
            const d = parseInt(matchDH[3]);
            const h = parseInt(matchDH[4]);
            let minOffset = 0;
            let maxOffset = 0;
            const timezone = matchDH[5] || this.defaultTimezone;
            if (timezone === "AoE") {
                // Anywhere on Earth approach.
                minOffset = -12 * 60;
                maxOffset = 12 * 60;
            } else if (timezone !== "Z") {
                const sign = matchDH[6];
                const hOff = parseInt(matchDH[8]);
                const minOff = parseInt(matchDH[9]);
                const offset = (sign === "+" ? 1 : -1) * (hOff * 60 + minOff);
                minOffset = offset;
                maxOffset = offset;
            }
            return [
                new Date(Date.UTC(y, m - 1, d, h) + minOffset * 60 * 1000),
                new Date(Date.UTC(y, m - 1, d, h + 1) + maxOffset * 60 * 1000),
            ];
        }
    }
}

export class LeafCondition implements Condition {
    relationType: Term;
    value: string;
    compareType: CompareTypes;

    path: BasicLensM<Cont, Cont>;
    pathQuads: Path;

    range: Range;

    defaultTimezone: string;

    private logger = getLoggerFor(this);

    constructor(inp: {
        relationType: Term;
        value: string;
        compareType?: string;
        path: BasicLensM<Cont, Cont>;
        pathQuads: RdfThing;
        defaultTimezone: string;
    }) {
        this.relationType = inp.relationType;
        this.value = inp.value;
        this.compareType = <CompareTypes>inp.compareType || "string";
        this.path = inp.path;
        const store = RdfStore.createDefault();
        inp.pathQuads.quads.forEach((x) => store.addQuad(x));
        this.pathQuads = { id: inp.pathQuads.entry, store };
        this.defaultTimezone = inp.defaultTimezone;

        this.range = new Range(
            this.parseValue(inp.value),
            inp.relationType.value,
            this.defaultTimezone,
        );
    }

    toString(): string {
        const vts =
            this.compareType === "date"
                ? (x: Value) => (<Date>x).toISOString()
                : undefined;
        return `${this.pathQuads.id.value} ∈ ${this.range.toString(vts)}`;
    }

    matchRelation(range: Range | undefined, cbdId: Path): boolean {
        if (!cbdEquals(this.pathQuads, cbdId)) {
            return true;
        }
        if (!range) {
            this.logger.debug(
                "[matchRelation] Range is here also undefined, returning false",
            );
            return false;
        }

        const vts =
            this.compareType === "date"
                ? (x: Value) => new Date(x).toISOString()
                : undefined;
        this.logger.verbose(
            `${this.range.toString(vts)} contains ${range.toString(vts)}. Overlaps: ${this.range.overlaps(
                range,
            )}`,
        );

        return this.range.overlaps(range);
    }

    matchMember(member: Member): boolean {
        const value = this.parseValue(this.path.execute(member)[0].id.value);
        return this.range.contains(value);
    }

    private parseValue(value: string): string | Date | number {
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
    items: Condition[];

    constructor(inp: { items: Condition[] }) {
        this.items = inp.items;
    }

    abstract combine(alpha: boolean, beta: boolean): boolean;

    matchRelation(range: Range | undefined, cbdId: Path): boolean {
        return this.items
            .map((x) => x.matchRelation(range, cbdId))
            .reduce(this.combine.bind(this));
    }

    matchMember(member: Member): boolean {
        return this.items
            .map((x) => x.matchMember(member))
            .reduce(this.combine.bind(this));
    }
}

export class AndCondition extends BiCondition {
    combine(alpha: boolean, beta: boolean): boolean {
        return alpha && beta; // TODO those might be null if something cannot make a statement about it, important for not condition
    }
    toString(): string {
        const contents = this.items.map((x) => x.toString()).join(" ^ ");
        return `(${contents})`;
    }
}

export class OrCondition extends BiCondition {
    combine(alpha: boolean, beta: boolean): boolean {
        return alpha || beta; // TODO those might be null if something cannot make a statement about it, important for not condition
    }
    toString(): string {
        const contents = this.items.map((x) => x.toString()).join(" V ");
        return `(${contents})`;
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
