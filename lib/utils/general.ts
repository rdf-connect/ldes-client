import { Parser, quadToString } from "rdf-parser-ts/browser";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { RDF, SHACL } from "@treecg/types";
import { getLoggerFor } from "./logUtil";

import type { LDESInfo, Member, Modulator } from "../fetcher";
import type { SerializedMember } from "../strategy";
import type {
    DataFactoryLike,
    ParserOptions,
} from "rdf-parser-ts/browser";
import type {
    NamedNode,
    Quad,
    BaseQuad,
    Quad_Predicate,
    Quad_Subject,
    Quad_Object,
    Stream,
    Term,
} from "@rdfjs/types";

const logger = getLoggerFor("Utils");

const df = new DataFactory();
let parserBlankNodeScope = 0;

export function parseQuads(
    source: string,
    options?: ParserOptions,
): Quad[] {
    const factory = scopedBlankNodeFactory(options?.factory);
    const parser = new Parser({
        ...options,
        factory,
        messages: false,
        rdfMessages: false,
    });
    return (parser.parse(source) ?? []) as Quad[];
}

export function serializeQuads(quads: Quad[]): string {
    return quads.map(quadToString).join("\n");
}

function scopedBlankNodeFactory(factory: DataFactoryLike = df): DataFactoryLike {
    const scope = `p${parserBlankNodeScope++}`;
    let anonymous = 0;
    return {
        namedNode: (value) => factory.namedNode(value),
        blankNode: (value) =>
            factory.blankNode(`${scope}_${value ?? `b${anonymous++}`}`),
        literal: (value, languageOrDatatype, datatype) =>
            factory.literal(value, languageOrDatatype, datatype),
        variable: factory.variable
            ? (value) => factory.variable!(value)
            : undefined,
        defaultGraph: () => factory.defaultGraph(),
        quad: (subject, predicate, object, graph) =>
            factory.quad(subject, predicate, object, graph),
    };
}

export function getSubjects(
    store: RdfStore,
    predicate: Term | null,
    object: Term | null,
    graph?: Term | null,
): Quad_Subject[] {
    return store.getQuads(null, predicate, object, graph).map((quad) => {
        return quad.subject;
    });
}

export function getObjects(
    store: RdfStore,
    subject: Term | null,
    predicate: Term | null,
    graph?: Term | null,
): Quad_Object[] {
    return store.getQuads(subject, predicate, null, graph).map((quad) => {
        return quad.object;
    });
}

export function readableToArray<T>(stream: ReadableStream<T>): Promise<T[]> {
    const out: T[] = [];
    const reader = stream.getReader();
    return new Promise((res, rej) => {
        const next = () => {
            reader
                .read()
                .catch(rej)
                .then((obj) => {
                    if (obj) {
                        if (obj.done) {
                            res(out);
                        } else {
                            out.push(obj.value);
                            next();
                        }
                    } else {
                        res(out);
                    }
                });
        };
        next();
    });
}

/**
 * Converts a stream to an array, pushing all elements to an array
 * Resolving the promise with the 'end' event
 */
export function streamToArray<T extends BaseQuad>(
    stream: Stream<T>,
): Promise<T[]> {
    const out: T[] = [];
    return new Promise((res, rej) => {
        stream.on("end", () => res(out));
        stream.on("data", (x) => {
            out.push(x);
        });
        stream.on("error", (ex) => {
            logger.error("[streamToArray] Stream to Array failed");
            rej(ex);
        });
    });
}

export function streamToString(stream: Stream): Promise<string> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
        stream.on("data", (chunk: ArrayBuffer) =>
            chunks.push(Buffer.from(chunk)),
        );
        stream.on("error", (err: unknown) => reject(err));
        stream.on("end", () =>
            resolve(Buffer.concat(chunks).toString("utf8")),
        );
    });
}

/**
 * Find the main sh:NodeShape subject of a given Shape Graph.
 * We determine this by assuming that the main node shape
 * is not referenced by any other shape description.
 * If more than one is found an exception is thrown.
 */
