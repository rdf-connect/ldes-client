import { Config, intoConfig } from "./config";
import { Member } from "./page";
import { rdfDereferencer, RdfDereferencer } from "rdf-dereference";
import { FileStateFactory, NoStateFactory, StateFactory } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { Writer as NWriter } from "n3";
import { Quad_Object, Term } from "@rdfjs/types";
import { enhanced_fetch, extractMainNodeShape, getObjects, ModulatorFactory, Notifier, streamToArray } from "./utils";
import { LDES, SDS, TREE } from "@treecg/types";
import { FetchedPage, Fetcher, longPromise, resetPromise } from "./pageFetcher";
import { Manager } from "./memberManager";
import { OrderedStrategy, StrategyEvents, UnorderedStrategy } from "./strategy";
import type { Writer } from "@rdfc/js-runner";
import { getLoggerFor } from "./utils/logUtil";

// import { ReadableStream } from "stream/web";
export { intoConfig } from "./config";
export { extractMainNodeShape, retry_fetch } from "./utils";
export {
    Condition,
    empty_condition,
    parse_condition,
    Range,
} from "./condition/index";
export type { Member, Page, Relation } from "./page";
export type { Config, ShapeConfig } from "./config";

const df = new DataFactory();

type Controller = ReadableStreamDefaultController<Member>;

export type Ordered = "ascending" | "descending" | "none";

export function replicateLDES(
    config: Partial<Config> & { url: string },
    ordered: Ordered = "none",
    dereferencer?: RdfDereferencer,
    streamId?: Term,
): Client {
    return new Client(intoConfig(config), ordered, dereferencer, streamId);
}

export type LDESInfo = {
    shape: Term;
    extractor: CBDShapeExtractor;
    timestampPath?: Term;
    isVersionOfPath?: Term;
};

async function getInfo(
    ldesId: Term,
    store: RdfStore,
    dereferencer: RdfDereferencer,
    config: Config,
): Promise<LDESInfo> {
    const logger = getLoggerFor("getShape");

    if (config.shapeFile) {
        const shapeId = config.shapeFile.startsWith("http")
            ? config.shapeFile
            : "file://" + config.shapeFile;

        const resp = await dereferencer.dereference(config.shapeFile, {
            localFiles: true,
            fetch: config.fetch,
        });
        const quads = await streamToArray(resp.data);
        config.shape = {
            quads: quads,
            shapeId: df.namedNode(shapeId),
        };
    }

    let shapeIds = config.noShape
        ? []
        : getObjects(store, ldesId, TREE.terms.shape);
    let timestampPaths = getObjects(store, ldesId, LDES.terms.timestampPath);
    let isVersionOfPaths = getObjects(store, ldesId, LDES.terms.versionOfPath);

    logger.debug(`Found ${shapeIds.length} shapes, ${timestampPaths.length} timestampPaths, ${isVersionOfPaths.length} isVersionOfPaths`);

    if (
        !config.noShape &&
        (shapeIds.length === 0 ||
            timestampPaths.length === 0 ||
            isVersionOfPaths.length === 0)
    ) {
        try {
            logger.debug(`Maybe find more info at ${ldesId.value}`);
            const resp = await dereferencer.dereference(ldesId.value, {
                localFiles: true,
                fetch: config.fetch,
            });
            store = RdfStore.createDefault();
            await new Promise((resolve, reject) => {
                store.import(resp.data).on("end", resolve).on("error", reject);
            });
            shapeIds = getObjects(store, null, TREE.terms.shape);
            timestampPaths = getObjects(store, null, LDES.terms.timestampPath);
            isVersionOfPaths = getObjects(store, null, LDES.terms.versionOfPath);
            logger.debug(`Found ${shapeIds.length} shapes, ${timestampPaths.length} timestampPaths, ${isVersionOfPaths.length} isVersionOfPaths`);
        } catch (ex: any) {
            logger.error(`Failed to fetch ${ldesId.value}`);
            logger.error(ex);
        }
    }

    if (shapeIds.length > 1) {
        logger.error("Expected at most one shape id, found " + shapeIds.length);
    }

    if (timestampPaths.length > 1) {
        logger.error(
            "Expected at most one timestamp path, found " + timestampPaths.length,
        );
    }

    if (isVersionOfPaths.length > 1) {
        logger.error(
            "Expected at most one versionOf path, found " + isVersionOfPaths.length,
        );
    }

    const shapeConfigStore = RdfStore.createDefault();
    if (config.shape) {
        for (const quad of config.shape.quads) {
            shapeConfigStore.addQuad(quad);
        }
        // Make sure the shapeId is as defined in the given shape file
        if (config.shape.shapeId.value.startsWith("file://")) {
            config.shape.shapeId = extractMainNodeShape(shapeConfigStore);
        }
    }

    return {
        extractor: new CBDShapeExtractor(
            config.shape ? shapeConfigStore : store,
            dereferencer,
            {
                cbdDefaultGraph: config.onlyDefaultGraph,
                fetch: config.fetch,
            },
        ),
        shape: config.shape ? config.shape.shapeId : shapeIds[0],
        timestampPath: timestampPaths[0],
        isVersionOfPath: isVersionOfPaths[0],
    };
}

