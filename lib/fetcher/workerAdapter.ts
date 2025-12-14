import type { Worker as NodeWorker } from "node:worker_threads";
import type { IStringQuad } from "rdf-string";

export type Init = {
    type: "initalize";
    quads: IStringQuad[];
    onlyDefaultGraphs: boolean;
};
export type Extract = {
    type: "extract";
    quads: IStringQuad[];
    members: string[];
};

export type IncomingMessage = Init | Extract;
export type OutgoingMessage =
    | {
        type: "member";
        id: string;
        quads: IStringQuad[];
    }
    | {
        type: "done";
    };
/**
 * Common interface for both Node.js Worker Threads and Web Workers
 */
export interface IWorkerAdapter {
    postMessage(message: IncomingMessage): void;
    onMessage(handler: (msg: OutgoingMessage) => void): void;
    terminate(): void;
}

/**
 * Adapter for Node.js Worker Threads
 */
export class NodeWorkerAdapter implements IWorkerAdapter {
    constructor(private worker: NodeWorker) { }

    postMessage(message: IncomingMessage): void {
        this.worker.postMessage(message);
    }

    onMessage(handler: (msg: OutgoingMessage) => void): void {
        this.worker.on("message", handler);
    }

    terminate(): void {
        this.worker.terminate();
    }
}

/**
 * Adapter for Web Workers
 */
export class WebWorkerAdapter implements IWorkerAdapter {
    constructor(private worker: Worker) { }

    postMessage(message: IncomingMessage): void {
        this.worker.postMessage(message);
    }

    onMessage(handler: (msg: OutgoingMessage) => void): void {
        this.worker.onmessage = (event: MessageEvent) => {
            handler(event.data);
        };
    }

    terminate(): void {
        this.worker.terminate();
    }
}

/**
 * Detects if running in Node.js environment
 */
function isNodeEnvironment(): boolean {
    return (
        typeof process !== "undefined" &&
        process.versions != null
    );
}

/**
 * Factory function to create the appropriate worker adapter based on the environment
 * @param workerPath - Path or URL to the worker script
 * @returns Worker adapter instance
 */
export async function createWorker(
    workerPath: URL | string,
): Promise<IWorkerAdapter> {
    if (isNodeEnvironment()) {
        // Node.js environment - use Worker Threads
        const { Worker } = await import("node:worker_threads");
        const worker = new Worker(workerPath);
        return new NodeWorkerAdapter(worker);
    } else {
        // Browser environment - use Web Workers
        const workerUrl = workerPath instanceof URL ? workerPath.href : workerPath;
        const worker = new Worker(workerUrl, { type: "module" });
        return new WebWorkerAdapter(worker);
    }
}