export function extractMainNodeShape(store: RdfStore): NamedNode {
    const nodeShapes = getSubjects(
        store,
        RDF.terms.type,
        SHACL.terms.NodeShape,
        null,
    );
    let mainNodeShape = null;

    if (nodeShapes && nodeShapes.length > 0) {
        for (const ns of nodeShapes) {
            const isNotReferenced =
                getSubjects(store, null, ns, null).length === 0;

            if (isNotReferenced) {
                if (!mainNodeShape) {
                    mainNodeShape = ns;
                } else {
                    throw new Error(
                        "There are multiple main node shapes in a given shape graph. Unrelated shapes must be given as separate shape graphs",
                    );
                }
            }
        }
        if (mainNodeShape) {
            return <NamedNode>mainNodeShape;
        } else {
            throw new Error(
                "No main SHACL Node Shapes found in given shape graph",
            );
        }
    } else {
        throw new Error("No SHACL Node Shapes found in given shape graph");
    }
}

export function urlToUrl(input: Parameters<typeof fetch>[0]): URL {
    if (typeof input === "string") {
        return new URL(input);
    } else if (input instanceof URL) {
        return input;
    } else if (input instanceof Request) {
        return new URL(input.url);
    } else {
        throw "Not a real url";
    }
}

export function memberFromQuads(
    member: Term,
    quads: Quad[],
    timestampPath: Term | undefined,
    sequencePath: Term | undefined,
    sequencePathTerms: Term[] | undefined,
    transactionFinalizedPath: Term | undefined,
    transactionFinalizedPathTerms: Term[] | undefined,
    transactionFinalizedObject: Term | undefined,
    isVersionOfPath: Term | undefined,
    created?: Date,
    pathStore?: RdfStore,
): Member {
    const memberStore = RdfStore.createDefault();
    quads.forEach((quad) => memberStore.addQuad(quad));

    // Get timestamp
    let timestamp: string | Date | number | undefined;
    if (timestampPath) {
        const value = resolveShaclPath(
            memberStore,
            member,
            timestampPath,
            pathStore ?? memberStore,
        )[0];
        if (value) {
            const date = new Date(value.value);
            timestamp = Number.isNaN(date.getTime())
                ? termToOrderValue(value)
                : date;
        }
    }
    const sequence = extractSequenceValue(member, quads, sequencePath, sequencePathTerms, pathStore);
    const order = timestamp ?? sequence;
    const transactionFinalized = extractFinalizedValue(
        member,
        quads,
        transactionFinalizedPath,
        transactionFinalizedPathTerms,
        transactionFinalizedObject,
        pathStore,
    );

    // Get isVersionof
    let isVersionOf: string | undefined;
    if (isVersionOfPath) {
        isVersionOf = quads.find(
            (x) =>
                x.subject.equals(member) && x.predicate.equals(isVersionOfPath),
        )?.object.value;
    }

    // Get type
    const type: Term | undefined = quads.find(
        (x) => x.subject.equals(member) && x.predicate.value === RDF.type,
    )?.object;
    return { quads, id: member, isVersionOf, order, timestamp, sequence, transactionFinalized, type, created };
}

function extractSequenceValue(
    member: Term,
    quads: Quad[],
    sequencePath: Term | undefined,
    sequencePathTerms: Term[] | undefined,
    pathStore?: RdfStore,
): string | Date | number | undefined {
    if (!sequencePath) {
        return;
    }
    const memberStore = RdfStore.createDefault();
    quads.forEach((quad) => memberStore.addQuad(quad));
    const sequence = sequencePathTerms
        ? resolveShaclPathTerms(memberStore, member, sequencePathTerms)[0]
        : resolveShaclPath(memberStore, member, sequencePath, pathStore ?? memberStore)[0];
    if (!sequence) {
        return;
    }
    return termToOrderValue(sequence);
}

function extractFinalizedValue(
    member: Term,
    quads: Quad[],
    path: Term | undefined,
    pathTerms: Term[] | undefined,
    finalizedObject: Term | undefined,
    pathStore?: RdfStore,
): boolean | undefined {
    if (!path) {
        return;
    }
    const memberStore = RdfStore.createDefault();
    quads.forEach((quad) => memberStore.addQuad(quad));
    const value = pathTerms
        ? resolveShaclPathTerms(memberStore, member, pathTerms)[0]
        : resolveShaclPath(memberStore, member, path, pathStore ?? memberStore)[0];
    if (!value) {
        return;
    }
    const expected = finalizedObject ??
        df.literal("true", df.namedNode("http://www.w3.org/2001/XMLSchema#boolean"));
    return value.equals(expected);
}