type EventMap = Record<string, any>;

type EventKey<T extends EventMap> = string & keyof T;
type EventReceiver<T> = (params: T) => void;

export type ClientEvents = {
    fragment: void;
    mutable: void;
    poll: void;
    error: any;
};

export class Client {
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
        this.config = config;
        this.dereferencer = dereferencer ?? rdfDereferencer;

        this.streamId = stream;
        this.ordered = ordered;
        this.stateFactory = config.stateFile
            ? new FileStateFactory(config.stateFile)
            : new NoStateFactory();
        this.modulatorFactory = new ModulatorFactory(this.stateFactory);

        if (typeof process !== "undefined") {
            process.on("SIGINT", () => {
                this.logger.info("Caught interrupt signal, saving");
                this.stateFactory.write();
                process.exit();
            });
        }
    }

    on<K extends EventKey<ClientEvents>>(
        key: K,
        fn: EventReceiver<ClientEvents[K]>,
    ) {
        this.listeners[key] = (
            this.listeners[key] || <Array<(p: ClientEvents[K]) => void>>[]
        ).concat(fn);
    }

    async init(
        emit: (member: Member) => void,
        close: () => void,
        factory: ModulatorFactory,
    ): Promise<void> {
        // Fetch the url
        const root = await fetchPage(
            this.config.url,
            this.dereferencer,
            this.config.fetch,
        );
        // Try to get a shape
        // TODO Choose a view
        const viewQuads = root.data.getQuads(null, TREE.terms.view, null, null);

        let ldesId: Term = df.namedNode(this.config.url);
        if (!this.config.urlIsView) {
            if (viewQuads.length === 0) {
                this.logger.error(
                    "Did not find tree:view predicate, this is required to interpret the LDES",
                );
            } else {
                ldesId = viewQuads[0].object;
            }
        }

        const info = await getInfo(
            ldesId,
            root.data,
            this.dereferencer,
            this.config,
        );

        const state = this.stateFactory.build<Set<string>>(
            "members",
            (set) => {
                const arr = [...set.values()];
                return JSON.stringify(arr);
            },
            (inp) => new Set(JSON.parse(inp)),
            () => new Set(),
        );
        this.streamId = this.streamId || viewQuads[0].subject;
        this.memberManager = new Manager(
            this.streamId || viewQuads[0].subject,
            state.item,
            info,
        );

        this.logger.debug(`timestampPath ${!!info.timestampPath}`);

        if (this.ordered !== "none" && !info.timestampPath) {
            throw "Can only emit members in order, if LDES is configured with timestampPath";
        }

        this.fetcher = new Fetcher(
            this.dereferencer,
            this.config.loose,
            this.config.condition,
            this.config.fetch,
        );

        const notifier: Notifier<StrategyEvents, {}> = {
            error: (ex: any) => this.emit("error", ex),
            fragment: () => this.emit("fragment", undefined),
            member: (m) => {
                if (this.config.condition.matchMember(m)) {
                    emit(m);
                }
            },
            pollCycle: () => {
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

        this.strategy =
            this.ordered !== "none"
                ? new OrderedStrategy(
                    this.memberManager,
                    this.fetcher,
                    notifier,
                    factory,
                    this.ordered,
                    this.config.polling,
                    this.config.pollInterval,
                )
                : new UnorderedStrategy(
                    this.memberManager,
                    this.fetcher,
                    notifier,
                    factory,
                    this.config.polling,
                    this.config.pollInterval,
                );

        this.logger.debug(`Found ${viewQuads.length} views, choosing ${ldesId.value}`);
        this.strategy.start(ldesId.value);
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
                    this.modulatorFactory,
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
                this.strategy.cancel();
                this.memberManager.close();
                this.fetcher.close();
            },
        };

        const out = new ReadableStream(config, strategy);
        return out;
    }

    private emit<K extends EventKey<ClientEvents>>(
        key: K,
        data: ClientEvents[K],
    ) {
        (this.listeners[key] || []).forEach(function(fn) {
            fn(data);
        });
    }
}

