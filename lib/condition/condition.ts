import { NamedNode, Parser } from "n3";
import { DataFactory } from "rdf-data-factory";
import { BasicLensM, extractShapes, pred } from "rdf-lens";
import { RdfStore } from "rdf-stores";
import { TREE, XSD } from "@treecg/types";
import { getLoggerFor, parseInBetweenRelation } from "../utils";
import { SHAPES } from "./shapes";
import { cbdEquals } from "./range";

import type { Quad, Term } from "@rdfjs/types";
import type { Cont } from "rdf-lens";
import type { Member } from "../fetcher";
import type { Path } from "./range";

const df = new DataFactory();

type RdfThing = {
    entry: Term;
    quads: Quad[];
};

export interface Condition {
    matchRelation(range: Range | undefined, cbdId: Path): boolean;

    matchMember(member: Member): boolean;
    memberEmitted(member: Member): void;

    toString(): string;

    poll(): void;
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
        "http://vocab.deri.ie/csp#MaxCount": (obj) =>
            new MaxCountCondition(
                <ConstructorParameters<typeof MaxCountCondition>[0]>obj,
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
        value = this.parseValue(value, dataType);

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
            case TREE.custom("InBetweenRelation"): {
                if (typeof value !== "string") {
                    throw (
                        "InBetweenRelation can only handle string values, not" +
                        typeof value
                    );
                }
                const between = parseInBetweenRelation(
                    value,
                    dataType,
                    this.defaultTimezone,
                );
                if (between) {
                    this.min = between.min;
                    this.eqMin = true;
                    this.max = between.max;
                    this.eqMax = false;
                }
                return;
            }
        }
    }

    static empty(defaultTimezone: string): Range {
        return new Range("", TREE.Relation, defaultTimezone);
    }

    add(value: Value, type: string, dataType?: string) {
        value = this.parseValue(value, dataType);

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
            case TREE.custom("InBetweenRelation"): {
                if (typeof value !== "string") {
                    throw (
                        "InBetweenRelation can only handle string values, not" +
                        typeof value
                    );
                }
                const between = parseInBetweenRelation(
                    value,
                    dataType,
                    this.defaultTimezone,
                );
                if (between) {
                    if (this.min === undefined || between.min < this.min) {
                        this.min = between.min;
                        this.eqMin = true;
                    }
                    if (this.max === undefined || between.max < this.max) {
                        this.max = between.max;
                        this.eqMax = false;
                    }
                }
                return;
            }
        }
    }

    contains(value: Value | Date | number): boolean {
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
        const start = this.min ? (this.eqMin ? "[" : "]") + vts(this.min) : "]∞";
        const end = this.max ? vts(this.max) + (this.eqMax ? "]" : "[") : "∞[";
        return start + "," + end;
    }

    parseValue(value: Value, dataType?: string): Value {
        if (dataType === XSD.dateTime) {
            return new Date(value);
        } else if (dataType === XSD.integer) {
            return parseInt(value.toString());
        } else if (dataType === XSD.custom("float")) {
            return parseFloat(value.toString());
        } else if (dataType === XSD.custom("double")) {
            return parseFloat(value.toString());
        } else if (dataType === XSD.custom("decimal")) {
            return parseFloat(value.toString());
        }
        return value;
    }
}

export class LeafCondition implements Condition {
    relationType: Term;
    value: Term;
    compareType: CompareTypes;

    path: BasicLensM<Cont, Cont>;
    pathQuads: Path;

    range: Range;

    defaultTimezone: string;

    private logger = getLoggerFor(this);

