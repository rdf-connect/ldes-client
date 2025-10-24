import { Worker } from "node:worker_threads";
import { LDESInfo } from "./memberManager";
import type { IncomingMessage, OutgoingMessage } from "./extractionWorker";
import { Parser, Quad_Object, Writer } from "n3";
import { Quad, Term } from "@rdfjs/types";
import { DataFactory, DefaultGraph } from "rdf-data-factory";
import { RdfStore } from "rdf-stores";

const { namedNode, quad } = new DataFactory();

type Input = {
    members: Term[];
    quads: RdfStore;
    handleMember: (quads: Quad[], id: Term) => void;
    done: () => void;
};

type State = {
    worker: Worker;
    state: "busy" | "idle";
    handleMember: (quads: Quad[], id: Term) => void;
    done: () => void;
};

export class Pool {
    private readonly workers: State[];
    private readonly queue: Input[] = [];
    constructor(info: LDESInfo, workerCount = 1) {
        console.log({ workerCount });
        const isTs = import.meta.url.endsWith(".ts");
        const workerPath = new URL(
            `./extractionWorker.${isTs ? "ts" : "js"}`,
            import.meta.url,
        );

        this.workers = [];
        for (let i = 0; i < workerCount; i++) {
            this.workers.push({
                worker: new Worker(workerPath),
                state: "idle",
                handleMember: () => {},
                done: () => {},
            });
        }

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
        const quads = new Writer().quadsToString(qs);

        for (const w of this.workers) {
            w.worker.postMessage(<IncomingMessage>{
                type: "initalize",
                quads,
                onlyDefaultGraphs: info.onlyDefaultGraph || false,
            });
            w.worker.on("message", (m: OutgoingMessage) =>
                this.handleMessage(w, m),
            );
        }
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
                    quads: new Writer().quadsToString(work.quads.getQuads()),
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
            const quads = new Parser().parse(msg.quads);
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
