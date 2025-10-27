import type { Quad, Term } from "@rdfjs/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { Parser, Writer } from "n3";
import { parentPort } from "node:worker_threads";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { LDES } from "@treecg/types";

const { namedNode } = new DataFactory();
type Init = {
    type: "initalize";
    quads: string;
    onlyDefaultGraphs: boolean;
};
type Extract = {
    type: "extract";
    quads: string;
    members: string[];
};

export type IncomingMessage = Init | Extract;
export type OutgoingMessage =
    | {
          type: "member";
          id: string;
          quads: string;
      }
    | {
          type: "done";
      };

function returned(msg: OutgoingMessage) {
    parentPort!.postMessage(msg);
}

let extractor: CBDShapeExtractor | undefined = undefined;
let shape: Term | undefined = undefined;
function initalize(init: Init) {
    const store = RdfStore.createDefault();

    const quads = new Parser().parse(init.quads);
    quads.forEach((q) => store.addQuad(q));

    extractor = new CBDShapeExtractor(store, undefined, {
        cbdDefaultGraph: init.onlyDefaultGraphs,
    });

    shape = store.getQuads(null, namedNode("http://identifyingShape"), null)[0]
        ?.object;
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

function extract(quads: string, membersIris: string[]) {
    const members = membersIris.map(namedNode);
    const store = RdfStore.createDefault();
    new Parser().parse(quads).forEach((q) => store.addQuad(q));

    const extractOne = async (id: Term) => {
        const qs = await extractMemberQuads(id, store, members);
        const qsStr = new Writer().quadsToString(qs);
        returned({ type: "member", id: id.value, quads: qsStr });
    };
    Promise.all(members.map(extractOne)).then(() => returned({ type: "done" }));
}

parentPort!.on("message", async (msg: IncomingMessage) => {
    if (msg.type === "initalize") {
        initalize(msg);
    }
    if (msg.type === "extract") {
        extract(msg.quads, msg.members);
    }
});
