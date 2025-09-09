import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "fs";
import path from "path";
import { createUriAndTermNamespace, RDF, SDS, DC } from "@treecg/types";
import { WriterInstance } from "@rdfc/js-runner";
import { RunnerClient } from "@rdfc/proto";
import { credentials } from "@grpc/grpc-js";
import { fastify, FastifyInstance, RequestPayload } from "fastify";
import { fastifyStatic } from "@fastify/static";
import { Parser } from "n3";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { LDESClientProcessor } from "../../lib/rdfc-processor";
import { streamToString } from "../../lib/utils";
import winston from "winston";

import type { Writable } from "@rdfc/js-runner";

const df = new DataFactory();

describe("Functional tests for the rdfc:LdesClient RDF-Connect processor", () => {
    const LDES = "http://localhost:3000/mock-ldes.ttl";
    const ATYPICAL_LDES = "http://localhost:3000/mock-ldes-atypical.ttl";
    const INBETWEEN_LDES = "http://localhost:3000/mock-ldes-inbetween.ttl";
    const LINKED_LIST_LDES = "http://localhost:3000/mock-ldes-linked-list.ttl";
    const LOCAL_DUMP_LDES = "./tests/data/ldes-dump.ttl";
    const LDES_MINIMAL_VIEW = "http://localhost:3000/mock-ldes-minimal-view-0.ttl";
    const EX = createUriAndTermNamespace(
        "http://example.org/",
        "Clazz1",
        "Clazz2",
        "modified",
        "isVersionOf",
        "prop1",
        "subprop"
    );
    let server: FastifyInstance;

    // gRPC client
    const client = new RunnerClient("localhost:50051", credentials.createInsecure());

    beforeAll(async () => {
        // Setup mock http server
        try {
            server = fastify();
            server.register(fastifyStatic, {
                root: path.join(__dirname, "../data/mock-ldes"),
            });

            server.addHook(
                "onSend",
                async (request, reply, payload: RequestPayload) => {
                    const st = await streamToString(payload);

                    // Add cache control headers for immutable files
                    if (st.startsWith("# immutable")) {
                        reply.header("Cache-Control", "immutable");
                    }
                    return st;
                },
            );

            await server.listen({ port: 3000 });
            console.log(
                `Mock server listening on ${server.addresses()[0].port}`,
            );
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    });

    afterAll(async () => {
        await server.close();
    });

    beforeEach(() => {
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }
    });

    afterEach(() => {
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }
    });

    test("Fetching an LDES unordered and no filters to get all members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');
                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Expect all members
        expect(count).toBe(12);
    });

    test("Fetching an atypical LDES unordered and no filters to get all members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');
                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Expect all members
        expect(count).toBe(12);
    });

    test("Fetching an tree:InBetweenRelation LDES unordered and no filters to get all members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');
                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);
        // Expect all members
        expect(count).toBe(15);
    });

    test("Fetching an LDES unordered and with after filter that gets no members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            after: new Date("3024-03-09T15:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching an atypical LDES unordered and with after filter that gets no members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            after: new Date("3024-03-09T15:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching a tree:InBetweenRelation LDES unordered and with after filter that gets no members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            after: new Date("3024-03-09T15:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching an LDES unordered and with before filter that gets no members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("1325-03-09T15:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching an atypical LDES unordered and with before filter that gets no members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("1325-03-09T15:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching an LDES unordered and with before and after filter", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');
                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Check timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T08:30:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T09:30:00.000Z").getTime(),
                );
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-07-14T09:30:00.000Z"),
            after: new Date("2024-07-14T08:30:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);
        // Check we got some members
        expect(count).toBe(3);
    });

    test("Fetching an atypical LDES unordered and with before and after filter", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');
                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Check timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);
        // Check we got some members
        expect(count).toBe(10);
    });

    test("Fetching a tree:InBetweenRelation LDES unordered and with before and after filter", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');
                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Check timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);
        // Check we got some members
        expect(count).toBe(7);
    });

    test("Fetching an LDES in ascending order and with before and after filters", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');
                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T10:30:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-07-14T10:30:00.000Z"),
            after: new Date("2024-07-14T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching an atypical LDES in ascending order and with before and after filters", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(10);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES in ascending order and with before and after filters", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(7);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching an LDES in descending order and with before and after filters", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T10:30:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "descending",
            before: new Date("2024-07-14T10:30:00.000Z"),
            after: new Date("2024-07-14T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching an atypical LDES in descending order and with before and after filters", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "descending",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(10);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES in descending order and with before and after filters", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "descending",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(7);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching an LDES unordered, with before and after filter and LDES original shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T10:30:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-07-14T10:30:00.000Z"),
            after: new Date("2024-07-14T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an atypical LDES unordered, with before and after filter and LDES original shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES unordered, with before and after filter and LDES original shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an LDES unordered, with before and after filter and overridden local shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T10:30:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Check ex:Clazz2 instance was not extracted
                expect(
                    store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                        .length,
                ).toBe(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-07-14T10:30:00.000Z"),
            after: new Date("2024-07-14T09:00:00.000Z"),
            shapeFile: "./tests/data/mock-ldes/partial-shape.ttl",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an atypical LDES unordered, with before and after filter and overridden local shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Check ex:Clazz2 instance was not extracted
                expect(
                    store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                        .length,
                ).toBe(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            shapeFile: "./tests/data/mock-ldes/partial-shape.ttl",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES unordered, with before and after filter and overridden local shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Check ex:Clazz2 instance was not extracted
                expect(
                    store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                        .length,
                ).toBe(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            shapeFile: "./tests/data/mock-ldes/partial-shape.ttl",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an LDES unordered, with before and after filter and overridden remote shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T10:30:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-07-14T10:30:00.000Z"),
            after: new Date("2024-07-14T09:00:00.000Z"),
            shapeFile: "http://localhost:3000/full-shape.ttl",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an atypical LDES unordered, with before and after filter and overridden remote shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            shapeFile: "http://localhost:3000/full-shape.ttl",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES unordered, with before and after filter and overridden remote shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            shapeFile: "http://localhost:3000/full-shape.ttl",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an LDES unordered, with before and after filters and no shape (defaults to CBD member extraction)", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T10:30:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Check ex:Clazz2 instance was not extracted
                expect(
                    store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                        .length,
                ).toBe(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-07-14T10:30:00.000Z"),
            after: new Date("2024-07-14T09:00:00.000Z"),
            noShape: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an atypical LDES unordered, with before and after filters and no shape (defaults to CBD member extraction)", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Check ex:Clazz2 instance was not extracted
                expect(
                    store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                        .length,
                ).toBe(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            noShape: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES unordered, with before and after filters and no shape (defaults to CBD member extraction)", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Check ex:Clazz2 instance was not extracted
                expect(
                    store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                        .length,
                ).toBe(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            noShape: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an LDES in ascending order, with before and after filter and overridden remote shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T10:30:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-07-14T10:30:00.000Z"),
            after: new Date("2024-07-14T09:00:00.000Z"),
            shapeFile: "http://localhost:3000/full-shape.ttl",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching an atypical LDES in ascending order, with before and after filter and overridden remote shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            shapeFile: "http://localhost:3000/full-shape.ttl",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES in ascending order, with before and after filter and overridden remote shape", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            shapeFile: "http://localhost:3000/full-shape.ttl",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching an LDES unordered and version materialized members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Keep track of member IDs
                memberIds.add(
                    store.getQuads(null, SDS.terms.payload)[0].object.value,
                );

                // Check the version property is not present
                expect(
                    store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
                ).toBe(0);

                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            materialize: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got all members
        expect(count).toBe(12);
        // Check we got all unique members
        expect(memberIds.size).toBe(6);
    });

    test("Fetching an atypical LDES unordered and version materialized members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Keep track of member IDs
                memberIds.add(
                    store.getQuads(null, SDS.terms.payload)[0].object.value,
                );

                // Check the version property is not present
                expect(
                    store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
                ).toBe(0);

                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            materialize: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got all members
        expect(count).toBe(12);
        // Check we got all unique members
        expect(memberIds.size).toBe(6);
    });

    test("Fetching a tree:InBetweenRelation LDES unordered and version materialized members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Keep track of member IDs
                memberIds.add(
                    store.getQuads(null, SDS.terms.payload)[0].object.value,
                );

                // Check the version property is not present
                expect(
                    store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
                ).toBe(0);

                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            materialize: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got all members
        expect(count).toBe(15);
        // Check we got all unique members
        expect(memberIds.size).toBe(3);
    });

    test("Fetching an LDES in ascending order, with before and after filters, overriden local shape and version materialized members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T10:30:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());

                // Keep track of member IDs
                memberIds.add(
                    store.getQuads(null, SDS.terms.payload)[0].object.value,
                );
                // Check the version property is not present
                expect(
                    store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
                ).toBe(0);

                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-07-14T10:30:00.000Z"),
            after: new Date("2024-07-14T09:00:00.000Z"),
            shapeFile: "./tests/data/mock-ldes/partial-shape.ttl",
            materialize: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check we got all unique members
        expect(memberIds.size).toBe(3);
    });

    test("Fetching an atypical LDES in ascending order, with before and after filters, overriden local shape and version materialized members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());

                // Keep track of member IDs
                memberIds.add(
                    store.getQuads(null, SDS.terms.payload)[0].object.value,
                );
                // Check the version property is not present
                expect(
                    store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
                ).toBe(0);

                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            shapeFile: "./tests/data/mock-ldes/partial-shape.ttl",
            materialize: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check we got all unique members
        expect(memberIds.size).toBe(6);
    });

    test("Fetching a tree:InBetweenRelation LDES in ascending order, with before and after filters, overriden local shape and version materialized members", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());

                // Keep track of member IDs
                memberIds.add(
                    store.getQuads(null, SDS.terms.payload)[0].object.value,
                );
                // Check the version property is not present
                expect(
                    store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
                ).toBe(0);

                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            shapeFile: "./tests/data/mock-ldes/partial-shape.ttl",
            materialize: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check we got all unique members
        expect(memberIds.size).toBe(3);
    });

    test("Fetching an LDES asking for only the last version of every member", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract canonical member ID and timestamp
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const canonicalId = store.getQuads(null, EX.terms.isVersionOf)[0]
                    .object.value;
                // Check that member hasn't been seen before
                expect(memberIds.has(canonicalId)).toBeFalsy();

                memberIds.add(canonicalId);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            lastVersionOnly: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(6);
    });

    test("Fetching an atypical LDES asking for only the last version of every member", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBe(-1);
                expect(member.indexOf(SDS.payload)).toBe(-1);

                // Extract canonical member ID and timestamp
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const canonicalId = store.getQuads(null, EX.terms.isVersionOf)[0]
                    .object.value;
                // Check that member hasn't been seen before
                expect(memberIds.has(canonicalId)).toBeFalsy();

                memberIds.add(canonicalId);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            lastVersionOnly: true,
            sdsify: false,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(6);
    });

    test("Fetching a tree:InBetweenRelation LDES asking for only the last version of every member", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract canonical member ID and timestamp
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const canonicalId = store.getQuads(null, EX.terms.isVersionOf)[0]
                    .object.value;
                // Check that member hasn't been seen before
                expect(memberIds.has(canonicalId)).toBeFalsy();

                memberIds.add(canonicalId);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            lastVersionOnly: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
    });

    test("Fetching an LDES with before and after filter, overriden remote shape, asking for only the last version of every member and versioned materialized", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-07-14T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-07-14T10:30:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                // Keep track of member IDs
                const memberId = store.getQuads(null, SDS.terms.payload)[0].object
                    .value;
                expect(memberIds.has(memberId)).toBeFalsy();
                memberIds.add(memberId);
                // Check the version property is not present
                expect(
                    store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
                ).toBe(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-07-14T10:30:00.000Z"),
            after: new Date("2024-07-14T09:00:00.000Z"),
            shapeFile: "http://localhost:3000/full-shape.ttl",
            materialize: true,
            lastVersionOnly: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check result was ordered (in descending order due to last version only)
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an atypical LDES with before and after filter, overriden remote shape, asking for only the last version of every member and versioned materialized", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-18T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-18T10:53:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                // Keep track of member IDs
                const memberId = store.getQuads(null, SDS.terms.payload)[0].object
                    .value;
                expect(memberIds.has(memberId)).toBeFalsy();
                memberIds.add(memberId);
                // Check the version property is not present
                expect(
                    store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
                ).toBe(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: ATYPICAL_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-18T10:53:00.000Z"),
            after: new Date("2024-09-18T09:00:00.000Z"),
            shapeFile: "http://localhost:3000/full-shape.ttl",
            materialize: true,
            lastVersionOnly: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(6);
        // Check result was ordered (in descending order due to last version only)
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES with before and after filter, overriden remote shape, asking for only the last version of every member and versioned materialized", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);
        const memberIds = new Set<string>();

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));

                // Check which classes we got
                for (const classSuffix of observedClasses.keys()) {
                    if (member.includes(classSuffix)) {
                        observedClasses.set(classSuffix, true);
                    }
                }

                // Extract timestamp property (ex:modified in this LDES)
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-09-26T09:00:00.000Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-09-26T10:25:00.000Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                // Keep track of member IDs
                const memberId = store.getQuads(null, SDS.terms.payload)[0].object
                    .value;
                expect(memberIds.has(memberId)).toBeFalsy();
                memberIds.add(memberId);
                // Check the version property is not present
                expect(
                    store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
                ).toBe(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: INBETWEEN_LDES,
            output: outputStream,
            ordered: "none",
            before: new Date("2024-09-26T10:25:00.000Z"),
            after: new Date("2024-09-26T09:00:00.000Z"),
            shapeFile: "http://localhost:3000/full-shape.ttl",
            materialize: true,
            lastVersionOnly: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(3);
        // Check result was ordered (in descending order due to last version only)
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an Linked List LDES in ascending order and members with out-of-band data", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                // Check that out-of-band data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LINKED_LIST_LDES,
            output: outputStream,
            ordered: "ascending",
            fetchConfig: {
                concurrent: 1
            },
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got all members
        expect(count).toBe(9);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching a local dump LDES unorder", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LOCAL_DUMP_LDES,
            output: outputStream,
            ordered: "none",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got all members
        expect(count).toBe(4);
    });

    test("Fetching local dump LDES in ascending order and with before and after filters", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        const timestamps: number[] = [];

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, DC.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Check that member is within date constraints
                expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(
                    new Date("2024-08-22T05:56:57Z").getTime(),
                );
                expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(
                    new Date("2024-08-22T07:56:57Z").getTime(),
                );
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LOCAL_DUMP_LDES,
            output: outputStream,
            ordered: "ascending",
            before: new Date("2024-08-22T07:56:57Z"),
            after: new Date("2024-08-22T05:56:57Z"),
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Check we got some members
        expect(count).toBe(2);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching members from a minimal view of an LDES works without the tree:view triple if the rdf:type ldes:EventStream is present", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES_MINIMAL_VIEW,
            output: outputStream,
            ordered: "none",
            urlIsView: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Expect all members
        expect(count).toBe(12);
    });

    test("Fetching members in order from a minimal view of an LDES works by finding info at LDES URI", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);
                count++;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES_MINIMAL_VIEW,
            output: outputStream,
            ordered: "ascending",
            urlIsView: true,
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Expect all members
        expect(count).toBe(12);
    });

    test("Writer channel is closed upon completion, with an undefined message", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        let count = 0;
        let finished = false;

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);
                count++;
            } else {
                // Expect undefined message when stream is closed
                finished = true;
            }
        };

        const outputStream = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor = new LDESClientProcessor({
            url: LDES,
            output: outputStream,
            ordered: "none",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor.init.call(processor);
        // Start the processing function
        await processor.produce.call(processor);

        // Expect all members
        expect(count).toBe(12);
        // Expect output stream to be closed
        expect(finished).toBeTruthy();
    });

    test("Fetching an LDES unordered and checking if state is saved and enforced upon resume", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }
        };

        const outputStream1 = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor1 = new LDESClientProcessor({
            url: LDES,
            output: outputStream1,
            ordered: "none",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor1.init.call(processor1);
        // Start the processing function
        await processor1.produce.call(processor1);

        // Check we got all fragments and members
        expect(processor1.client.memberCount).toBe(12);
        expect(processor1.client.fragmentCount).toBe(4);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new WriterInstance("output", client, writable, logger);
        // Setup client
        const processor2 = new LDESClientProcessor({
            url: LDES,
            output: outputStream2,
            ordered: "none",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor2.init.call(processor2);
        // Start the processing function
        await processor2.produce.call(processor2);

        // Check that we didn't get any members but we still fetched mutable fragments
        expect(processor2.client.memberCount).toBe(0);
        expect(processor2.client.fragmentCount).toBe(1);
    });

    test("Fetching a Linked List LDES unordered and checking if state is saved and enforced upon resume", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }
        };

        const outputStream1 = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor1 = new LDESClientProcessor({
            url: LINKED_LIST_LDES,
            output: outputStream1,
            ordered: "none",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor1.init.call(processor1);
        // Start the processing function
        await processor1.produce.call(processor1);

        expect(processor1.client.memberCount).toBe(9);
        expect(processor1.client.fragmentCount).toBe(4);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new WriterInstance("output", client, writable, logger);
        // Setup client
        const processor2 = new LDESClientProcessor({
            url: LINKED_LIST_LDES,
            output: outputStream2,
            ordered: "none",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor2.init.call(processor2);
        // Start the processing function
        await processor2.produce.call(processor2);

        // Check that we didn't get any members but we still fetched mutable fragments
        expect(processor2.client.memberCount).toBe(0);
        expect(processor2.client.fragmentCount).toBe(3);
    });

    test("Fetching an LDES in ascending ordered and checking if state is saved and enforced upon resume", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        const timestamps: number[] = [];

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }
        };

        const outputStream1 = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor1 = new LDESClientProcessor({
            url: LDES,
            output: outputStream1,
            ordered: "ascending",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor1.init.call(processor1);
        // Start the processing function
        await processor1.produce.call(processor1);

        // Check we got all fragments and members
        expect(processor1.client.memberCount).toBe(12);
        expect(processor1.client.fragmentCount).toBe(4);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new WriterInstance("output", client, writable, logger);
        // Setup client
        const processor2 = new LDESClientProcessor({
            url: LDES,
            output: outputStream2,
            ordered: "ascending",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor2.init.call(processor2);
        // Start the processing function
        await processor2.produce.call(processor2);

        // Check that we didn't get any members but we still fetched mutable fragments
        expect(processor2.client.memberCount).toBe(0);
        expect(processor2.client.fragmentCount).toBe(1);
    });

    test("Fetching a Linked List LDES in ascending order and checking if state is saved and enforced upon resume", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        const timestamps: number[] = [];

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }
        };

        const outputStream1 = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor1 = new LDESClientProcessor({
            url: LINKED_LIST_LDES,
            output: outputStream1,
            ordered: "ascending",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor1.init.call(processor1);
        // Start the processing function
        await processor1.produce.call(processor1);

        // Check we got all fragments and members
        expect(processor1.client.memberCount).toBe(9);
        expect(processor1.client.fragmentCount).toBe(4);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new WriterInstance("output", client, writable, logger);
        // Setup client
        const processor2 = new LDESClientProcessor({
            url: LINKED_LIST_LDES,
            output: outputStream2,
            ordered: "ascending",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor2.init.call(processor2);
        // Start the processing function
        await processor2.produce.call(processor2);

        // Check that we didn't get any members but we still fetched mutable fragments
        expect(processor2.client.memberCount).toBe(0);
        expect(processor2.client.fragmentCount).toBe(3);
    });

    test("Fetching an LDES in descending ordered and checking if state is saved and enforced upon resume", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        const timestamps: number[] = [];

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }
        };

        const outputStream1 = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor1 = new LDESClientProcessor({
            url: LDES,
            output: outputStream1,
            ordered: "descending",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor1.init.call(processor1);
        // Start the processing function
        await processor1.produce.call(processor1);

        // Check we got all fragments and members
        expect(processor1.client.memberCount).toBe(12);
        expect(processor1.client.fragmentCount).toBe(4);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new WriterInstance("output", client, writable, logger);
        // Setup client
        const processor2 = new LDESClientProcessor({
            url: LDES,
            output: outputStream2,
            ordered: "descending",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor2.init.call(processor2);
        // Start the processing function
        await processor2.produce.call(processor2);
        
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(processor2.client.memberCount).toBe(0);
        expect(processor2.client.fragmentCount).toBe(1);
    });

    test("Fetching a Linked List LDES in descending ordered and checking if state is saved and enforced upon resume", async () => {
        const logger = winston.createLogger({
            transports: [new winston.transports.Console()],
        });
        const timestamps: number[] = [];

        const writable: Writable = async (msg) => {
            if (msg.msg) {
                // Decode the received data
                const member = Buffer.from(msg.msg.data).toString('utf-8');

                // Check SDS metadata is present
                expect(member.indexOf(SDS.stream)).toBeGreaterThan(0);
                expect(member.indexOf(SDS.payload)).toBeGreaterThan(0);

                // Extract timestamp property (ex:modified in this LDES)
                const store = RdfStore.createDefault();
                new Parser().parse(member).forEach((q) => store.addQuad(q));
                const timestampQ = store.getQuads(null, EX.terms.modified)[0];
                expect(timestampQ).toBeDefined();
                // Keep track of timestamp for checking order
                timestamps.push(new Date(timestampQ.object.value).getTime());
                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }
        };

        const outputStream1 = new WriterInstance("output", client, writable, logger);

        // Setup client
        const processor1 = new LDESClientProcessor({
            url: LINKED_LIST_LDES,
            output: outputStream1,
            ordered: "descending",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor1.init.call(processor1);
        // Start the processing function
        await processor1.produce.call(processor1);
        
        // Check we got all fragments and members
        expect(processor1.client.memberCount).toBe(9);
        expect(processor1.client.fragmentCount).toBe(4);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new WriterInstance("output", client, writable, logger);
        // Setup client
        const processor2 = new LDESClientProcessor({
            url: LINKED_LIST_LDES,
            output: outputStream2,
            ordered: "descending",
            savePath: "./tests/data/save.json",
            sdsify: true,
        }, logger);

        // Initialize and start the processor
        await processor2.init.call(processor2);
        // Start the processing function
        await processor2.produce.call(processor2);

        // Check that we didn't get any members but we still fetched mutable fragments
        expect(processor2.client.memberCount).toBe(0);
        expect(processor2.client.fragmentCount).toBe(3);
    });
});
