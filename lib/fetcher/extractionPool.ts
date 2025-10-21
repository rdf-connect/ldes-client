import { Worker } from "node:worker_threads";
import { LDESInfo } from "./memberManager";
import type { IncomingMessage, OutgoingMessage } from "./extractionWorker";
import { Parser, Writer } from "n3";
import { Quad, Term } from "@rdfjs/types";
import { DataFactory } from "rdf-data-factory";
import { RdfStore } from "rdf-stores";

const { namedNode } = new DataFactory();

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
    constructor(info: LDESInfo, workerCount = 4) {
        console.log({ workerCount });

        this.workers = [];
        for (let i = 0; i < workerCount; i++) {
            this.workers.push({
                worker: new Worker("./dist/lib/fetcher/extractionWorker.js"),
                state: "idle",
                handleMember: () => {},
                done: () => {},
            });
        }

        console.log(this.workers);

        for (const w of this.workers) {
            w.worker.postMessage(<IncomingMessage>{
                type: "initalize",
                id: info.shape?.value,
                quads: new Writer().quadsToString(info.shapeQuads),
            });
            w.worker.on("message", (m: OutgoingMessage) =>
                this.handleMessage(w, m),
            );
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
        console.log("Work todo", this.queue.length);
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
            console.log("Got member msg");
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
