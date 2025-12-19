import { RdfDereferencer, rdfDereferencer } from "rdf-dereference";
import { LDES, RDF, TREE } from "@treecg/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { intoConfig } from "./config";
import { handleConditions } from "./condition";
import { FileStateFactory, NoStateFactory } from "./state";
import { OrderedStrategy, UnorderedStrategy } from "./strategy";
import {
    ModulatorFactory,
    Fetcher,
    longPromise,
    resetPromise,
    Manager,
    statelessPageFetch
} from "./fetcher";
import {
    extractMainNodeShape,
    getObjects,
    maybeVersionMaterialize,
    streamToArray,
    getLoggerFor,
    handleExit
} from "./utils";

import type { Term } from "@rdfjs/types";
import type { Config } from "./config";
import type { StateFactory } from "./state";
import type { Ordered, StrategyEvents } from "./strategy";
import type { LDESInfo, Notifier, FetchedPage, Member } from "./fetcher";

// RDF-JS data factory
const df = new DataFactory();

// Local types
type Controller = ReadableStreamDefaultController<Member>;
type EventMap = Record<string, unknown>;
type EventKey<T extends EventMap> = string & keyof T;
type EventReceiver<T> = (params: T) => void;

// Re-export util functions
export { enhanced_fetch } from "./fetcher";
export { intoConfig } from "./config";
export { processConditionFile } from "./condition";

export type ClientEvents = {
    fragment: FetchedPage;
    description: LDESInfo;
    mutable: void;
    poll: void;
    error: unknown;
};

export function replicateLDES(
    config: Partial<Config> & { url: string },
    ordered: Ordered = "none",
    dereferencer?: RdfDereferencer,
    streamId?: Term,
): Client {
    return new Client(intoConfig(config), ordered, dereferencer, streamId);
}

export class Client {
    public memberCount: number;
    public fragmentCount: number;
    public streamId?: Term;
    private config: Config;
    private dereferencer: RdfDereferencer;
    private fetcher!: Fetcher;
    private memberManager!: Manager;
    private strategy!: OrderedStrategy | UnorderedStrategy;
    private ordered: Ordered;

    private modulatorFactory: ModulatorFactory;

    private stateFactory: StateFactory;

    private listeners: {
        [K in keyof ClientEvents]?: Array<(p: ClientEvents[K]) => void>;
    } = {};

    private logger = getLoggerFor(this);

    constructor(
        config: Config,
        ordered: Ordered = "none",
        dereferencer?: RdfDereferencer,
        stream?: Term,
    ) {
        this.memberCount = 0;
        this.fragmentCount = 0;
        this.config = config;
        this.dereferencer = dereferencer ?? rdfDereferencer;

        this.streamId = stream;
        this.ordered = ordered;
        this.stateFactory = config.stateFile
            ? new FileStateFactory(config.stateFile)
            : new NoStateFactory();
        this.modulatorFactory = new ModulatorFactory(this.stateFactory);

        if (typeof process !== "undefined") {
            // Handle exit gracefully
            handleExit(() => {
                // Save state if any
                this.stateFactory.write();
            });
        }
    }

    on<K extends EventKey<ClientEvents>>(
        key: K,
        fn: EventReceiver<ClientEvents[K]>,
    ) {
        if (!this.listeners[key]) {
            this.listeners[key] = [];
        }
        this.listeners[key].push(fn);
    }

