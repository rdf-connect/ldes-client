"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retry_fetch = exports.handle_basic_auth = exports.limit_fetch_per_domain = exports.ModulatorFactory = exports.extractMainNodeShape = exports.streamToArray = exports.readableToArray = exports.getObjects = exports.getSubjects = void 0;
const types_1 = require("@treecg/types");
const debug_1 = require("debug");
function getSubjects(store, predicate, object, graph) {
    return store.getQuads(null, predicate, object, graph).map((quad) => {
        return quad.subject;
    });
}
exports.getSubjects = getSubjects;
function getObjects(store, subject, predicate, graph) {
    return store.getQuads(subject, predicate, null, graph).map((quad) => {
        return quad.object;
    });
}
exports.getObjects = getObjects;
function readableToArray(stream) {
    const out = [];
    const reader = stream.getReader();
    return new Promise(async (res, rej) => {
        let obj = await reader.read().catch(rej);
        while (obj) {
            if (obj.done) {
                res(out);
                break;
            }
            if (obj.value)
                out.push(obj.value);
            obj = await reader.read().catch(rej);
        }
    });
}
exports.readableToArray = readableToArray;
/**
 * Converts a stream to an array, pushing all elements to an array
 * Resolving the promise with the 'end' event
 */
function streamToArray(stream) {
    const out = [];
    return new Promise(async (res, rej) => {
        stream.on("end", () => res(out));
        stream.on("data", (x) => {
            out.push(x);
        });
        stream.on("error", (ex) => {
            console.error("Stream to Array failed");
            rej(ex);
        });
    });
}
exports.streamToArray = streamToArray;
/**
 * Find the main sh:NodeShape subject of a given Shape Graph.
 * We determine this by assuming that the main node shape
 * is not referenced by any other shape description.
 * If more than one is found an exception is thrown.
 */
function extractMainNodeShape(store) {
    const nodeShapes = getSubjects(store, types_1.RDF.terms.type, types_1.SHACL.terms.NodeShape, null);
    let mainNodeShape = null;
    if (nodeShapes && nodeShapes.length > 0) {
        for (const ns of nodeShapes) {
            const isNotReferenced = getSubjects(store, null, ns, null).length === 0;
            if (isNotReferenced) {
                if (!mainNodeShape) {
                    mainNodeShape = ns;
                }
                else {
                    throw new Error("There are multiple main node shapes in a given shape graph. Unrelated shapes must be given as separate shape graphs");
                }
            }
        }
        if (mainNodeShape) {
            return mainNodeShape;
        }
        else {
            throw new Error("No main SHACL Node Shapes found in given shape graph");
        }
    }
    else {
        throw new Error("No SHACL Node Shapes found in given shape graph");
    }
}
exports.extractMainNodeShape = extractMainNodeShape;
/**
 * Factory that creates Modulator's
 * This is a factory to keep track whether or not the Modulator should be paused or not.
 */
