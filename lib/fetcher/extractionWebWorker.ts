import type { Quad, Term } from "@rdfjs/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { quadToStringQuad, stringQuadToQuad } from "rdf-string";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { LDES } from "@treecg/types";

import type {
    Init,
    Extract,
    IncomingMessage,
    OutgoingMessage,
} from "./workerAdapter";

const { namedNode } = new DataFactory();

function returned(msg: OutgoingMessage) {
    self.postMessage(msg);
}

let extractor: CBDShapeExtractor | undefined = undefined;
let shape: Term | undefined = undefined;

function initalize(init: Init) {
    const store = RdfStore.createDefault();

    init.quads.forEach((q) => store.addQuad(stringQuadToQuad(q)));

    extractor = new CBDShapeExtractor(store, undefined, {
        cbdDefaultGraph: init.onlyDefaultGraphs,
    });

    shape = store.getQuads(
        null,
        namedNode("http://identifyingShape"),
        null,
    )[0]?.object;
}

async function extractMemberQuads(
    member: Term,
    data: RdfStore,
    otherMembers: Term[] = [],
): Promise<Quad[]> {
    return await extractor!.extract(data, member, shape, [
        namedNode(LDES.custom("IngestionMetadata")),
        ...otherMembers,
    ]);
}

function extract(extract: Extract) {
    const members = extract.members.map(namedNode);
    const store = RdfStore.createDefault();
    extract.quads.forEach((q) => store.addQuad(stringQuadToQuad(q)));

    const extractOne = async (id: Term) => {
        const qs = await extractMemberQuads(id, store, members);
        returned({
            type: "member",
            id: id.value,
            quads: qs.map((q) => quadToStringQuad(q))
        });
    };
    Promise.all(members.map(extractOne)).then(() => returned({ type: "done" }));
}

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
    const msg = event.data;
    if (msg.type === "initalize") {
        initalize(msg);
    }
    if (msg.type === "extract") {
        extract(msg);
    }
};
