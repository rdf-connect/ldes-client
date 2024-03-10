"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processor = exports.Client = exports.replicateLDES = exports.intoConfig = void 0;
const config_1 = require("./config");
const rdf_dereference_1 = require("rdf-dereference");
const state_1 = require("./state");
const extract_cbd_shape_1 = require("extract-cbd-shape");
const rdf_stores_1 = require("rdf-stores");
const n3_1 = require("n3");
const utils_1 = require("./utils");
const types_1 = require("@treecg/types");
const pageFetcher_1 = require("./pageFetcher");
const memberManager_1 = require("./memberManager");
const strategy_1 = require("./strategy");
const debug_1 = require("debug");
var config_2 = require("./config");
Object.defineProperty(exports, "intoConfig", { enumerable: true, get: function () { return config_2.intoConfig; } });
const log = (0, debug_1.default)("client");
const { namedNode, blankNode, quad } = n3_1.DataFactory;
function replicateLDES(config, states = {}, streamId, ordered = "none") {
    return new Client(config, states, streamId, ordered);
}
exports.replicateLDES = replicateLDES;
async function getInfo(ldesId, store, dereferencer, config) {
    const logger = log.extend("getShape");
    const shapeConfigStore = rdf_stores_1.RdfStore.createDefault();
    if (config.shapeFiles && config.shapeFiles.length > 0) {
        config.shapes = [];
        for (const shapeFile of config.shapeFiles) {
            const tempShapeStore = rdf_stores_1.RdfStore.createDefault();
            const shapeId = shapeFile.startsWith("http")
                ? shapeFile
                : "file://" + shapeFile;
            const resp = await rdf_dereference_1.default.dereference(shapeFile, {
                localFiles: true,
            });
            const quads = await (0, utils_1.streamToArray)(resp.data);
            // Add retrieved quads to local stores
            quads.forEach(q => {
                tempShapeStore.addQuad(q);
                shapeConfigStore.addQuad(q);
            });
            if (shapeId.startsWith("file://")) {
                // We have to find the actual IRI/Blank Node of the main shape within the file
                config.shapes.push({
                    quads,
                    shapeId: (0, utils_1.extractMainNodeShape)(tempShapeStore)
                });
            }
            else {
                config.shapes.push({
                    quads: quads,
                    shapeId: namedNode(shapeId),
                });
            }
        }
    }
    let shapeIds = config.noShape
        ? []
        : (0, utils_1.getObjects)(store, ldesId, types_1.TREE.terms.shape);
    let timestampPaths = (0, utils_1.getObjects)(store, ldesId, types_1.LDES.terms.timestampPath);
    let isVersionOfPaths = (0, utils_1.getObjects)(store, ldesId, types_1.LDES.terms.versionOfPath);
    logger("Found %d shapes, %d timestampPaths, %d isVersionOfPaths", shapeIds.length, timestampPaths.length, isVersionOfPaths.length);
    if (!config.noShape &&
        (shapeIds.length === 0 ||
            timestampPaths.length === 0 ||
            isVersionOfPaths.length === 0)) {
        try {
            logger("Maybe find more info at %s", ldesId.value);
            const resp = await dereferencer.dereference(ldesId.value, {
                localFiles: true,
            });
            store = rdf_stores_1.RdfStore.createDefault();
            await new Promise((resolve, reject) => {
                store.import(resp.data).on("end", resolve).on("error", reject);
            });
            shapeIds = (0, utils_1.getObjects)(store, null, types_1.TREE.terms.shape);
            timestampPaths = (0, utils_1.getObjects)(store, null, types_1.LDES.terms.timestampPath);
            isVersionOfPaths = (0, utils_1.getObjects)(store, null, types_1.LDES.terms.versionOfPath);
            logger("Found %d shapes, %d timestampPaths, %d isVersionOfPaths", shapeIds.length, timestampPaths.length, isVersionOfPaths.length);
        }
        catch (ex) { }
    }
    if (timestampPaths.length > 1) {
        console.error("Expected at most one timestamp path, found " + timestampPaths.length);
    }
    if (isVersionOfPaths.length > 1) {
        console.error("Expected at most one versionOf path, found " + isVersionOfPaths.length);
    }
    // Create a map of shapes and member types
    const shapeMap = new Map();
    if (config.shapes) {
        for (const shape of config.shapes) {
            const memberType = (0, utils_1.getObjects)(shapeConfigStore, shape.shapeId, types_1.SHACL.terms.targetClass)[0];
            if (memberType) {
                shapeMap.set(memberType.value, shape.shapeId);
            }
            else {
                console.error("Ignoring SHACL shape without a declared sh:targetClass: ", shape.shapeId);
            }
        }
    }
    else {
        for (const shapeId of shapeIds) {
            const memberType = (0, utils_1.getObjects)(store, shapeId, types_1.SHACL.terms.targetClass)[0];
            if (memberType) {
                shapeMap.set(memberType.value, shapeId);
            }
            else {
                console.error("Ignoring SHACL shape without a declared sh:targetClass: ", shapeId);
            }
        }
    }
    return {
        extractor: new extract_cbd_shape_1.CBDShapeExtractor(config.shapes && config.shapes.length > 0 ? shapeConfigStore : store, dereferencer, {
            cbdDefaultGraph: config.onlyDefaultGraph,
        }),
        shapeMap: config.noShape ? undefined : shapeMap,
        timestampPath: timestampPaths[0],
        isVersionOfPath: isVersionOfPaths[0],
    };
}
class Client {
    config;
    dereferencer;
    fetcher;
    memberManager;
    strategy;
    streamId;
    ordered;
    modulatorFactory;
    pollCycle = [];
    stateFactory;
    listeners = {};
    constructor(config, { dereferencer, } = {}, stream, ordered = "none") {
        this.config = config;
        this.dereferencer = dereferencer ?? rdf_dereference_1.default;
        this.streamId = stream;
        this.ordered = ordered;
        this.stateFactory = config.stateFile
            ? new state_1.FileStateFactory(config.stateFile)
            : new state_1.NoStateFactory();
        this.modulatorFactory = new utils_1.ModulatorFactory(this.stateFactory);
        if (process) {
            process.on("SIGINT", () => {
                console.log("Caught interrupt signal, saving");
                this.stateFactory.write();
                process.exit();
            });
        }
    }
    on(key, fn) {
        this.listeners[key] = (this.listeners[key] || []).concat(fn);
    }
    emit(key, data) {
        (this.listeners[key] || []).forEach(function (fn) {
            fn(data);
        });
    }
    addPollCycle(cb) {
        this.pollCycle.push(cb);
    }
    async init(emit, close, factory) {
        const logger = log.extend("init");
        // Fetch the url
        const root = await fetchPage(this.config.url, this.dereferencer);
        // Try to get a shape
        // TODO Choose a view
        const viewQuads = root.data.getQuads(null, types_1.TREE.terms.view, null, null);
        let ldesId = namedNode(this.config.url);
        if (!this.config.urlIsView) {
            if (viewQuads.length === 0) {
                console.error("Did not find tree:view predicate, this is required to interpret the LDES");
            }
            else {
                ldesId = viewQuads[0].object;
            }
        }
        const info = await getInfo(ldesId, root.data, this.dereferencer, this.config);
        const state = this.stateFactory.build("members", (set) => {
            const arr = [...set.values()];
            return JSON.stringify(arr);
        }, (inp) => new Set(JSON.parse(inp)), () => new Set());
        this.streamId = this.streamId || viewQuads[0].subject;
        this.memberManager = new memberManager_1.Manager(this.streamId || viewQuads[0].subject, state.item, info);
        logger("timestampPath %o", !!info.timestampPath);
        if (this.ordered !== "none" && !info.timestampPath) {
            throw "Can only emit members in order, if LDES is configured with timestampPath";
        }
        this.fetcher = new pageFetcher_1.Fetcher(this.dereferencer, this.config.loose, this.config.after, this.config.before);
        const notifier = {
            fragment: () => this.emit("fragment", undefined),
            member: (m) => {
                // Check if member is within date constraints (if any)
                if (this.config.before) {
                    if (m.timestamp && m.timestamp instanceof Date && m.timestamp > this.config.before) {
                        return;
                    }
                }
                if (this.config.after) {
                    if (m.timestamp && m.timestamp instanceof Date && m.timestamp < this.config.after) {
                        return;
                    }
                }
                emit(m);
            },
            pollCycle: () => {
                this.emit("poll", undefined);
                this.pollCycle.forEach((cb) => cb());
            },
            close: () => {
                this.stateFactory.write();
                close();
            },
        };
        this.strategy =
            this.ordered !== "none"
                ? new strategy_1.OrderedStrategy(this.memberManager, this.fetcher, notifier, factory, this.ordered, this.config.polling, this.config.pollInterval)
                : new strategy_1.UnorderedStrategy(this.memberManager, this.fetcher, notifier, factory, this.config.polling, this.config.pollInterval);
        logger("Found %d views, choosing %s", viewQuads.length, ldesId.value);
        this.strategy.start(ldesId.value);
    }
    stream(strategy) {
        const emitted = (0, pageFetcher_1.longPromise)();
        const config = {
            start: async (controller) => {
                this.modulatorFactory.pause();
                await this.init((member) => {
                    controller.enqueue(member);
                    (0, pageFetcher_1.resetPromise)(emitted);
                }, () => controller.close(), this.modulatorFactory);
            },
            pull: async () => {
                (0, pageFetcher_1.resetPromise)(emitted);
                this.modulatorFactory.unpause();
                await emitted.waiting;
                this.modulatorFactory.pause();
                return;
            },
            cancel: async () => {
                this.stateFactory.write();
                console.log("Cancled");
                this.strategy.cancle();
            },
        };
        const out = new ReadableStream(config, strategy);
        return out;
    }
}
exports.Client = Client;
async function fetchPage(location, dereferencer) {
    const resp = await dereferencer.dereference(location, { localFiles: true });
    const url = resp.url;
    const data = rdf_stores_1.RdfStore.createDefault();
    await new Promise((resolve, reject) => {
        data.import(resp.data).on("end", resolve).on("error", reject);
    });
    return { url, data };
}
async function processor(writer, url, before, after, ordered, follow, pollInterval, shapes, noShape, save, loose, urlIsView, verbose) {
    const client = replicateLDES((0, config_1.intoConfig)({
        loose,
        noShape,
        shapeFiles: shapes,
        polling: follow,
        url: url,
        after,
        before,
        stateFile: save,
        follow,
        pollInterval: pollInterval,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
        urlIsView,
    }), undefined, undefined, ordered || "none");
    if (verbose) {
        client.on("fragment", () => console.error("Fragment!"));
    }
    return async () => {
        const reader = client.stream({ highWaterMark: 10 }).getReader();
        let el = await reader.read();
        const seen = new Set();
        while (el) {
            if (el.value) {
                seen.add(el.value.id);
                if (verbose) {
                    if (seen.size % 100 == 1) {
                        console.error("Got member", seen.size, "with", el.value.quads.length, "quads");
                    }
                }
                const blank = blankNode();
                const quads = el.value.quads.slice();
                quads.push(quad(blank, types_1.SDS.terms.stream, client.streamId), quad(blank, types_1.SDS.terms.payload, el.value.id));
                await writer.push(new n3_1.Writer().quadsToString(quads));
            }
            if (el.done) {
                break;
            }
            el = await reader.read();
        }
        if (verbose) {
            console.error("Found", seen.size, "members");
        }
    };
}
exports.processor = processor;
