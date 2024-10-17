import {
    NamedNode,
    Quad,
    Quad_Predicate,
    Quad_Subject,
    Stream,
    Term,
} from "@rdfjs/types";
import { BaseQuad } from "n3";
import { StateFactory, StateT } from "./state";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { RDF, SHACL, TREE, XSD } from "@treecg/types";
import { Member } from "./page";
import { LDESInfo } from "./client";
import { pred } from "rdf-lens";
import {
    AndCondition,
    Condition,
    empty_condition,
    EmptyCondition,
    LeafCondition,
    parse_condition,
} from "./condition/index";

import { getLoggerFor } from "./utils/logUtil";

const logger = getLoggerFor("Utils");

const df = new DataFactory();

export type Notifier<Events, S> = {
    [K in keyof Events]: (event: Events[K], state: S) => void;
};

export function getSubjects(
    store: RdfStore,
    predicate: Term | null,
    object: Term | null,
    graph?: Term | null,
) {
    return store.getQuads(null, predicate, object, graph).map((quad) => {
        return quad.subject;
    });
}

export function getObjects(
    store: RdfStore,
    subject: Term | null,
    predicate: Term | null,
    graph?: Term | null,
) {
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

/**
 * Generic interface that represents a structure that ranks elements.
 * Most common is a Priority Queue (heap like) the pops elements in order.
 * An array is also a Ranker, without ordering.
 */
export interface Ranker<T> {
    push(item: T): void;
    pop(): T | undefined;
}

export type ModulartorEvents<T> = {
    ready: Indexed<T>;
};

/**
 * Factory that creates Modulator's
 * This is a factory to keep track whether or not the Modulator should be paused or not.
 */
export class ModulatorFactory {
    concurrent = 10;
    paused: boolean = false;

    factory: StateFactory;
    children: ModulatorInstance<unknown>[] = [];

    constructor(stateFactory: StateFactory, concurrent?: number) {
        this.factory = stateFactory;
        if (concurrent) {
            this.concurrent = concurrent;
        }
    }

    /**
     * Note: `T` should be plain javascript objects (because that how state is saved)
     */
    create<T>(
        name: string,
        ranker: Ranker<Indexed<T>>,
        notifier: Notifier<ModulartorEvents<T>, unknown>,
        parse?: (item: unknown) => T,
    ): Modulator<T> {
        const state = this.factory.build<ModulatorInstanceState<T>>(
            name,
            JSON.stringify,
            JSON.parse,
            () => ({
                todo: [],
                inflight: [],
            }),
        );

        if (parse) {
            state.item.todo = state.item.todo.map(({ item, index }) => ({
                index,
                item: parse(item),
            }));
            state.item.inflight = state.item.inflight.map(
                ({ item, index }) => ({
                    index,
                    item: parse(item),
                }),
            );
        }

        const modulator = new ModulatorInstance(state, ranker, notifier, this);
        this.children.push(<ModulatorInstance<unknown>>modulator);
        return modulator;
    }

    pause() {
        this.paused = true;
    }

    unpause() {
        this.paused = false;
        this.children.forEach((x) => x.checkReady());
    }
}

/**
 * Modulator is a structure that only buffers elements and only handles elements
 * when the factory is not paused and when not too many items are active at once.
 */
export interface Modulator<T> {
    push(item: T): void;

    finished(index: number): void;

    length(): number;
}

type Indexed<T> = {
    item: T;
    index: number;
};

type ModulatorInstanceState<T> = {
    todo: Indexed<T>[];
    inflight: Indexed<T>[];
};

class ModulatorInstance<T> implements Modulator<T> {
    at: number = 0;
    index = 0;

    private state: StateT<ModulatorInstanceState<T>>;

    private ranker: Ranker<Indexed<T>>;
    private notifier: Notifier<ModulartorEvents<T>, unknown>;
    private factory: ModulatorFactory;

    private logger = getLoggerFor(this);

    constructor(
        state: StateT<ModulatorInstanceState<T>>,
        ranker: Ranker<Indexed<T>>,
        notifier: Notifier<ModulartorEvents<T>, unknown>,
        factory: ModulatorFactory,
    ) {
        this.state = state;
        const readd = [...this.state.item.todo, ...this.state.item.inflight];
        this.state.item.todo.push(...this.state.item.inflight);
        while (this.state.item.inflight.pop()) {
            // pass
        }
        while (this.state.item.todo.pop()) {
            // pass
        }
        this.ranker = ranker;
        this.notifier = notifier;
        this.factory = factory;
        for (const item of readd) {
            this.push(item.item);
        }
    }

    length(): number {
        return this.state.item.todo.length;
    }

    push(item: T) {
        const indexed = { item, index: this.index };
        this.state.item.todo.push(indexed);
        this.index += 1;
        this.ranker.push(indexed);
        this.checkReady();
    }

    finished(index: number) {
        const removeIdx = this.state.item.inflight.findIndex(
            (x) => x.index == index,
        );
        if (removeIdx >= 0) {
            this.state.item.inflight.splice(removeIdx, 1);
        } else {
            this.logger.error(
                "[finished] Expected to be able to remove inflight item",
            );
        }

        this.at -= 1;
        this.checkReady();
    }

    checkReady() {
        if (this.factory.paused) {
            return;
        }

        while (this.at < this.factory.concurrent) {
            const item = this.ranker.pop();
            if (item) {
                // This item is no longer todo
                // I'm quite afraid to use filter for this
                const removeIdx = this.state.item.todo.findIndex(
                    (x) => x.index == item.index,
                );
                if (removeIdx >= 0) {
                    this.state.item.todo.splice(removeIdx, 1);
                } else {
                    this.logger.error(
                        "[checkReady] Expected to be able to remove inflight item",
                    );
                }

                // This item is now inflight
                this.state.item.inflight.push(item);

                this.at += 1;
                this.notifier.ready(item, {});
            } else {
                break;
            }
        }
    }
}

function urlToUrl(input: Parameters<typeof fetch>[0]): URL {
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

export type AuthConfig = {
    type: "basic";
    auth: string;
    host: string;
};

export type RetryConfig = {
    codes: number[];
    base: number;
    maxRetries: number;
};

export type FetchConfig = {
    auth?: AuthConfig;
    concurrent?: number;
    retry?: Partial<RetryConfig>;
    safe?: boolean;
};

export function enhanced_fetch(
    config: FetchConfig,
    start?: typeof fetch,
): typeof fetch {
    const start_f = start || fetch;
    const safe_f = config.safe
        ? ((async (a, b) => {
              while (true) {
                  try {
                      return await start_f(a, b);
                  } catch (ex) {
                      logger.error(
                          `This should not happen, it will not happen this is safe. ${JSON.stringify(
                              ex,
                          )}`,
                      );
                  }
              }
          }) as typeof fetch)
        : start_f;

    const fetch_f = config.auth
        ? handle_basic_auth(safe_f, config.auth)
        : safe_f;

    return limit_fetch_per_domain(
        retry_fetch(fetch_f, config.retry || {}),
        config.concurrent,
    );
}

export function limit_fetch_per_domain(
    fetch_f: typeof fetch,
    concurrent: number = 10,
): typeof fetch {
    const domain_dict: { [domain: string]: Array<(value: void) => void> } = {};

    const out: typeof fetch = async (input, init) => {
        const url: URL = urlToUrl(input);
        const domain = url.origin;

        if (!(domain in domain_dict)) {
            domain_dict[domain] = [];
        }

        const requests = domain_dict[domain];
        await new Promise((res) => {
            logger.debug(
                `[limit] ${domain} capacity ${requests.length}/${concurrent}`,
            );
            if (requests.length < concurrent) {
                requests.push(res);
                res({});
            } else {
                requests.push(res);
            }
        });
        const resp = await fetch_f(input, init);

        requests.shift();
        for (let i = 0; i < concurrent; i++) {
            if (requests[i]) {
                requests[i]();
            }
        }

        return resp;
    };

    return out;
}

export function handle_basic_auth(
    fetch_f: typeof fetch,
    config: AuthConfig,
): typeof fetch {
    let authRequired = false;

    const basicAuthValue = `Basic ${Buffer.from(config.auth).toString("base64")}`;
    const setHeader = (init?: RequestInit): RequestInit => {
        const reqInit = init || {};
        const headers = new Headers(reqInit.headers);
        headers.set("Authorization", basicAuthValue);
        reqInit.headers = headers;
        return reqInit;
    };

    const auth_f: typeof fetch = async (input, init) => {
        const url: URL = urlToUrl(input);
        if (authRequired && url.host === config.host) {
            return await fetch_f(input, setHeader(init));
        }

        const resp = await fetch_f(input, init);
        if (resp.status === 401) {
            logger.debug("[auth] Unauthorized, adding basic auth");
            if (url.host === config.host) {
                authRequired = true;
                return await fetch_f(input, setHeader(init));
            }
        }

        return resp;
    };

    return auth_f;
}

export function retry_fetch(
    fetch_f: typeof fetch,
    partial_config: Partial<RetryConfig>,
): typeof fetch {
    const config: RetryConfig = Object.assign(
        {
            codes: [408, 425, 429, 500, 502, 503, 504],
            base: 500,
            maxRetries: 5,
        },
        partial_config,
    );

    const retry: typeof fetch = async (input, init) => {
        let tryCount = 0;
        let retryTime = config.maxRetries;
        while (config.maxRetries == 0 || tryCount < config.maxRetries) {
            const resp = await fetch_f(input, init);
            if (!resp.ok) {
                if (config.codes.some((x) => x == resp.status)) {
                    logger.debug(
                        `[retry_fetch] Retry ${input} ${tryCount}/${config.maxRetries}`,
                    );
                    // Wait 500ms, 1 second, 2 seconds, 4 seconds, 8 seconds, fail
                    tryCount += 1;
                    await new Promise((res) => setTimeout(res, retryTime));
                    retryTime *= 2;
                    continue;
                }
                return resp;
            }
            return resp;
        }

        throw `Max retries exceeded (${config.maxRetries})`;
    };

    return retry;
}

export function memberFromQuads(
    member: Term,
    quads: Quad[],
    timestampPath: Term | undefined,
    isVersionOfPath: Term | undefined,
    created?: Date,
): Member {
    // Get timestamp
    let timestamp: string | Date | undefined;
    if (timestampPath) {
        const ts = quads.find(
            (x) =>
                x.subject.equals(member) && x.predicate.equals(timestampPath),
        )?.object.value;
        if (ts) {
            try {
                timestamp = new Date(ts);
            } catch (ex: unknown) {
                timestamp = ts;
            }
        }
    }

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
    return { quads, id: member, isVersionOf, timestamp, type, created };
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
    if (materialize && ldesInfo.isVersionOfPath) {
        // Create RDF store with member quads
        const memberStore = RdfStore.createDefault();
        member.quads.forEach((q) => memberStore.addQuad(q));
        // Get materialized subject IRI
        const newSubject = getObjects(
            memberStore,
            member.id,
            ldesInfo.isVersionOfPath,
        )[0];
        if (newSubject) {
            // Remove version property
            memberStore.removeQuad(
                df.quad(
                    <Quad_Subject>member.id,
                    <Quad_Predicate>ldesInfo.isVersionOfPath,
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
            console.error(
                `No version property found in Member (${member.id}) as specified by ldes:isVersionOfPath ${ldesInfo.isVersionOfPath}`,
            );
        }
    }

    return member;
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
