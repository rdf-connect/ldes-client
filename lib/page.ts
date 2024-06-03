import { Quad, Term } from "@rdfjs/types";
import { RDF, TREE } from "@treecg/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { State } from "./state";
import { RdfStore } from "rdf-stores";
import { getObjects, memberFromQuads } from "./utils";

export interface Member {
  id: Term;
  quads: Quad[];
  timestamp?: string | Date;
  isVersionOf?: string;
  type?: Term;
}

export interface Relation {
  source: string;
  node: string;
  type: Term;
  value?: Term[];
  path?: Term;
}

export interface Page {
  relations: Relation[];
  node: string;
}

export function extractMembers(
  store: RdfStore,
  stream: Term,
  extractor: CBDShapeExtractor,
  state: State,
  cb: (member: Member) => void,
  shapeId?: Term,
  timestampPath?: Term,
  isVersionOfPath?: Term,
): Promise<void>[] {
  const members = getObjects(store, stream, TREE.terms.member, null);
  async function extractMember(member: Term) {
    const quads = await extractor.extract(store, member, shapeId);
    cb(memberFromQuads(member, quads, timestampPath, isVersionOfPath));
  }

  const out: Promise<void>[] = [];
  for (let member of members) {
    if (!state.seen(member.value)) {
      state.add(member.value);
      out.push(extractMember(member));
    }
  }

  return out;
}

export function extractRelations(
  store: RdfStore,
  node: Term,
  loose: boolean,
  after?: Date,
  before?: Date
): Relation[] {
  const relationIds = loose
    ? getObjects(store, null, TREE.terms.relation, null)
    : getObjects(store, node, TREE.terms.relation, null);
  const source = node.value;

  // Set of tree:Nodes that are to be skipped based on temporal constraints.
  // Necessary when there is more than one relation type pointing towards the same node
  const filteredNodes = new Set<string>();
  const allowedNodes = new Map<string, Relation>();

  for (let relationId of relationIds) {
    const node = getObjects(store, relationId, TREE.terms.node, null)[0];
    const ty = getObjects(store, relationId, RDF.terms.type, null)[0] || TREE.Relation;
    const path = getObjects(store, relationId, TREE.terms.path, null)[0];
    const value = getObjects(store, relationId, TREE.terms.value, null);

    // Logic to determine which relations to follow based on before and after date filters
    if (value.length > 0) {
      const assessableRelations = [];

      if (after) {
        assessableRelations.push(
          ...[TREE.LessThanRelation, TREE.LessThanOrEqualToRelation]
        );
        if (before) {
          assessableRelations.push(
            ...[TREE.GreaterThanRelation, TREE.GreaterThanOrEqualToRelation]
          );
          // This filter applies for all cardinal relations
          if (assessableRelations.includes(ty.value)) {
            if (
              ty.value === TREE.LessThanRelation &&
              after >= new Date(value[0].value)
            ) {
              filteredNodes.add(node.value);
              if (allowedNodes.has(node.value)) {
                // In case a permissive relation had allowed this node before
                allowedNodes.delete(node.value);
              }
              continue;
            }
            if (
              ty.value === TREE.LessThanOrEqualToRelation &&
              after > new Date(value[0].value)
            ) {
              filteredNodes.add(node.value);
              if (allowedNodes.has(node.value)) {
                // In case a permissive relation had allowed this node before
                allowedNodes.delete(node.value);
              }
              continue;
            }
            if (
              ty.value === TREE.GreaterThanRelation &&
              before <= new Date(value[0].value)
            ) {
              filteredNodes.add(node.value);
              if (allowedNodes.has(node.value)) {
                // In case a permissive relation had allowed this node before
                allowedNodes.delete(node.value);
              }
              continue;
            }
            if (
              ty.value === TREE.GreaterThanOrEqualToRelation &&
              before < new Date(value[0].value)
            ) {
              filteredNodes.add(node.value);
              if (allowedNodes.has(node.value)) {
                // In case a permissive relation had allowed this node before
                allowedNodes.delete(node.value);
              }
              continue;
            }
          }
        } else {
          // This filter only applies for tree:LessThanRelation and tree:LessThanOrEqualToRelation
          if (assessableRelations.includes(ty.value)) {
            if (
              ty.value === TREE.LessThanRelation &&
              after >= new Date(value[0].value)
            ) {
              filteredNodes.add(node.value);
              if (allowedNodes.has(node.value)) {
                // In case a permissive relation had allowed this node before
                allowedNodes.delete(node.value);
              }
              continue;
            }
            if (
              ty.value === TREE.LessThanOrEqualToRelation &&
              after > new Date(value[0].value)
            ) {
              filteredNodes.add(node.value);
              if (allowedNodes.has(node.value)) {
                // In case a permissive relation had allowed this node before
                allowedNodes.delete(node.value);
              }
              continue;
            }
          }
        }
      } else {
        if (before) {
          assessableRelations.push(
            ...[TREE.GreaterThanRelation, TREE.GreaterThanOrEqualToRelation]
          );
          // This filter only applies for tree:GreaterThanRelation and tree:GreaterThanOrEqualToRelation
          if (assessableRelations.includes(ty.value)) {
            if (
              ty.value === TREE.GreaterThanRelation &&
              before <= new Date(value[0].value)
            ) {
              filteredNodes.add(node.value);
              if (allowedNodes.has(node.value)) {
                // In case a permissive relation had allowed this node before
                allowedNodes.delete(node.value);
              }
              continue;
            }
            if (
              ty.value === TREE.GreaterThanOrEqualToRelation &&
              before < new Date(value[0].value)
            ) {
              filteredNodes.add(node.value);
              if (allowedNodes.has(node.value)) {
                // In case a permissive relation had allowed this node before
                allowedNodes.delete(node.value);
              }
              continue;
            }
          }
        } else {
          /* No filters, everything is allowed */
        }
      }
    }

    if (!filteredNodes.has(node.value)) {
      allowedNodes.set(node.value, {
        source,
        node: node.value,
        type: ty,
        path,
        value,
      });
    }
  }

  return Array.from(allowedNodes.values());
}
