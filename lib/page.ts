import { Quad, Term } from "@rdfjs/types";
import { RDF, TREE } from "@treecg/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { Store } from "n3";
import * as N3 from "n3";
import { State } from "./state";

export interface Member {
  id: Term;
  quads: Quad[];
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

export async function extractMembers(
  store: Store,
  node: Term,
  extractor: CBDShapeExtractor,
  cb: (member: Member) => void,
  state: State,
  shapeId?: Term,
): Promise<number> {
  const members = store.getObjects(node, TREE.terms.member, null);

  for (let member of members) {
    if (!(await state.seen(member.id))) {
      const addPromise = state.add(member.id);
      extractor
        .extract(store, member, <N3.Term>shapeId)
        .then((quads) => cb({ quads, id: member }));
      await addPromise;
    }
  }

  // This is an estimation
  return members.length;
}

export function extractRelations(store: Store, node: Term): Relation[] {
  const relationIds = store.getObjects(node, TREE.terms.relation, null);

  const out: Relation[] = [];
  for (let relationId of relationIds) {
    const node = store.getObjects(relationId, TREE.terms.node, null)[0];
    const ty = store.getObjects(relationId, RDF.terms.type, null)[0];
    out.push({
      node: node.value,
      type: ty,
    });
  }

  return out;
}
