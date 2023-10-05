import { PathPattern } from "extract-cbd-shape/dist/lib/Path";
import { NamedNode, Store } from "n3";

/**
 * Extracts hypermedia links known in the TREE ecosystem and outputs a Hypermedia class with links and forms
 */
export default function extractHypermedia(
  store: Store,
  collection: NamedNode,
  currentNode: NamedNode,
): TREEHypermedia {
  let relationIds = store.getObjects(
    currentNode,
    new NamedNode("https://w3id.org/tree#relation"),
    null,
  );

  return new TREEHypermedia();
}

export class TREEHypermedia {
  search: SearchForm[];
  links: Link[];
}

export class SearchForm {}

/**
 * scores a link based on a path
 */
export class Link {
  public node: NamedNode;
  public comparator;

  constructor(node: NamedNode, type: NamedNode) {}

  /**
   * Priority list between 0 and 1.0 ()
   */
  score(value: any): number {
    return this.comparator(value);
  }
}
