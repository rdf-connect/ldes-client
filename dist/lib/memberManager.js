"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Manager = void 0;
const types_1 = require("@treecg/types");
const debug_1 = require("debug");
const utils_1 = require("./utils");
const log = (0, debug_1.default)("manager");
class Manager {
    queued = 0;
    resolve;
    ldesId;
    currentPromises = [];
    state;
    extractor;
    shapeMap;
    timestampPath;
    isVersionOfPath;
    constructor(ldesId, state, info) {
        const logger = log.extend("constructor");
        this.ldesId = ldesId;
        this.state = state;
        this.extractor = info.extractor;
        this.timestampPath = info.timestampPath;
        this.isVersionOfPath = info.isVersionOfPath;
        this.shapeMap = info.shapeMap;
        logger("new %s %o", ldesId.value, info);
    }
    async close() {
        log("Closing");
        await Promise.all(this.currentPromises);
        if (this.resolve) {
            this.resolve();
            this.resolve = undefined;
        }
        log("this.resolve()");
    }
    length() {
        return this.state.size;
    }
    async extractMember(member, data) {
        let quads = [];
        if (this.shapeMap) {
            if (this.shapeMap.size === 1) {
                // Use the only shape available
                quads = await this.extractor.extract(data, member, Array.from(this.shapeMap.values())[0]);
            }
            else if (this.shapeMap.size > 1) {
                // Find what is the proper shape for this member based on its rdf:type
                const memberType = (0, utils_1.getObjects)(data, member, types_1.RDF.terms.type)[0];
                if (memberType) {
                    const shapeId = this.shapeMap.get(memberType.value);
                    if (shapeId) {
                        quads = await this.extractor.extract(data, member, shapeId);
                    }
                }
                else {
                    // There is no rdf:type defined for this member. Fallback to CBD extraction
                    quads = await this.extractor.extract(data, member);
                }
            }
            else {
                // Do a simple CBD extraction
                quads = await this.extractor.extract(data, member);
            }
        }
        else {
            // Do a simple CBD extraction
            quads = await this.extractor.extract(data, member);
        }
        if (this.state.has(member.value)) {
            return;
        }
        if (quads.length > 0) {
            this.state.add(member.value);
            // Get timestamp
            let timestamp;
            if (this.timestampPath) {
                const ts = quads.find((x) => x.subject.equals(member) && x.predicate.equals(this.timestampPath))?.object.value;
                if (ts) {
                    try {
                        timestamp = new Date(ts);
                    }
                    catch (ex) {
                        timestamp = ts;
                    }
                }
            }
            let isVersionOf;
            if (this.isVersionOfPath) {
                isVersionOf = quads.find((x) => x.subject.equals(member) &&
                    x.predicate.equals(this.isVersionOfPath))?.object.value;
            }
            // HEAD
            return { id: member, quads, timestamp, isVersionOf };
        }
    }
    // Extract members found in this page, this does not yet emit the members
    extractMembers(page, state, notifier) {
        const logger = log.extend("extract");
        const members = (0, utils_1.getObjects)(page.data, this.ldesId, types_1.TREE.terms.member, null);
        logger("%d members", members.length);
        const promises = [];
        for (let member of members) {
            if (!this.state.has(member.value)) {
                const promise = this.extractMember(member, page.data).then((member) => {
                    if (member) {
                        notifier.extracted(member, state);
                    }
                    return member;
                });
                promises.push(promise);
            }
        }
        Promise.all(promises).then((members) => {
            logger("All members extracted");
            notifier.done(members.flatMap((x) => (x ? [x] : [])), state);
        });
    }
    /// Get a promsie that resolves when a member is submitted
    /// Only listen to this promise if a member is queued
    reset() {
        const logger = log.extend("reset");
        logger("Resetting with %d members in queue", this.queued);
        this.queued = 0;
        return new Promise((res) => (this.resolve = res));
    }
}
exports.Manager = Manager;
