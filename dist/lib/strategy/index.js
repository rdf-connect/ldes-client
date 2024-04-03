"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LTR = exports.GTRs = exports.OrderedStrategy = exports.UnorderedStrategy = void 0;
const types_1 = require("@treecg/types");
var unordered_1 = require("./unordered");
Object.defineProperty(exports, "UnorderedStrategy", { enumerable: true, get: function () { return unordered_1.UnorderedStrategy; } });
var ordered_1 = require("./ordered");
Object.defineProperty(exports, "OrderedStrategy", { enumerable: true, get: function () { return ordered_1.OrderedStrategy; } });
/**
 * Predicates representing greater than relations
 */
exports.GTRs = [
    types_1.TREE.terms.GreaterThanRelation,
    types_1.TREE.terms.GreaterThanOrEqualToRelation,
];
/**
 * Predicates representing less than relations
 */
exports.LTR = [
    types_1.TREE.terms.LessThanRelation,
    types_1.TREE.terms.LessThanOrEqualToRelation,
];
