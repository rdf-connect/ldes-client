import { describe, test, expect } from "@jest/globals";
import { SimpleStream } from "@ajuvercr/js-runner";
import { Parser } from "n3";
import { RdfStore } from "rdf-stores";
import { processor } from "../../lib/client";
import { DC, SDS } from "@treecg/types";

describe("Functional tests for the js:LdesClient Connector Architecture function", () => {

    test("Fetching a remote LDES unordered and with after filter", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data(() => {
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            "https://era.ilabt.imec.be/rinf/ldes",
            undefined,
            new Date("3024-03-09T15:00:00.000Z"),
            "none",
            false
        );

        // Run client
        await exec();
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching a remote LDES unordered and with before filter", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data(() => {
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            "https://era.ilabt.imec.be/rinf/ldes",
            new Date("1600-01-01T00:00:00.000Z"),
            undefined,
            "none",
            false
        );

        // Run client
        await exec();
        // No members were expected
        expect(count).toBe(0);
    });

    test("Fetching a remote LDES unordered and with before and after filter", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data(record => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThanOrEqual(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThanOrEqual(0);

            // Extract timestamp property (dc:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach(q => store.addQuad(q));
            const timestampQ = store.getQuads(null, DC.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Check that member is within date constraints
            expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(new Date("2024-03-08T11:39:00.000Z").getTime());
            expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(new Date("2024-03-08T11:43:00.000Z").getTime());
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            "https://era.ilabt.imec.be/rinf/ldes",
            new Date("2024-03-08T11:43:00.000Z"),
            new Date("2024-03-08T11:39:00.000Z"),
            "none",
            false
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBeGreaterThan(0);
    });

    test("Fetching a remote LDES in ascending order and with before and after filters", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data(record => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThanOrEqual(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThanOrEqual(0);

            // Extract timestamp property (dc:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach(q => store.addQuad(q));
            const timestampQ = store.getQuads(null, DC.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Check that member is within date constraints
            expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(new Date("2024-03-08T11:39:00.000Z").getTime());
            expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(new Date("2024-03-08T11:43:00.000Z").getTime());
            // Keep track of timestamp for checking order
            timestamps.push(new Date(timestampQ.object.value).getTime());
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            "https://era.ilabt.imec.be/rinf/ldes",
            new Date("2024-03-08T11:43:00.000Z"),
            new Date("2024-03-08T11:39:00.000Z"),
            "ascending",
            false
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBeGreaterThan(0);
        // Check result was ordered
        const isSorted = timestamps.every((v, i) => (i === 0 || v >= timestamps[i - 1]));
        expect(isSorted).toBeTruthy();
    });

    test("Fetching a remote LDES in descending order and with before and after filters", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];

        outputStream.data(record => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThanOrEqual(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThanOrEqual(0);

            // Extract timestamp property (dc:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach(q => store.addQuad(q));
            const timestampQ = store.getQuads(null, DC.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(new Date("2024-03-08T11:39:00.000Z").getTime());
            expect(new Date(timestampQ.object.value).getTime()).toBeLessThan(new Date("2024-03-08T11:43:00.000Z").getTime());
            // Keep track of timestamp for checking order
            timestamps.push(new Date(timestampQ.object.value).getTime());
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            "https://era.ilabt.imec.be/rinf/ldes",
            new Date("2024-03-08T11:43:00.000Z"),
            new Date("2024-03-08T11:39:00.000Z"),
            "descending",
            false
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBeGreaterThan(0);
        // Check result was ordered
        const isSorted = timestamps.every((v, i) => (i === 0 || v <= timestamps[i - 1]));
        expect(isSorted).toBeTruthy();
    });
});