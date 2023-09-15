import { CBDShapeExtractor} from "extract-cbd-shape";
import { Dereferencer } from "./dereferencer";
import { Term, Quad, Store} from "n3";
import { Runner } from "./runner";

/**
 * This is basically a runner factory: it creates runners based on context given.
 */
export class LDESClient {
    dereferencer : Dereferencer;
    constructor () {
        this.dereferencer = new Dereferencer();
    }

    /**
     * Fetches the context and starts up a repl+sync runner
     * @param url 
     */
    async replicate (url: string): Promise<Runner> {
        let response = await this.dereferencer.dereference(url);
        // First fetch context information and put this in the context store
        let contextStore = new Store(response.quads);

        let memberExtractor = new CBDShapeExtractor(contextStore, this.dereferencer.rdfDereference);

        //Store used for member extraction
        let memberStore = new Store(response.quads);
        
        // If the URL was a URI for the LDES,
        // select the best view that could be found for repl+sync (TODO)
        let entryNodeUrl = url;

        let runner = new Runner(memberExtractor, contextStore, entryNodeUrl, memberStore);
        return runner;
    }

    async synchronize (): Promise<Runner> {
        return new Runner();
    }
}