const numericDatatypes = new Set([
    "http://www.w3.org/2001/XMLSchema#byte",
    "http://www.w3.org/2001/XMLSchema#decimal",
    "http://www.w3.org/2001/XMLSchema#double",
    "http://www.w3.org/2001/XMLSchema#float",
    "http://www.w3.org/2001/XMLSchema#int",
    "http://www.w3.org/2001/XMLSchema#integer",
    "http://www.w3.org/2001/XMLSchema#long",
    "http://www.w3.org/2001/XMLSchema#negativeInteger",
    "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
    "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
    "http://www.w3.org/2001/XMLSchema#positiveInteger",
    "http://www.w3.org/2001/XMLSchema#short",
    "http://www.w3.org/2001/XMLSchema#unsignedByte",
    "http://www.w3.org/2001/XMLSchema#unsignedInt",
    "http://www.w3.org/2001/XMLSchema#unsignedLong",
    "http://www.w3.org/2001/XMLSchema#unsignedShort",
]);
const dateDatatypes = new Set([
    "http://www.w3.org/2001/XMLSchema#date",
    "http://www.w3.org/2001/XMLSchema#dateTime",
    "http://www.w3.org/2001/XMLSchema#dateTimeStamp",
]);

function termToOrderValue(term: Term): string | Date | number {
    if (term.termType === "Literal") {
        if (numericDatatypes.has(term.datatype.value)) {
            return Number(term.value);
        }
        if (dateDatatypes.has(term.datatype.value)) {
            const date = new Date(term.value);
            if (!Number.isNaN(date.getTime())) {
                return date;
            }
        }
    }
    return term.value;
}

export function resolveShaclPath(
    data: RdfStore,
    focus: Term,
    path: Term,
    pathStore = data,
): Term[] {
    return resolveShaclPathInternal(data, focus, path, pathStore, new Set());
}

function resolveShaclPathInternal(
    data: RdfStore,
    focus: Term,
    path: Term,
    pathStore: RdfStore,
    active: Set<string>,
): Term[] {
    const key = `${focus.termType}:${focus.value}|${path.termType}:${path.value}`;
    if (active.has(key)) return [];
    const nextActive = new Set(active).add(key);

    const sequence = rdfListToArray(pathStore, path);
    if (sequence) {
        return sequence.reduce<Term[]>(
            (subjects, item) => subjects.flatMap((subject) =>
                resolveShaclPathInternal(data, subject, item, pathStore, nextActive),
            ),
            [focus],
        );
    }

    const alternative = pathStore.getQuads(
        path,
        df.namedNode("http://www.w3.org/ns/shacl#alternativePath"),
        null,
        null,
    )[0]?.object;
    if (alternative) {
        return uniqueTerms(
            (rdfListToArray(pathStore, alternative) ?? []).flatMap((item) =>
                resolveShaclPathInternal(data, focus, item, pathStore, nextActive),
            ),
        );
    }

    const inverse = pathStore.getQuads(
        path,
        df.namedNode("http://www.w3.org/ns/shacl#inversePath"),
        null,
        null,
    )[0]?.object;
    if (inverse?.termType === "NamedNode") {
        return data.getQuads(null, inverse, focus, null).map((quad) => quad.subject);
    }

    return data.getQuads(focus, path, null, null).map((quad) => quad.object);
}

function uniqueTerms(terms: Term[]): Term[] {
    return terms.filter((term, index) =>
        terms.findIndex((candidate) => candidate.equals(term)) === index
    );
}

export function resolveShaclPathTerms(
    data: RdfStore,
    focus: Term,
    pathTerms: Term[],
): Term[] {
    return pathTerms.reduce<Term[]>(
        (subjects, predicate) => subjects.flatMap((subject) =>
            data.getQuads(subject, predicate, null, null).map((quad) => quad.object),
        ),
        [focus],
    );
}

export function shaclPathKey(store: RdfStore, path: Term | undefined): string | undefined {
    if (!path) {
        return;
    }
    const sequence = rdfListToArray(store, path);
    if (sequence) {
        return `sequence:${sequence.map((term) => shaclPathKey(store, term)).join("/")}`;
    }
    const alternative = store.getQuads(
        path,
        df.namedNode("http://www.w3.org/ns/shacl#alternativePath"),
        null,
        null,
    )[0]?.object;
    if (alternative) {
        const choices = rdfListToArray(store, alternative) ?? [];
        return `alternative:${choices.map((term) => shaclPathKey(store, term)).join("|")}`;
    }
    return `term:${path.value}`;
}

export function shaclPathTerms(store: RdfStore, path: Term | undefined): Term[] | undefined {
    if (!path) {
        return;
    }
    return rdfListToArray(store, path);
}