async function fetchPage(
    location: string,
    dereferencer: RdfDereferencer,
    fetch_f?: typeof fetch,
): Promise<FetchedPage> {
    const resp = await dereferencer.dereference(location, {
        localFiles: true,
        fetch: fetch_f,
    });
    const url = resp.url;
    const data = RdfStore.createDefault();
    await new Promise((resolve, reject) => {
        data.import(resp.data).on("end", resolve).on("error", reject);
    });
    return <FetchedPage>{ url, data };
}

export async function processor(
    writer: Writer<string>,
    url: string,
    before?: Date,
    after?: Date,
    ordered?: string,
    follow?: boolean,
    pollInterval?: number,
    shape?: string,
    noShape?: boolean,
    save?: string,
    loose?: boolean,
    urlIsView?: boolean,
    fetch_config?: {
        auth?: {
            type: "basic";
            auth: string;
            host: string;
        };
        concurrent?: number;
        retry?: {
            codes: number[];
            maxRetries: number;
        };
    },
) {
    const logger = getLoggerFor("processor");

    if (fetch_config?.auth) {
        fetch_config.auth.host = new URL(url).host;
    }
    const client = replicateLDES(
        {
            loose,
            noShape,
            shapeFile: shape,
            polling: follow,
            url: url,
            stateFile: save,
            pollInterval: pollInterval,
            urlIsView,
            fetch: fetch_config ? enhanced_fetch(fetch_config) : fetch,
            // condition: todo
        },
        <Ordered>ordered || "none",
    );

    client.on("fragment", () => logger.verbose("Fragment!"));

    const reader = client.stream({ highWaterMark: 10 }).getReader();

    writer.on("end", async () => {
        await reader.cancel();
        logger.info("Writer closed, so closing reader as well.");
    });

    return async () => {
        let el = await reader.read();
        const seen = new Set();
        while (el) {
            if (el.value) {
                seen.add(el.value.id);

                if (seen.size % 100 == 1) {
                    logger.verbose(`Got member ${seen.size} with ${el.value.quads.length} quads`);
                }

                const blank = df.blankNode();
                const quads = el.value.quads.slice();
                quads.push(
                    df.quad(blank, SDS.terms.stream, <Quad_Object>client.streamId!),
                    df.quad(blank, SDS.terms.payload, <Quad_Object>el.value.id!),
                );

                await writer.push(new NWriter().quadsToString(quads));
            }

            if (el.done) {
                break;
            }

            el = await reader.read();
        }

        logger.verbose(`Found ${seen.size} members`);
    };
}