    async init(
        streamOut: (member: Member) => void,
        close: () => void,
    ): Promise<void> {
        // Fetch the given root URL
        const root: FetchedPage = await statelessPageFetch(
            this.config.url,
            this.dereferencer,
            this.config.fetch,
        );
        this.fragmentCount++;
        this.emit("fragment", root);

        // Determine if the URL was a local dump
        const isLocalDump = !this.config.url.startsWith("http");

        // Set the LDES ID accordingly
        const ldesId: Term = isLocalDump
            ? df.namedNode("file://" + this.config.url)
            : df.namedNode(this.config.url);

        //*****************************************************************
        // TODO: Handle the case where there are multiple views available 
        // through a discovery process.
        //*****************************************************************
        const viewQuads = root.data.getQuads(null, TREE.terms.view, null, null);
        let viewId: Term;

        if (this.config.urlIsView) {
            viewId = ldesId;
        } else {
            if (viewQuads.length === 0) {
                this.logger.error(
                    "Did not find a tree:view predicate, which is required to interpret the LDES. " +
                    "If you are targeting a tree:view directly, use the '--url-is-view' option.",
                );
                throw "No view found";
            } else {
                viewId = viewQuads[0].object;
            }
        }

        // This is the actual LDES IRI found in the RDF data. 
        // Might be different from the configured ldesId due to HTTP redirects 
        const ldesUri = viewQuads[0]?.subject ||
            root.data.getQuads(null, RDF.terms.type, LDES.terms.EventStream)[0].subject;
        if (!ldesUri) {
            this.logger.error("Could not find the LDES IRI in the fetched RDF data.");
            throw "No LDES IRI found";
        }
        // This is the ID of the stream of data we are replicating.
        // Normally it corresponds to the actual LDES IRI, unless externally specified.
        // This is used mainly for metadata descriptions.
        this.streamId = this.streamId || ldesUri;

        // Extract the main LDES information (e.g., timestampPath, versionOfPath, etc.)
        const info: LDESInfo = await getInfo(
            ldesUri,
            viewId,
            root.data,
            this.dereferencer,
            this.config,
        );
        this.emit("description", info);

        // Build state entry to keep track of member versions
        const versionState = this.config.lastVersionOnly
            ? this.stateFactory.build<Map<string, Date>>(
                "versions",
                (map) => {
                    const arr = [...map.entries()];
                    return JSON.stringify(arr);
                },
                (inp) => {
                    const obj = JSON.parse(inp);
                    for (const key of Object.keys(obj)) {
                        try {
                            obj[key] = new Date(obj[key]);
                        } catch (ex: unknown) {
                            // pass
                        }
                    }
                    return new Map(obj);
                },
                () => new Map(),
            )
            : undefined;

        // Component that manages the extraction of all members from every fetched page
        this.memberManager = new Manager(
            isLocalDump
                ? null // Local dump does not need to dereference a view
                : ldesUri, // Point to the actual LDES IRI
            info,
            this.config.loose,
        );

        this.logger.debug(`timestampPath: ${!!info.timestampPath}`);

        if (this.ordered !== "none" && !info.timestampPath) {
            throw "Can only emit members in order, if LDES is configured with timestampPath";
        }

        // Handle and assemble condition object if needed
        this.config.condition = handleConditions(
            this.config.condition,
            this.config.defaultTimezone,
            this.config.before,
            this.config.after,
            info.timestampPath,
        );

        // Component that manages the fetching of RDF data over HTTP
        this.fetcher = new Fetcher(
            this.dereferencer,
            this.config.loose,
            this.config.condition,
            this.config.defaultTimezone,
            this.config.includeMetadata || false,
            this.config.fetch,
        );

        // Event handler object that listens for various runtime events (e.g., page fetching, member extraction, etc.)
        const notifier: Notifier<StrategyEvents, unknown> = {
            error: (ex: unknown) => this.emit("error", ex),
            fragment: (fragment: FetchedPage) => {
                this.emit("fragment", fragment);
                this.fragmentCount++;
            },
            member: (m) => {
                if (this.config.condition.matchMember(m)) {
                    this.config.condition.memberEmitted(m);
                    // Check if this is a newer version of this member (if we are extracting the last version only)
                    if (m.isVersionOf && m.timestamp && versionState) {
                        const versions = versionState.item;

                        if (versions.has(m.isVersionOf)) {
                            const registeredDate = <Date>(
                                versions.get(m.isVersionOf)
                            );
                            if (<Date>m.timestamp > registeredDate) {
                                // We got a newer version
                                versions.set(m.isVersionOf, <Date>m.timestamp);
                            } else {
                                // This is an older version, so we ignore it
                                return;
                            }
                        } else {
                            // First time we see this member
                            versions.set(
                                JSON.parse(JSON.stringify(m.isVersionOf)),
                                <Date>m.timestamp,
                            );
                        }
                    }
                    // Check if versioned member is to be materialized
                    streamOut(
                        maybeVersionMaterialize(
                            m,
                            this.config.materialize === true,
                            info,
                        ),
                    );
                    this.memberCount++;
                }
            },
            pollCycle: () => {
                this.config.condition.poll();
                this.emit("poll", undefined);
            },
            mutable: () => {
                this.emit("mutable", undefined);
            },
            close: () => {
                this.stateFactory.write();
                close();
            },
        };

        // Opt for descending order strategy if last version only is true, to start reading at the newest end.
        if (this.config.lastVersionOnly) this.ordered = "descending";

        // Fetching strategy definition, i.e., whether to use ordered or unordered fetching;
        // keep on polling the LDES (mutable pages) for new data or finish when fully fetched.
        this.strategy =
            this.ordered !== "none"
                ? new OrderedStrategy(
                    this.memberManager,
                    this.fetcher,
                    notifier,
                    this.modulatorFactory,
                    this.ordered,
                    this.config.polling,
                    this.config.pollInterval,
                )
                : new UnorderedStrategy(
                    this.memberManager,
                    this.fetcher,
                    notifier,
                    this.modulatorFactory,
                    this.config.polling,
                    this.config.pollInterval,
                );

        if (!isLocalDump) this.logger.debug(
            `Found ${viewQuads.length} views, choosing ${viewId.value}`,
        );

        this.strategy.start(viewId.value, isLocalDump ? root : undefined);
    }

