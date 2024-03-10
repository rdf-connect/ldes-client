"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateT = exports.FileStateFactory = exports.NoStateFactory = exports.SimpleState = void 0;
const storage_1 = require("./storage");
class SimpleState {
    state;
    location;
    constructor(location) {
        this.location = location;
        this.state = new Set();
    }
    async init() {
        // Loaad location into state, or default
        // Take into account nodejs and browser runtimes
        //
        // Setup on exit hooks
    }
    filter(ids, getId) {
        return ids.filter(async (x) => !this.seen(getId(x)));
    }
    seen(id) {
        return this.state.has(id);
    }
    add(id) {
        this.state.add(id);
    }
    async save() {
        // Save state into location
    }
}
exports.SimpleState = SimpleState;
class NoStateFactory {
    build(_name, _serialize, deserialize, create) {
        return new StateT(deserialize, create);
    }
    write() {
    }
}
exports.NoStateFactory = NoStateFactory;
class FileStateFactory {
    location;
    elements;
    found;
    constructor(location) {
        this.location = location;
        this.elements = [];
        this.found = {};
        try {
            const item = storage_1.storage.getItem(location);
            this.found = JSON.parse(item);
        }
        catch (ex) { }
    }
    write() {
        const out = {};
        for (let element of this.elements) {
            out[element.name] = element.serialize(element.state.item);
        }
        storage_1.storage.setItem(this.location, JSON.stringify(out));
    }
    build(name, serialize, deserialize, create) {
        const out = this.elements.find((x) => x.name == name);
        if (out)
            return out.state;
        const found = this.found[name];
        const state = new StateT(deserialize, create, found);
        this.elements.push({
            name,
            serialize,
            state,
        });
        return state;
    }
}
exports.FileStateFactory = FileStateFactory;
class StateT {
    item;
    constructor(deserialize, create, prev) {
        const item = prev ? deserialize(prev) : create();
        if (item) {
            this.item = item;
        }
        else {
            this.item = create();
        }
    }
}
exports.StateT = StateT;
