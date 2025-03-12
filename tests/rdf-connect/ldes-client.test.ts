import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "fs";
import path from "path";
import { createUriAndTermNamespace, RDF, SDS, DC } from "@treecg/types";
import { SimpleStream } from "@rdfc/js-runner";
import { fastify, FastifyInstance, RequestPayload } from "fastify";
import { fastifyStatic } from "@fastify/static";
import { Parser } from "n3";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { replicateLDES } from "../../lib/client";
import { processor } from "../../lib/rdfc-processor";
import { streamToString } from "../../lib/utils";

const df = new DataFactory();

describe("Functional tests for the js:LdesClient RDF-Connect processor", () => {
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
                    if (st.startsWith("# delay ")) {
                        const reg = /# delay (?<delay>[0-9]+)/;
                        const found = st.match(reg);
                        const delay = found?.groups && found?.groups["delay"];
                        console.log("found delay", delay);
                        if (delay) {
                            try {
                                const delayInt = parseInt(delay);
                                await new Promise((res) =>
                                    setTimeout(res, delayInt),
                                );
                                /* eslint no-empty: ["error", { "allowEmptyCatch": true }] */
                            } catch (ex: unknown) {
                                /* empty */
                            }
                        }
                    }
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

    test("Fetching an LDES unordered and no filters to get all members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            // Check SDS metadata is present
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Expect all members
        expect(count).toBe(12);
    });

    test("Fetching an atypical LDES unordered and no filters to get all members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            // Check SDS metadata is present
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Expect all members
        expect(count).toBe(12);
    });

    test("Fetching an tree:InBetweenRelation LDES unordered and no filters to get all members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            // Check SDS metadata is present
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Expect all members
        expect(count).toBe(15);
    });

    test("Fetching an LDES unordered and with after filter that gets no members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data(() => {
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            undefined,
            new Date("3024-03-09T15:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching an atypical LDES unordered and with after filter that gets no members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data(() => {
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            undefined,
            new Date("3024-03-09T15:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching a tree:InBetweenRelation LDES unordered and with after filter that gets no members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data(() => {
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            undefined,
            new Date("3024-03-09T15:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching an LDES unordered and with before filter that gets no members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data(() => {
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("1325-03-09T15:00:00.000Z"),
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching an atypical LDES unordered and with before filter that gets no members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data(() => {
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("1325-03-09T15:00:00.000Z"),
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching an LDES unordered and with before and after filter", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            // Check SDS metadata is present
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Check timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T09:30:00.000Z"),
            new Date("2024-07-14T08:30:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(3);
    });

    test("Fetching an atypical LDES unordered and with before and after filter", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            // Check SDS metadata is present
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Check timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(10);
    });

    test("Fetching a tree:InBetweenRelation LDES unordered and with before and after filter", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            // Check SDS metadata is present
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Check timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(7);
    });

    test("Fetching an LDES in ascending order and with before and after filters", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T10:30:00.000Z"),
            new Date("2024-07-14T09:00:00.000Z"),
            "ascending",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(3);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching an atypical LDES in ascending order and with before and after filters", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "ascending",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(10);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES in ascending order and with before and after filters", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "ascending",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(7);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching an LDES in descending order and with before and after filters", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T10:30:00.000Z"),
            new Date("2024-07-14T09:00:00.000Z"),
            "descending",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(3);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching an atypical LDES in descending order and with before and after filters", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "descending",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(10);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES in descending order and with before and after filters", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "descending",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(7);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES first member is emitted asap ascending", async () => {
        const client = replicateLDES(
            {
                url: INBETWEEN_LDES,
            },
            "ascending",
        );
        const stream = client.stream().getReader();
        const start = new Date();
        for (let i = 0; i < 3; i++) {
            const m1 = await stream.read();
            expect(m1.done).toBeFalsy();
        }
        const mid = new Date();
        expect(mid.getTime() - start.getTime()).toBeLessThan(150);
        const m2 = await stream.read();
        expect(m2.done).toBeFalsy();
        const end = new Date();
        expect(end.getTime() - start.getTime()).toBeGreaterThan(200);
    });

    test("Fetching a tree:InBetweenRelation LDES first member is emitted asap descending", async () => {
        const client = replicateLDES(
            {
                url: INBETWEEN_LDES,
            },
            "descending",
        );
        const stream = client.stream().getReader();
        const start = new Date();
        for (let i = 0; i < 3; i++) {
            const m1 = await stream.read();
            expect(m1.done).toBeFalsy();
        }
        const mid = new Date();
        expect(mid.getTime() - start.getTime()).toBeLessThan(150);
        const m2 = await stream.read();
        expect(m2.done).toBeFalsy();
        const end = new Date();
        expect(end.getTime() - start.getTime()).toBeGreaterThan(200);
    });

    test("Fetching an LDES unordered, with before and after filter and LDES original shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);
        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T10:30:00.000Z"),
            new Date("2024-07-14T09:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an atypical LDES unordered, with before and after filter and LDES original shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);
        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES unordered, with before and after filter and LDES original shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);
        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an LDES unordered, with before and after filter and overridden local shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }

            // Check ex:Clazz2 instance was not extracted
            expect(
                store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                    .length,
            ).toBe(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T10:30:00.000Z"),
            new Date("2024-07-14T09:00:00.000Z"),
            "none",
            false,
            undefined,
            "./tests/data/mock-ldes/partial-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an atypical LDES unordered, with before and after filter and overridden local shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }

            // Check ex:Clazz2 instance was not extracted
            expect(
                store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                    .length,
            ).toBe(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "none",
            false,
            undefined,
            "./tests/data/mock-ldes/partial-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES unordered, with before and after filter and overridden local shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }

            // Check ex:Clazz2 instance was not extracted
            expect(
                store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                    .length,
            ).toBe(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "none",
            false,
            undefined,
            "./tests/data/mock-ldes/partial-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an LDES unordered, with before and after filter and overridden remote shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T10:30:00.000Z"),
            new Date("2024-07-14T09:00:00.000Z"),
            "none",
            false,
            undefined,
            "http://localhost:3000/full-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an atypical LDES unordered, with before and after filter and overridden remote shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "none",
            false,
            undefined,
            "http://localhost:3000/full-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES unordered, with before and after filter and overridden remote shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "none",
            false,
            undefined,
            "http://localhost:3000/full-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an LDES unordered, with before and after filters and no shape (defaults to CBD member extraction)", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }

            // Check ex:Clazz2 instance was not extracted
            expect(
                store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                    .length,
            ).toBe(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T10:30:00.000Z"),
            new Date("2024-07-14T09:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            true, // No shape
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(3);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an atypical LDES unordered, with before and after filters and no shape (defaults to CBD member extraction)", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }

            // Check ex:Clazz2 instance was not extracted
            expect(
                store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                    .length,
            ).toBe(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            true, // No shape
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(10);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching a tree:InBetweenRelation LDES unordered, with before and after filters and no shape (defaults to CBD member extraction)", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

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
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }

            // Check ex:Clazz2 instance was not extracted
            expect(
                store.getQuads(null, RDF.terms.type, df.namedNode(EX.Clazz2))
                    .length,
            ).toBe(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            true, // No shape
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(7);
        // Check we saw all expected classes
        expect(
            Array.from(observedClasses.values()).every((v) => v === true),
        ).toBeTruthy();
    });

    test("Fetching an LDES in ascending order, with before and after filter and overridden remote shape", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T10:30:00.000Z"),
            new Date("2024-07-14T09:00:00.000Z"),
            "ascending",
            false,
            undefined,
            "http://localhost:3000/full-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
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
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "ascending",
            false,
            undefined,
            "http://localhost:3000/full-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
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
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "ascending",
            false,
            undefined,
            "http://localhost:3000/full-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
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
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const memberIds = new Set<string>();
        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Keep track of member IDs
            memberIds.add(
                store.getQuads(null, SDS.terms.payload)[0].object.value,
            );

            // Check the version property is not present
            expect(
                store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
            ).toBe(0);

            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            true, // Materialize members
            false,
        );

        // Run client
        await exec();
        // Check we got all members
        expect(count).toBe(12);
        // Check we got all unique members
        expect(memberIds.size).toBe(6);
    });

    test("Fetching an atypical LDES unordered and version materialized members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const memberIds = new Set<string>();
        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Keep track of member IDs
            memberIds.add(
                store.getQuads(null, SDS.terms.payload)[0].object.value,
            );

            // Check the version property is not present
            expect(
                store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
            ).toBe(0);

            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            true, // Materialize members
            false,
        );

        // Run client
        await exec();
        // Check we got all members
        expect(count).toBe(12);
        // Check we got all unique members
        expect(memberIds.size).toBe(6);
    });

    test("Fetching a tree:InBetweenRelation LDES unordered and version materialized members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const memberIds = new Set<string>();
        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Keep track of member IDs
            memberIds.add(
                store.getQuads(null, SDS.terms.payload)[0].object.value,
            );

            // Check the version property is not present
            expect(
                store.getQuads(null, df.namedNode(EX.isVersionOf)).length,
            ).toBe(0);

            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            true, // Materialize members
            false,
        );

        // Run client
        await exec();
        // Check we got all members
        expect(count).toBe(15);
        // Check we got all unique members
        expect(memberIds.size).toBe(3);
    });

    test("Fetching an LDES in ascending order, with before and after filters, overriden local shape and version materialized members", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);
        const memberIds = new Set<string>();

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T10:30:00.000Z"),
            new Date("2024-07-14T09:00:00.000Z"),
            "ascending",
            false,
            undefined,
            "./tests/data/mock-ldes/partial-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            true, // Materialize members
            false,
        );

        // Run client
        await exec();
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
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);
        const memberIds = new Set<string>();

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "ascending",
            false,
            undefined,
            "./tests/data/mock-ldes/partial-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            true, // Materialize members
            false,
        );

        // Run client
        await exec();
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
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([[EX.Clazz1, false]]);
        const memberIds = new Set<string>();

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "ascending",
            false,
            undefined,
            "./tests/data/mock-ldes/partial-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            true, // Materialize members
            false,
        );

        // Run client
        await exec();
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
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const memberIds = new Set<string>();

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract canonical member ID and timestamp
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const canonicalId = store.getQuads(null, EX.terms.isVersionOf)[0]
                .object.value;
            // Check that member hasn't been seen before
            expect(memberIds.has(canonicalId)).toBeFalsy();

            memberIds.add(canonicalId);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            true, // last version only
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(6);
    });

    test("Fetching an atypical LDES asking for only the last version of every member", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const memberIds = new Set<string>();

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract canonical member ID and timestamp
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const canonicalId = store.getQuads(null, EX.terms.isVersionOf)[0]
                .object.value;
            // Check that member hasn't been seen before
            expect(memberIds.has(canonicalId)).toBeFalsy();

            memberIds.add(canonicalId);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            true, // last version only
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(6);
    });

    test("Fetching a tree:InBetweenRelation LDES asking for only the last version of every member", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const memberIds = new Set<string>();

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract canonical member ID and timestamp
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const canonicalId = store.getQuads(null, EX.terms.isVersionOf)[0]
                .object.value;
            // Check that member hasn't been seen before
            expect(memberIds.has(canonicalId)).toBeFalsy();

            memberIds.add(canonicalId);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            true, // last version only
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(3);
    });

    test("Fetching an LDES with before and after filter, overriden remote shape, asking for only the last version of every member and versioned materialized", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);
        const memberIds = new Set<string>();

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            new Date("2024-07-14T10:30:00.000Z"),
            new Date("2024-07-14T09:00:00.000Z"),
            "none",
            false,
            undefined,
            "http://localhost:3000/full-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            true, // Materialized members
            true, // Last version only
        );

        // Run client
        await exec();
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
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);
        const memberIds = new Set<string>();

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ATYPICAL_LDES,
            new Date("2024-09-18T10:53:00.000Z"),
            new Date("2024-09-18T09:00:00.000Z"),
            "none",
            false,
            undefined,
            "http://localhost:3000/full-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            true, // Materialized members
            true, // Last version only
        );

        // Run client
        await exec();
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
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const observedClasses = new Map<string, boolean>([
            [EX.Clazz1, false],
            [EX.Clazz2, false],
        ]);
        const memberIds = new Set<string>();

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            INBETWEEN_LDES,
            new Date("2024-09-26T10:25:00.000Z"),
            new Date("2024-09-26T09:00:00.000Z"),
            "none",
            false,
            undefined,
            "http://localhost:3000/full-shape.ttl",
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            true, // Materialized members
            true, // Last version only
        );

        // Run client
        await exec();
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
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps.push(new Date(timestampQ.object.value).getTime());
            // Check that out-of-band data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            { concurrent: 1 },
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got all members
        expect(count).toBe(9);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching a local dump LDES unorder", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LOCAL_DUMP_LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got all members
        expect(count).toBe(4);
    });

    test("Fetching local dump LDES in ascending order and with before and after filters", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data((record) => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
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
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LOCAL_DUMP_LDES,
            new Date("2024-08-22T07:56:57Z"),
            new Date("2024-08-22T05:56:57Z"),
            "ascending",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBe(2);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
    });

    test("Fetching members from a minimal view of an LDES work without the tree:view triple if the rdf:type ldes:EventStream is present", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            // Check SDS metadata is present
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES_MINIMAL_VIEW,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            true,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Expect all members
        expect(count).toBe(12);
    });

    test("Fetching members in order from a minimal view of an LDES work by finding info at LDES URI", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            // Check SDS metadata is present
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES_MINIMAL_VIEW,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            true,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Expect all members
        expect(count).toBe(12);
    });

    test("Writer channel is closed upon completion", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data((record) => {
            // Check SDS metadata is present
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);
            count++;
        });

        let finished = false;
        outputStream.on("end", () => {
            finished = true;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        await exec();
        // Expect all members
        expect(count).toBe(12);
        // Expect output stream to be closed
        expect(finished).toBeTruthy();
    });

    test("Fetching an LDES unordered and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();

        outputStream1.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client1 = await exec1();
        // Check we got all fragments and members
        expect(client1.memberCount).toBe(12);
        expect(client1.fragmentCount).toBe(3);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();

        const exec2 = await processor(
            outputStream2,
            LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(0);
        expect(client2.fragmentCount).toBe(1);

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });

    test("Fetching a Linked List LDES unordered and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();

        outputStream1.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client1 = await exec1();
        // Check we got all fragments and members
        expect(client1.memberCount).toBe(9);
        expect(client1.fragmentCount).toBe(3);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();

        const exec2 = await processor(
            outputStream2,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "none",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(0);
        expect(client2.fragmentCount).toBe(2);

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });

    test("Fetching an LDES in ascending ordered and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();
        const timestamps: number[] = [];

        outputStream1.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps.push(new Date(timestampQ.object.value).getTime());
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LDES,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client1 = await exec1();
        // Check we got all fragments and members
        expect(client1.memberCount).toBe(12);
        expect(client1.fragmentCount).toBe(3);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();

        const exec2 = await processor(
            outputStream2,
            LDES,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(0);
        expect(client2.fragmentCount).toBe(1);

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });

    test("Fetching a Linked List LDES in ascending order and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();
        const timestamps: number[] = [];

        outputStream1.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps.push(new Date(timestampQ.object.value).getTime());
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client1 = await exec1();
        // Check we got all fragments and members
        expect(client1.memberCount).toBe(9);
        expect(client1.fragmentCount).toBe(3);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v >= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();

        const exec2 = await processor(
            outputStream2,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(0);
        expect(client2.fragmentCount).toBe(2);

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });

    test("Fetching an LDES in descending ordered and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();
        const timestamps: number[] = [];

        outputStream1.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps.push(new Date(timestampQ.object.value).getTime());
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LDES,
            undefined,
            undefined,
            "descending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client1 = await exec1();
        // Check we got all fragments and members
        expect(client1.memberCount).toBe(12);
        expect(client1.fragmentCount).toBe(3);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();

        const exec2 = await processor(
            outputStream2,
            LDES,
            undefined,
            undefined,
            "descending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(0);
        expect(client2.fragmentCount).toBe(1);

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });

    test("Fetching a Linked List LDES in descending ordered and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();
        const timestamps: number[] = [];

        outputStream1.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps.push(new Date(timestampQ.object.value).getTime());
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "descending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client1 = await exec1();
        // Check we got all fragments and members
        expect(client1.memberCount).toBe(9);
        expect(client1.fragmentCount).toBe(3);
        // Check result was ordered
        const isSorted = timestamps.every(
            (v, i) => i === 0 || v <= timestamps[i - 1],
        );
        expect(isSorted).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();

        const exec2 = await processor(
            outputStream2,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "descending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(0);
        expect(client2.fragmentCount).toBe(2);

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });

    test("Fetching an LDES in ascending ordered, interrupting it and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();
        const timestamps1: number[] = [];

        outputStream1.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps1.push(new Date(timestampQ.object.value).getTime());
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LDES,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
            undefined,
            ["http://localhost:3000/mock-ldes-1.ttl"] // interrupt on this fragment
        );

        // Run client
        const client1 = await exec1();
        // Check we got some of the fragments and members
        expect(client1.memberCount).toBe(3);
        expect(client1.fragmentCount).toBe(2);
        // Check result was ordered
        const isSorted1 = timestamps1.every(
            (v, i) => i === 0 || v >= timestamps1[i - 1],
        );
        expect(isSorted1).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();
        const timestamps2: number[] = [];

        outputStream2.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps2.push(new Date(timestampQ.object.value).getTime());
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        const exec2 = await processor(
            outputStream2,
            LDES,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(9);
        expect(client2.fragmentCount).toBe(1);
        // Check result was ordered
        const isSorted2 = timestamps2.every(
            (v, i) => i === 0 || v >= timestamps2[i - 1],
        );
        expect(isSorted2).toBeTruthy();

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });

    test("Fetching a Linked List LDES in ascending ordered, interrupting it and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
            undefined,
            ["http://localhost:3000/mock-ldes-linked-list-1.ttl"] // interrupt on this fragment
        );

        // Run client
        const client1 = await exec1();
        // Check we got some of the fragments and members
        expect(client1.memberCount).toBe(0);
        expect(client1.fragmentCount).toBe(2);

        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();
        const timestamps2: number[] = [];

        outputStream2.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps2.push(new Date(timestampQ.object.value).getTime());
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        const exec2 = await processor(
            outputStream2,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "ascending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(9);
        expect(client2.fragmentCount).toBe(3);
        // Check result was ordered
        const isSorted2 = timestamps2.every(
            (v, i) => i === 0 || v >= timestamps2[i - 1],
        );
        expect(isSorted2).toBeTruthy();

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });

    test("Fetching an LDES in descending ordered, interrupting it and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            await fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LDES,
            undefined,
            undefined,
            "descending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
            undefined,
            ["http://localhost:3000/mock-ldes-1.ttl"] // interrupt on this fragment
        );

        // Run client
        const client1 = await exec1();
        // Check we got some of the fragments and no members
        expect(client1.memberCount).toBe(0);
        expect(client1.fragmentCount).toBe(2);

        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();
        const timestamps2: number[] = [];

        outputStream2.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps2.push(new Date(timestampQ.object.value).getTime());
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        const exec2 = await processor(
            outputStream2,
            LDES,
            undefined,
            undefined,
            "descending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(12);
        expect(client2.fragmentCount).toBe(1);
        // Check result was ordered
        const isSorted2 = timestamps2.every(
            (v, i) => i === 0 || v <= timestamps2[i - 1],
        );
        expect(isSorted2).toBeTruthy();

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });

    test("Fetching a Linked List LDES in descending ordered, interrupting it and checking if state is saved and enforced upon resume", async () => {
        const outputStream1 = new SimpleStream<string>();

        // Hack needed because for some reason this file remains after the test
        // when using npm test. It does not happen when using bun though ¯\_(ツ)_/¯
        if (fs.existsSync("./tests/data/save.json")) {
            await fs.rmSync(path.resolve("./tests/data/save.json"));
        }

        // Setup client 1
        const exec1 = await processor(
            outputStream1,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "descending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
            undefined,
            ["http://localhost:3000/mock-ldes-linked-list.ttl"] // interrupt on this fragment
        );

        // Run client
        const client1 = await exec1();
        // Check we got some of the fragments and no members
        expect(client1.memberCount).toBe(0);
        expect(client1.fragmentCount).toBe(1);

        // Check that state was saved
        expect(fs.existsSync("./tests/data/save.json")).toBeTruthy();

        // Run a second client with the saved state
        const outputStream2 = new SimpleStream<string>();
        const timestamps2: number[] = [];

        outputStream2.data((record) => {
            // Check presence of SDS terms
            expect(record.indexOf(SDS.stream)).toBeGreaterThan(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThan(0);

            // Extract timestamp property (ex:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach((q) => store.addQuad(q));
            const timestampQ = store.getQuads(null, EX.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Keep track of timestamp for checking order
            timestamps2.push(new Date(timestampQ.object.value).getTime());
            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        });

        const exec2 = await processor(
            outputStream2,
            LINKED_LIST_LDES,
            undefined,
            undefined,
            "descending",
            false,
            undefined,
            undefined,
            false,
            "./tests/data/save.json",
            false,
            false,
            undefined,
            undefined,
            false,
            false,
        );

        // Run client
        const client2 = await exec2();
        // Check that we didn't get any members but we still fetched mutable fragments
        expect(client2.memberCount).toBe(9);
        expect(client2.fragmentCount).toBe(3);
        // Check result was ordered
        const isSorted2 = timestamps2.every(
            (v, i) => i === 0 || v <= timestamps2[i - 1],
        );
        expect(isSorted2).toBeTruthy();

        // Clean up
        fs.rmSync(path.resolve("./tests/data/save.json"));
    });
});