    constructor(inp: {
        relationType: Term;
        value: Term;
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
        let dataType;
        if (inp.value.termType === "Literal") {
            dataType = inp.value.datatype.value;
        }

        this.range = new Range(
            this.parseValue(inp.value.value),
            inp.relationType.value,
            this.defaultTimezone,
            dataType,
        );
    }

    memberEmitted(): void {
        // empty
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

    private parseValue(value: string): Value {
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

    poll(): void {
        // pass
    }
}

abstract class BiCondition implements Condition {
    items: Condition[];

    constructor(inp: { items: Condition[] }) {
        this.items = inp.items;
    }

    abstract combine(alpha: boolean, beta: boolean): boolean;

    abstract memberEmitted(member: Member): void;

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

    poll(): void {
        this.items.forEach((x) => x.poll());
    }
}

export class AndCondition extends BiCondition {
    combine(alpha: boolean, beta: boolean): boolean {
        return alpha && beta; // TODO those might be null if something cannot make a statement about it, important for not condition
    }
    memberEmitted(member: Member): void {
        this.items.forEach((x) => x.memberEmitted(member));
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
    memberEmitted(member: Member): void {
        for (const item of this.items) {
            if (item.matchMember(member)) {
                item.memberEmitted(member);
            }
        }
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

    memberEmitted(): void {
        // empty
    }

    toString() {
        return "all";
    }
    poll(): void {
        // empty
    }
}

export class MaxCountCondition implements Condition {
    maxCount: number;
    current: number;
    reset_on_poll: boolean;
    constructor(inp: { count: number; reset_on_poll?: boolean }) {
        this.maxCount = inp.count;
        this.current = 0;
        this.reset_on_poll = inp.reset_on_poll || false;
    }

    matchRelation(): boolean {
        return this.current < this.maxCount;
    }

    memberEmitted(): void {
        this.current += 1;
    }

    matchMember(): boolean {
        return this.current < this.maxCount;
    }
    toString(): string {
        return `${this.current} < ${this.maxCount}`;
    }

    poll(): void {
        if (this.reset_on_poll) {
            this.current = 0;
        }
    }
}

export async function processConditionFile(
    conditionFile?: string,
): Promise<Condition> {
    let condition: Condition = empty_condition();

    /* eslint-disable  @typescript-eslint/no-require-imports */
    const fs =
        typeof require === "undefined"
            ? await import("fs/promises")
            : require("fs/promises");

    if (conditionFile) {
        try {
            condition = parse_condition(
                await fs.readFile(conditionFile, { encoding: "utf8" }),
                conditionFile,
            );
        } catch (ex) {
            console.error(`Failed to read condition file: ${conditionFile}`);
            throw ex;
        }
    }

    return condition;
}

/**
 * Function that handles any given condition, together with the "before" and "after" options,
 * and builds the corresponding unified Condition.
 */
export function handleConditions(
    condition: Condition,
    defaultTimezone: string,
    before?: Date,
    after?: Date,
    timestampPath?: Term,
): Condition {
    // Check if before and after conditions are defined and build corresponding Condition object
    let handledCondition: Condition = empty_condition();
    const toDateLiteral = (date: Date) => {
        return df.literal(date.toISOString(), XSD.terms.dateTime);
    };

    if (before) {
        if (!timestampPath) {
            throw "Cannot apply 'before' or 'after' filters since the target LDES does not define a ldes:timestampPath predicate";
        }

        const predLens = pred(timestampPath);
        const beforeCond = new LeafCondition({
            relationType: TREE.terms.LessThanRelation,
            value: toDateLiteral(before),
            compareType: "date",
            path: predLens,
            pathQuads: { entry: timestampPath, quads: [] },
            defaultTimezone,
        });
        if (after) {
            const afterCond = new LeafCondition({
                relationType: TREE.terms.GreaterThanRelation,
                value: toDateLiteral(after),
                compareType: "date",
                path: predLens,
                pathQuads: { entry: timestampPath, quads: [] },
                defaultTimezone,
            });
            // Got bi-condition with before & after filters
            handledCondition = new AndCondition({
                items: [beforeCond, afterCond],
            });
        } else {
            // Got condition with before filter only
            handledCondition = beforeCond;
        }
    } else if (after) {
        if (!timestampPath) {
            throw "Cannot apply 'before' or 'after' filters since the target LDES does not define a ldes:timestampPath predicate";
        }

        const predLens = pred(timestampPath);
        // Got condition with after filter only
        handledCondition = new LeafCondition({
            relationType: TREE.terms.GreaterThanRelation,
            value: toDateLiteral(after),
            compareType: "date",
            path: predLens,
            pathQuads: { entry: timestampPath, quads: [] },
            defaultTimezone,
        });
    }

    // See if condition file was defined too
    if (!(condition instanceof EmptyCondition)) {
        return new AndCondition({
            items: [condition, handledCondition],
        });
    } else {
        return handledCondition;
    }
}