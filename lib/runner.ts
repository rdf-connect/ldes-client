import { CBDShapeExtractor } from "extract-cbd-shape";
import State from "./state";
import { Readable } from "stream";
import { Store } from "n3";

export class Runner extends Readable {
    
    memberExtractor : CBDShapeExtractor;

    constructor (memberExtractor: CBDShapeExtractor, contextStore: Store, entryNodeUrl: string, memberStore: Store) {
        super();
        this.memberExtractor = memberExtractor;
    }

    pauseWithState () : State {
        throw new Error('Not yet implemented');
        this.pause();
        return new State();
    }

    resumeFromState (state: State) {
        throw new Error('Not yet implemented');
    }
}