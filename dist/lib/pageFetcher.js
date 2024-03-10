"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Fetcher = exports.resetPromise = exports.longPromise = exports.DefaultFetcherConfig = void 0;
const page_1 = require("./page");
const debug_1 = require("debug");
const rdf_stores_1 = require("rdf-stores");
const rdf_data_factory_1 = require("rdf-data-factory");
const log = (0, debug_1.default)("fetcher");
const { namedNode } = new rdf_data_factory_1.DataFactory();
exports.DefaultFetcherConfig = {
    concurrentRequests: 10,
    maxFetched: 10,
};
function longPromise() {
    const out = {};
    out.waiting = new Promise((res) => (out.callback = res));
    return out;
}
exports.longPromise = longPromise;
function resetPromise(promise) {
    const cb = promise.callback;
    promise.waiting = new Promise((res) => (promise.callback = res));
    cb();
}
exports.resetPromise = resetPromise;
class Fetcher {
    dereferencer;
    loose;
    after;
    before;
    constructor(dereferencer, loose, after, before) {
        this.dereferencer = dereferencer;
        this.loose = loose;
        if (after)
            this.after = after;
        if (before)
            this.before = before;
    }
    async fetch(node, state, notifier) {
        const logger = log.extend("fetch");
        const resp = await this.dereferencer.dereference(node.target, {
            localFiles: true,
        });
        node.target = resp.url;
        const cache = {};
        if (resp.headers) {
            const cacheControlCandidate = resp.headers.get("cache-control");
            if (cacheControlCandidate) {
                const controls = cacheControlCandidate
                    .split(",")
                    .map((x) => x.split("=", 2).map((x) => x.trim()));
                for (let control of controls) {
                    if (control[0] == "max-age") {
                        cache.maxAge = parseInt(control[1]);
                    }
                    if (control[0] == "immutable") {
                        cache.immutable = true;
                    }
                }
            }
        }
        if (!cache.immutable) {
            notifier.scheduleFetch(node, state);
        }
        logger("Cache for  %s %o", node.target, cache);
        const data = rdf_stores_1.RdfStore.createDefault();
        let quadCount = 0;
        await new Promise((resolve, reject) => {
            resp.data
                .on("data", (quad) => {
                data.addQuad(quad);
                quadCount++;
            })
                .on("end", resolve)
                .on("error", reject);
        });
        logger("Got data %s (%d quads)", node.target, quadCount);
        for (let rel of (0, page_1.extractRelations)(data, namedNode(resp.url), this.loose, this.after, this.before)) {
            if (!node.expected.some((x) => x == rel.node)) {
                notifier.relationFound({ from: node, target: rel }, state);
            }
        }
        // TODO check this, is node.target correct?
        notifier.pageFetched({ data, url: resp.url }, state);
    }
}
exports.Fetcher = Fetcher;
