"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRelations = exports.extractMembers = void 0;
const types_1 = require("@treecg/types");
const utils_1 = require("./utils");
function extractMembers(store, stream, extractor, state, cb, shapeId, timestampPath, isVersionOfPath) {
    const members = (0, utils_1.getObjects)(store, stream, types_1.TREE.terms.member, null);
    const extractMember = async (member) => {
        state.add(member.value);
        const quads = await extractor.extract(store, member, shapeId);
        // Get timestamp
        let timestamp;
        if (timestampPath) {
            timestamp = quads.find((x) => x.subject.equals(member) && x.predicate.equals(timestampPath))?.object.value;
        }
        let isVersionOf;
        if (isVersionOfPath) {
            isVersionOf = quads.find((x) => x.subject.equals(member) && x.predicate.equals(isVersionOfPath))?.object.value;
        }
        // Get isVersionof
        cb({ quads, id: member, isVersionOf, timestamp });
    };
    const out = [];
    for (let member of members) {
        if (!state.seen(member.value)) {
            state.add(member.value);
            out.push(extractMember(member));
        }
    }
    return out;
}
exports.extractMembers = extractMembers;
function extractRelations(store, node, loose, after, before) {
    const relationIds = loose
        ? (0, utils_1.getObjects)(store, null, types_1.TREE.terms.relation, null)
        : (0, utils_1.getObjects)(store, node, types_1.TREE.terms.relation, null);
    const source = node.value;
    // Set of tree:Nodes that are to be skipped based on temporal constraints.
    // Necessary when there is more than one relation type pointing towards the same node
    const filteredNodes = new Set();
    const allowedNodes = new Map();
    for (let relationId of relationIds) {
        const node = (0, utils_1.getObjects)(store, relationId, types_1.TREE.terms.node, null)[0];
        const ty = (0, utils_1.getObjects)(store, relationId, types_1.RDF.terms.type, null);
        const path = (0, utils_1.getObjects)(store, relationId, types_1.TREE.terms.path, null)[0];
        const value = (0, utils_1.getObjects)(store, relationId, types_1.TREE.terms.value, null);
        // Logic to determine which relations to follow based on before and after date filters
        if (value.length > 0) {
            const assessableRelations = [];
            if (after) {
                assessableRelations.push(...[types_1.TREE.LessThanRelation, types_1.TREE.LessThanOrEqualToRelation]);
                if (before) {
                    assessableRelations.push(...[types_1.TREE.GreaterThanRelation, types_1.TREE.GreaterThanOrEqualToRelation]);
                    // This filter applies for all cardinal relations
                    if (assessableRelations.includes(ty[0].value)) {
                        if (ty[0].value === types_1.TREE.LessThanRelation && after >= new Date(value[0].value)) {
                            filteredNodes.add(node.value);
                            if (allowedNodes.has(node.value)) {
                                // In case a permissive relation had allowed this node before
                                allowedNodes.delete(node.value);
                            }
                            continue;
                        }
                        if (ty[0].value === types_1.TREE.LessThanOrEqualToRelation && after > new Date(value[0].value)) {
                            filteredNodes.add(node.value);
                            if (allowedNodes.has(node.value)) {
                                // In case a permissive relation had allowed this node before
                                allowedNodes.delete(node.value);
                            }
                            continue;
                        }
                        if (ty[0].value === types_1.TREE.GreaterThanRelation && before <= new Date(value[0].value)) {
                            filteredNodes.add(node.value);
                            if (allowedNodes.has(node.value)) {
                                // In case a permissive relation had allowed this node before
                                allowedNodes.delete(node.value);
                            }
                            continue;
                        }
                        if (ty[0].value === types_1.TREE.GreaterThanOrEqualToRelation && before < new Date(value[0].value)) {
                            filteredNodes.add(node.value);
                            if (allowedNodes.has(node.value)) {
                                // In case a permissive relation had allowed this node before
                                allowedNodes.delete(node.value);
                            }
                            continue;
                        }
                    }
                }
                else {
                    // This filter only applies for tree:LessThanRelation and tree:LessThanOrEqualToRelation
                    if (assessableRelations.includes(ty[0].value)) {
                        if (ty[0].value === types_1.TREE.LessThanRelation && after >= new Date(value[0].value)) {
                            filteredNodes.add(node.value);
                            if (allowedNodes.has(node.value)) {
                                // In case a permissive relation had allowed this node before
                                allowedNodes.delete(node.value);
                            }
                            continue;
                        }
                        if (ty[0].value === types_1.TREE.LessThanOrEqualToRelation && after > new Date(value[0].value)) {
                            filteredNodes.add(node.value);
                            if (allowedNodes.has(node.value)) {
                                // In case a permissive relation had allowed this node before
                                allowedNodes.delete(node.value);
                            }
                            continue;
                        }
                    }
                }
            }
            else {
                if (before) {
                    assessableRelations.push(...[types_1.TREE.GreaterThanRelation, types_1.TREE.GreaterThanOrEqualToRelation]);
                    // This filter only applies for tree:GreaterThanRelation and tree:GreaterThanOrEqualToRelation
                    if (assessableRelations.includes(ty[0].value)) {
                        if (ty[0].value === types_1.TREE.GreaterThanRelation && before <= new Date(value[0].value)) {
                            filteredNodes.add(node.value);
                            if (allowedNodes.has(node.value)) {
                                // In case a permissive relation had allowed this node before
                                allowedNodes.delete(node.value);
                            }
                            continue;
                        }
                        if (ty[0].value === types_1.TREE.GreaterThanOrEqualToRelation && before < new Date(value[0].value)) {
                            filteredNodes.add(node.value);
                            if (allowedNodes.has(node.value)) {
                                // In case a permissive relation had allowed this node before
                                allowedNodes.delete(node.value);
                            }
                            continue;
                        }
                    }
                }
                else { /* No filters, everything is allowed */ }
            }
        }
        if (!filteredNodes.has(node.value)) {
            allowedNodes.set(node.value, {
                source,
                node: node.value,
                type: ty[0],
                path,
                value,
            });
        }
    }
    return Array.from(allowedNodes.values());
}
exports.extractRelations = extractRelations;
