import { Quad, Term } from "@rdfjs/types";
import { RDF, TREE } from "@treecg/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { Store } from "n3";
import * as N3 from "n3";
import { State } from "./state";
import { RdfStore } from "rdf-stores";

export interface Member {
  id: Term;
  quads: Quad[];
  timestamp?: string | Date;
  isVersionOf?: string;
}

const getObjects = function (store: RdfStore, subject:Term|null, predicate: Term|null, graph?:Term|null) {
  return store.getQuads(subject, predicate, null, graph).map((quad) => {
    return quad.object;
  });
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

  const extractMember = async (member: Term) => {
    state.add(member.value);
    const quads = await extractor.extract(
      store,
      <N3.Term>member,
      <N3.Term>shapeId,
    );
    // Get timestamp
    let timestamp: string | undefined;
    if (timestampPath) {
      timestamp = quads.find(
        (x) => x.subject.equals(member) && x.predicate.equals(timestampPath),
      )?.object.value;
    }

    let isVersionOf: string | undefined;
    if (isVersionOfPath) {
      isVersionOf = quads.find(
        (x) => x.subject.equals(member) && x.predicate.equals(isVersionOfPath),
      )?.object.value;
    }
    // Get isVersionof
    cb({ quads, id: member, isVersionOf, timestamp });
  };

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
): Relation[] {
  const relationIds = loose
    ? getObjects(store, null, TREE.terms.relation, null)
    : getObjects(store, node, TREE.terms.relation, null);
  const source = node.value;

  const out: Relation[] = [];
  for (let relationId of relationIds) {
    const node = getObjects(store, relationId, TREE.terms.node, null)[0];
    const ty = getObjects(store, relationId, RDF.terms.type, null);
    const path = getObjects(store, relationId, TREE.terms.path, null)[0];
    const value = getObjects(store, relationId, TREE.terms.value, null);
    out.push({
      source,
      node: node.value,
      type: ty[0],
      path,
      value,
    });
  }

  return out;
}