function rdfListToArray(store: RdfStore, head: Term): Term[] | undefined {
    if (head.equals(RDF.terms.nil)) {
        return [];
    }
    const out: Term[] = [];
    const seen = new Set<string>();
    let current: Term | undefined = head;

    while (current && !current.equals(RDF.terms.nil)) {
        if (seen.has(current.value)) {
            return;
        }
        seen.add(current.value);

        const first = store.getQuads(current, RDF.terms.first, null, null)[0]?.object;
        const rest: Term | undefined = store.getQuads(current, RDF.terms.rest, null, null)[0]?.object;
        if (!first || !rest) {
            return;
        }
        out.push(first);
        current = rest;
    }

    return out.length > 0 ? out : undefined;
}

export function serializeMember(member: Member): SerializedMember {
    return {
        id: member.id.value,
        quads: member.quads.map(quadToString).join("\n"),
        order: member.order instanceof Date
            ? member.order.toISOString()
            : member.order?.toString(),
        timestamp: member.timestamp instanceof Date
            ? member.timestamp.toISOString()
            : member.timestamp?.toString(),
        sequence: member.sequence instanceof Date
            ? member.sequence.toISOString()
            : member.sequence?.toString(),
        transactionFinalized: member.transactionFinalized,
        isVersionOf: member.isVersionOf,
        type: member.type?.value,
        created: member.created?.toISOString(),
    };
}

export function deserializeMember(serialized: SerializedMember): Member {
    const order = serialized.order === undefined
        ? undefined
        : deserializeOrderValue(serialized.order);
    let timestamp: string | Date | number | undefined;
    if (serialized.timestamp) {
        try {
            timestamp = new Date(serialized.timestamp);
        } catch {
            timestamp = serialized.timestamp;
        }
    }
    let sequence: string | Date | number | undefined;
    if (serialized.sequence !== undefined) {
        sequence = deserializeOrderValue(serialized.sequence);
    }
    return {
        id: df.namedNode(serialized.id),
        quads: parseQuads(serialized.quads),
        order,
        timestamp,
        sequence,
        transactionFinalized: serialized.transactionFinalized,
        isVersionOf: serialized.isVersionOf,
        type: serialized.type ? df.namedNode(serialized.type) : undefined,
        created: serialized.created ? new Date(serialized.created) : undefined,
    };
}

function deserializeOrderValue(value: string): string | Date | number {
    const number = Number(value);
    if (!Number.isNaN(number)) {
        return number;
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
        return date;
    }
    return value;
}

/**
 * Version materialization function that sets the declared ldes:versionOfPath property value
 * as the member's subject IRI
 */
export function maybeVersionMaterialize(
    member: Member,
    materialize: boolean,
    ldesInfo: LDESInfo,
): Member {
    if (materialize && ldesInfo.versionOfPath) {
        // Create RDF store with member quads
        const memberStore = RdfStore.createDefault();
        member.quads.forEach((q) => memberStore.addQuad(q));
        // Get materialized subject IRI
        const newSubject = getObjects(
            memberStore,
            member.id,
            ldesInfo.versionOfPath,
        )[0];
        if (newSubject) {
            // Remove version property
            memberStore.removeQuad(
                df.quad(
                    <Quad_Subject>member.id,
                    <Quad_Predicate>ldesInfo.versionOfPath,
                    newSubject,
                ),
            );
            // Updated all quads with materialized subject
            for (const q of memberStore.getQuads(member.id)) {
                //q.subject = <Quad_Subject>newSubject;
                const newQ = df.quad(
                    <Quad_Subject>newSubject,
                    q.predicate,
                    q.object,
                    q.graph,
                );
                memberStore.removeQuad(q);
                memberStore.addQuad(newQ);
            }
            // Update member object
            member.id = newSubject;
            member.quads = memberStore.getQuads();
        } else {
            logger.warn(`No version property found in Member (${member.id.value}) as specified by ldes:isVersionOfPath ${ldesInfo.versionOfPath.value}`);
        }
    }

    return member;
}

export async function memberIsOld(member: Member, modulator: Modulator<unknown, unknown>) {
    if (!modulator.hasLatestVersions() || !member.isVersionOf || !member.timestamp) {
        return false;
    }
    logger.silly(`[memberIsOld] Checking if member <${member.id.value}> (version of: ${member.isVersionOf}) is old`);
    // We are emitting latest versions only
    const version = member.timestamp instanceof Date ?
        member.timestamp.getTime() : new Date(member.timestamp).getTime();
    try {
        return await modulator.filterLatest(member.isVersionOf, version);
    } catch (ex) {
        throw ex;
    }
}
