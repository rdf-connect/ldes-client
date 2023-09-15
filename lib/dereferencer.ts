// Add on top of the normal dereferencer:
//  1. JSON-LD resolver
//  2. Rate limiter
//  3. Heuristic deciding a time to live in the response
import rdfDeference, { RdfDereferencer } from "rdf-dereference";
import {Quad} from "n3";

export class Dereferencer {
    rdfDereference : RdfDereferencer;
    constructor () {
        this.rdfDereference = rdfDeference;
    }
    async dereference (url: string): Promise<DereferenceResponse> {
        let response = await this.rdfDereference.dereference(url);
        //Step 1: check the headers and process 
        response.headers;
        //Step 2: process the quads into an array

        return new DereferenceResponse();
    }
}

export class DereferenceResponse {
    expires: Date; // when not immutable: indicates datetime when it should be refetched for possible new members or relations
    immutable: boolean;
    quads: Array<Quad>;
    constructor () {

    }
}