    stream(strategy?: {
        highWaterMark?: number;
        size?: (chunk: Member) => number;
    }): ReadableStream<Member> {
        const emitted = longPromise();
        const config: UnderlyingDefaultSource = {
            //
            // Called when starting the stream
            //
            start: async (controller: Controller) => {
                this.on("error", (error) => {
                    this.stateFactory.write();
                    this.memberManager.close();
                    this.fetcher.close();
                    controller.error(error);
                });

                this.modulatorFactory.pause();
                await this.init(
                    (member) => {
                        controller.enqueue(member);
                        resetPromise(emitted);
                    },
                    () => controller.close(),
                );
            },

            //
            // Called when the internal buffer is not full
            //
            pull: async () => {
                resetPromise(emitted);
                this.modulatorFactory.unpause();
                await emitted.waiting;
                this.modulatorFactory.pause();
                return;
            },

            //
            // Called when canceled
            //
            cancel: async () => {
                this.logger.info("Stream canceled");
                this.stateFactory.write();
                this.strategy?.cancel();
                this.memberManager?.close();
                this.fetcher?.close();
            },
        };

        return new ReadableStream(config, strategy);
    }

    private emit<K extends EventKey<ClientEvents>>(
        key: K,
        data: ClientEvents[K],
    ) {
        (this.listeners[key] || []).forEach(function (fn) {
            fn(data);
        });
    }
}

/**
 * Fetches and determines the main LDES information, such as the shape, timestampPath, versionOfPath, etc.
 */
