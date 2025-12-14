import { LDESInfo } from "./memberManager";
import { quadToStringQuad, stringQuadToQuad } from "rdf-string";
import { Quad, Term } from "@rdfjs/types";
import { DataFactory, DefaultGraph } from "rdf-data-factory";
import { RdfStore } from "rdf-stores";
import { createWorker } from "./workerAdapter";

import type { Quad_Object } from "n3";
import type {
    IWorkerAdapter,
    IncomingMessage,
    OutgoingMessage,
} from "./workerAdapter";

const { namedNode, quad } = new DataFactory();

type Input = {
    members: Term[];
    quads: RdfStore;
    handleMember: (quads: Quad[], id: Term) => void;
    done: () => void;
};

type State = {
    worker: IWorkerAdapter;
    state: "busy" | "idle";
    handleMember: (quads: Quad[], id: Term) => void;
    done: () => void;
};

export class Pool {
    private readonly workers: State[];
    private readonly queue: Input[] = [];

    private constructor(workers: State[], info: LDESInfo) {
        this.workers = workers;

        const qs = info.shapeQuads.slice();
        if (info.shape) {
            const identifyingTriple = quad(
                namedNode("http://identifyingShape"),
                namedNode("http://identifyingShape"),
                <Quad_Object>info.shape,
                DefaultGraph.INSTANCE,
            );
            qs.push(identifyingTriple);
        }
        const quads = qs.map((q) => quadToStringQuad(q));

        for (const w of this.workers) {
            w.worker.postMessage(<IncomingMessage>{
                type: "initalize",
                quads,
                onlyDefaultGraphs: info.onlyDefaultGraph || false,
            });
            w.worker.onMessage((m: OutgoingMessage) =>
                this.handleMessage(w, m),
            );
        }
    }

    static async create(info: LDESInfo, workerCount = 1): Promise<Pool> {
        const isTs = import.meta.url.endsWith(".ts");
        const isBrowser = typeof window !== "undefined";

        const workerFileName = isBrowser
            ? `extractionWebWorker.${isTs ? "ts" : "js"}`
            : `extractionNodeWorker.${isTs ? "ts" : "js"}`;

        const workerPath = new URL(workerFileName, import.meta.url);

        const workers: State[] = [];
        for (let i = 0; i < workerCount; i++) {
            const worker = await createWorker(workerPath);
            workers.push({
                worker,
                state: "idle",
                handleMember: () => { },
                done: () => { },
            });
        }

        return new Pool(workers, info);
    }
    close() {
        for (const w of this.workers) {
            w.worker.terminate();
        }
    }

    public extract(
        quads: RdfStore,
        members: Term[],
        onMember: (quads: Quad[], id: Term) => void,
    ): Promise<void> {
        return new Promise((res) => {
            const inp = {
                quads,
                members,
                handleMember: onMember,
                done: res,
            };
            this.queue.push(inp);
            this.checkWork();
        });
    }

    private checkWork() {
        let work = this.queue.shift();
        while (work !== undefined) {
            const worker = this.workers.find((w) => w.state === "idle");
            if (worker) {
                worker.state = "busy";
                worker.handleMember = work.handleMember;
                worker.done = work.done;
                worker.worker.postMessage(<IncomingMessage>{
                    type: "extract",
                    members: work.members.map((x) => x.value),
                    quads: work.quads.getQuads().map((q) => quadToStringQuad(q)),
                });
            } else {
                this.queue.unshift(work);
                return;
            }

            work = this.queue.shift();
        }
    }

    private handleMessage(state: State, msg: OutgoingMessage) {
        if (msg.type === "member") {
            const quads = msg.quads.map((q) => stringQuadToQuad(q));
            const id = namedNode(msg.id);
            state.handleMember(quads, id);
        }
        if (msg.type === "done") {
            state.done();
            state.state = "idle";

            this.checkWork();
        }
    }
}
