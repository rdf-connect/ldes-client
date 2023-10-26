import { Quad, Term } from "@rdfjs/types";
import { RDF, TREE } from "@treecg/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { Store } from "n3";
import * as N3 from "n3";
import { State } from "./state";

export interface Member {
  id: Term;
  quads: Quad[];
  timestamp?: string;
  isVersionOf?: string;
}

export interface Relation {
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
  store: Store,
  stream: Term,
  extractor: CBDShapeExtractor,
  state: State,
  cb: (member: Member) => void,
  shapeId?: Term,
  timestampPath?: Term,
  isVersionOfPath?: Term,
): Promise<void>[] {
  const members = store.getObjects(stream, TREE.terms.member, null);

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

  const out = [];
  for (let member of members) {
    if (!state.seen(member.value)) {
      state.add(member.value);
      out.push(extractMember(member));
    }
  }

  return out;
}

export function extractRelations(store: Store, node: Term): Relation[] {
  const relationIds = store.getObjects(node, TREE.terms.relation, null);

  const out: Relation[] = [];
  for (let relationId of relationIds) {
    const node = store.getObjects(relationId, TREE.terms.node, null)[0];
    const ty = store.getObjects(relationId, RDF.terms.type, null);
    const path = store.getObjects(relationId, TREE.terms.path, null)[0];
    const value = store.getObjects(relationId, TREE.terms.value, null);
    out.push({
      node: node.value,
      type: ty[0],
      path,
      value,
    });
  }

  return out;
}
