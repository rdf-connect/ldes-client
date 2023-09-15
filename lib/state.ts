import { Shape } from "extract-cbd-shape/dist/lib/Shape";
import { NamedNode, Term } from "n3";

/**
 * The State class represents the state kept by a specific kind of LDES
 * The default behaviour is to keep a list of all done HTTP requests and all retrieved members.
 * If however the LDES documents an iterator, we can keep the State much more memory efficiently
 */
export default class State {

    shape: Shape;
    collection: NamedNode;
    view: NamedNode;
    bookmark: LDESBookmark; 

    constructor () {
        
    }

}

export class LDESBookmark {


}

export class IteratorBookmark extends LDESBookmark {

}

export class HTTPBookmark extends LDESBookmark {
    retrievedMembers: Term[]; // Should work as a very big LRU cache to prevent memory outage
    immutable : string[]; // Already fetched immutable pages

    store;

    constructor () {
        super();        
    }
}