class ModulatorFactory {
    concurrent = 10;
    paused = false;
    factory;
    children = [];
    constructor(stateFactory, concurrent) {
        this.factory = stateFactory;
        if (concurrent) {
            this.concurrent = concurrent;
        }
    }
    /**
     * Note: `T` should be plain javascript objects (because that how state is saved)
     */
    create(name, ranker, notifier, parse) {
        const state = this.factory.build(name, JSON.stringify, JSON.parse, () => ({
            todo: [],
            inflight: [],
        }));
        if (parse) {
            state.item.todo = state.item.todo.map(({ item, index }) => ({
                index,
                item: parse(item),
            }));
            state.item.inflight = state.item.inflight.map(({ item, index }) => ({
                index,
                item: parse(item),
            }));
        }
        const modulator = new ModulatorInstance(state, ranker, notifier, this);
        this.children.push(modulator);
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
exports.ModulatorFactory = ModulatorFactory;
class ModulatorInstance {
    at = 0;
    index = 0;
    state;
    ranker;
    notifier;
    factory;
    constructor(state, ranker, notifier, factory) {
        this.state = state;
        const readd = [...this.state.item.todo, ...this.state.item.inflight];
        this.state.item.todo.push(...this.state.item.inflight);
        while (this.state.item.inflight.pop()) { }
        while (this.state.item.todo.pop()) { }
        this.ranker = ranker;
        this.notifier = notifier;
        this.factory = factory;
        for (let item of readd) {
            this.push(item.item);
        }
    }
    length() {
        return this.state.item.todo.length;
    }
    push(item) {
        const indexed = { item, index: this.index };
        this.state.item.todo.push(indexed);
        this.index += 1;
        this.ranker.push(indexed);
        this.checkReady();
    }
    finished(index) {
        const removeIdx = this.state.item.inflight.findIndex((x) => x.index == index);
        if (removeIdx >= 0) {
            this.state.item.inflight.splice(removeIdx, 1);
        }
        else {
            console.error("Expected to be able to remove inflight item");
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
                const removeIdx = this.state.item.todo.findIndex((x) => x.index == item.index);
                if (removeIdx >= 0) {
                    this.state.item.todo.splice(removeIdx, 1);
                }
                else {
                    console.error("Expected to be able to remove inflight item");
                }
                // This item is now inflight
                this.state.item.inflight.push(item);
                this.at += 1;
                this.notifier.ready(item, {});
            }
            else {
                break;
            }
        }
    }
}
function urlToUrl(input) {
    if (typeof input === "string") {
        return new URL(input);
    }
    else if (input instanceof URL) {
        return input;
    }
    else if (input instanceof Request) {
        return new URL(input.url);
    }
    else {
        throw "Not a real url";
    }
}
const log = (0, debug_1.default)("fetch");
function limit_fetch_per_domain(fetch_f, concurrent) {
    const logger = log.extend("limit");
    const domain_dict = {};
    const out = async (input, init) => {
        let url = urlToUrl(input);
        const domain = url.origin;
        if (!(domain in domain_dict)) {
            domain_dict[domain] = [];
        }
        const requests = domain_dict[domain];
        await new Promise((res) => {
            logger("%s capacity %d/%d", domain, requests.length, concurrent);
            if (requests.length < concurrent) {
                requests.push(res);
                res({});
            }
            else {
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
exports.limit_fetch_per_domain = limit_fetch_per_domain;
function handle_basic_auth(fetch_f, basicAuth, domain) {
    const logger = log.extend("auth");
    let authRequired = false;
    const basicAuthValue = `Basic ${Buffer.from(basicAuth).toString("base64")}`;
    const setHeader = (init) => {
        const reqInit = init || {};
        const headers = new Headers(reqInit.headers);
        headers.set("Authorization", basicAuthValue);
        reqInit.headers = headers;
        return reqInit;
    };
    const auth_f = async (input, init) => {
        let url = urlToUrl(input);
        if (authRequired && url.host === domain.host) {
            return await fetch_f(input, setHeader(init));
        }
        const resp = await fetch_f(input, init);
        if (resp.status === 401) {
            logger("Unauthorized, adding basic auth");
            if (url.host === domain.host) {
                authRequired = true;
                return await fetch_f(input, setHeader(init));
            }
        }
        return resp;
    };
    return auth_f;
}
exports.handle_basic_auth = handle_basic_auth;
function retry_fetch(fetch_f, httpCodes, base = 500, maxRetries = 5) {
    const logger = log.extend("retry");
    const retry = async (input, init) => {
        let tryCount = 0;
        let retryTime = base;
        while (tryCount < maxRetries) {
            const resp = await fetch_f(input, init);
            if (!resp.ok) {
                if (httpCodes.some((x) => x == resp.status)) {
                    logger("Retry %s %d/%d", input, tryCount, maxRetries);
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
        throw "Max retries";
    };
    return retry;
}
exports.retry_fetch = retry_fetch;