async function getInfo(
    ldesId: Term,
    viewId: Term,
    store: RdfStore,
    dereferencer: RdfDereferencer,
    config: Config,
): Promise<LDESInfo> {
    const logger = getLoggerFor("getShape");

    if (config.shapeFile) {
        // Shape file is given externally, so we need to fetch it
        const shapeId = config.shapeFile.startsWith("http")
            ? config.shapeFile
            : "file://" + config.shapeFile;
        try {
            const resp = await rdfDereferencer.dereference(config.shapeFile, {
                localFiles: true,
                fetch: config.fetch,
            });
            const quads = await streamToArray(resp.data);
            config.shape = {
                quads: quads,
                shapeId: df.namedNode(shapeId),
            };
            quads.forEach((quad) => store.addQuad(quad));
        } catch (ex) {
            logger.error(`Failed to fetch shape from ${shapeId}`);
            throw ex;
        }
    }

    let shapeIds;
    let timestampPaths;
    let versionOfPaths;

    const isLocalDump = ldesId.value.startsWith("file://");

    if (isLocalDump) {
        // We are dealing with a local dump LDES
        shapeIds = config.noShape ? [] : getObjects(store, null, TREE.terms.shape);
        timestampPaths = getObjects(store, null, LDES.terms.timestampPath);
        versionOfPaths = getObjects(store, null, LDES.terms.versionOfPath);
    } else {
        // This is a normal LDES on the Web
        shapeIds = config.noShape ? [] : getObjects(store, ldesId, TREE.terms.shape);
        timestampPaths = getObjects(store, ldesId, LDES.terms.timestampPath);
        versionOfPaths = getObjects(store, ldesId, LDES.terms.versionOfPath);
    }

    logger.debug(
        `Found ${shapeIds.length} shapes, ${timestampPaths.length} timestampPaths, ${versionOfPaths.length} versionOfPaths`,
    );

    // Only try to dereference the view if we are not dealing with a local dump
    if (isLocalDump) {
        logger.debug("Ignoring view since this is a local dump");
    } else if (shapeIds.length === 0 || timestampPaths.length === 0 || versionOfPaths.length === 0) {
        let tryAgainUrl = viewId.value;
        if (config.urlIsView) {
            tryAgainUrl = ldesId.value;
        }
        try {
            logger.debug(`Maybe find more info at ${tryAgainUrl}`);
            const resp = await dereferencer.dereference(tryAgainUrl, {
                localFiles: true,
                fetch: config.fetch,
            });
            await new Promise((resolve, reject) => {
                store.import(resp.data).on("end", resolve).on("error", reject);
            });

            const shapeInView = getObjects(store, null, TREE.terms.shape);
            if (shapeInView) {
                shapeIds = config.noShape ? [] : shapeInView;
            }

            if (!timestampPaths.length) {
                timestampPaths = getObjects(store, null, LDES.terms.timestampPath);
            }
            if (!versionOfPaths.length) {
                versionOfPaths = getObjects(store, null, LDES.terms.versionOfPath);
            }
            logger.debug(
                `Found ${shapeIds.length} shapes, ${timestampPaths.length} timestampPaths, ${versionOfPaths.length} isVersionOfPaths`,
            );
        } catch (ex: unknown) {
            logger.error(`Failed to fetch ${tryAgainUrl}`);
            logger.error(ex);
        }
    }

    if (shapeIds.length > 1) {
        logger.error(`Expected at most one shape id, found ${shapeIds.length}`);
    }

    if (timestampPaths.length > 1) {
        logger.error(`Expected at most one timestamp path, found ${timestampPaths.length}`);
    }

    if (versionOfPaths.length > 1) {
        logger.error(`Expected at most one versionOf path, found ${versionOfPaths.length}`);
    }

    const shapeConfigStore = RdfStore.createDefault();
    if (config.shape) {
        for (const quad of config.shape.quads) {
            shapeConfigStore.addQuad(quad);
        }
        // Make sure the shapeId is as defined in the given shape file
        config.shape.shapeId = extractMainNodeShape(shapeConfigStore);
    } else {
        const shapeId = shapeIds[0];
        if (shapeId &&
            shapeId.termType === 'NamedNode' &&
            store.getQuads(shapeId, null, null).length === 0
        ) {
            // Dereference out-of-band shape
            const respShape = await rdfDereferencer.dereference(shapeId.value);
            await new Promise((resolve, reject) => {
                shapeConfigStore.import(respShape.data)
                    .on("end", resolve)
                    .on("error", reject);
            });
        }
    }

    const shapeStore = shapeIds.length > 0 ? store : shapeConfigStore;

    return {
        extractor: new CBDShapeExtractor(shapeStore, dereferencer, {
            cbdDefaultGraph: config.onlyDefaultGraph,
            fetch: config.fetch,
        }),
        shape: config.shape ? config.shape.shapeId : shapeIds[0],
        timestampPath: timestampPaths[0],
        versionOfPath: versionOfPaths[0],
        shapeQuads: shapeStore.getQuads(),
    };
}