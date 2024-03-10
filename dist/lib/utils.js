"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModulatorFactory = exports.maybeVersionMaterialize = exports.extractMainNodeShape = exports.streamToArray = exports.readableToArray = exports.getObjects = exports.getSubjects = void 0;
const n3_1 = require("n3");
const rdf_stores_1 = require("rdf-stores");
const types_1 = require("@treecg/types");
const { quad } = n3_1.DataFactory;
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
 * Version materialization function that sets the declared ldes:versionOfPath property value
 * as the member's subject IRI
 */
function maybeVersionMaterialize(member, materialize, ldesInfo) {
    if (materialize && ldesInfo.isVersionOfPath) {
        // Create RDF store with member quads
        const memberStore = rdf_stores_1.RdfStore.createDefault();
        member.quads.forEach(q => memberStore.addQuad(q));
        // Get materialized subject IRI
        const newSubject = getObjects(memberStore, member.id, ldesInfo.isVersionOfPath)[0];
        if (newSubject) {
            // Remove version property
            memberStore.removeQuad(quad(member.id, ldesInfo.isVersionOfPath, newSubject));
            // Updated all quads with materialized subject
            for (const q of memberStore.getQuads(member.id)) {
                //q.subject = <Quad_Subject>newSubject;
                const newQ = quad(newSubject, q.predicate, q.object, q.graph);
                memberStore.removeQuad(q);
                memberStore.addQuad(newQ);
            }
            // Update member object
            member.id = newSubject;
            member.quads = memberStore.getQuads();
        }
        else {
            console.error(`No version property found in Member (${member.id}) as specified by ldes:isVersionOfPath`);
        }
    }
    return member;
}
exports.maybeVersionMaterialize = maybeVersionMaterialize;
/**
 * Factory that creates Modulators
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
            console.log("Readding");
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
