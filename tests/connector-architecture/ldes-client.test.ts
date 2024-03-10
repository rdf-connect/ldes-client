import { describe, test, expect } from "@jest/globals";
import { SimpleStream } from "@ajuvercr/js-runner";
import { Parser } from "n3";
import { RdfStore } from "rdf-stores";
import { processor } from "../../lib/client";
import { DC, LDES, RDF, SDS } from "@treecg/types";

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

    test("Fetching a remote LDES unordered, with before and after filter and original shapes", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            ["ContactLineSystem", false],
            ["ETCSLevel", false],
            ["LoadCapability", false],
            ["NationalRailwayLine", false],
            ["NetElement", false],
            ["NetRelation", false],
            ["OperationalPoint", false],
            ["Geometry", false],
            ["LineReference", false],
            ["SectionOfLine", false],
            ["Track", false],
            ["TrainDetectionSystem", false]
        ]);
        outputStream.data(record => {
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
            "https://era.ilabt.imec.be/rinf/ldes",
            new Date("2024-03-08T11:43:00.000Z"),
            new Date("2024-03-08T11:39:00.000Z"),
            "none",
            false,
            undefined,
            undefined,
            false
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBeGreaterThan(0);
        // Check we saw all expected classes
        expect(Array.from(observedClasses.values()).every(v => v === true)).toBeTruthy();
    });

    test("Fetching a remote LDES unordered, with before and after filter and overridden shapes", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Set<string>();
        outputStream.data(record => {
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach(q => store.addQuad(q));
            const typeQs = store.getQuads(null, RDF.terms.type);
            typeQs.forEach(tq => observedClasses.add(tq.object.value));

            // Check era:Tracks only have the 2 properties defined in shape2.ttl
            if (record.includes("/Track")) {
                expect(store.getQuads(typeQs[0].subject).length).toBeLessThanOrEqual(2);
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            "https://era.ilabt.imec.be/rinf/ldes",
            new Date("2024-03-08T11:43:00.000Z"),
            new Date("2024-03-08T11:39:00.000Z"),
            "none",
            false,
            undefined,
            ["./tests/data/shape1.ttl", "./tests/data/shape2.ttl"],
            false
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBeGreaterThan(0);
        // Check we only saw expected classes
        expect(observedClasses.size).toBe(5);
    });

    test("Fetching a remote LDES in ascending order, with before filter and checking for transaction end flag", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const records: string[] = [];

        outputStream.data(record => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThanOrEqual(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThanOrEqual(0);

            // Extract timestamp property (dc:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach(q => store.addQuad(q));
            const timestampQ = store.getQuads(null, DC.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Check that member is within date constraints
            expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(new Date("2024-03-08T15:00:00.000Z").getTime());
            // Keep track of timestamp for checking order
            timestamps.push(new Date(timestampQ.object.value).getTime());
            records.push(record);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            "https://era.ilabt.imec.be/rinf/ldes",
            undefined,
            new Date("2024-03-08T15:00:00.000Z"),
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
        expect(records[records.length - 1].includes("isLastOfTransaction")).toBeTruthy();
    });

    test("Fetching a remote LDES in descending order, with before filter and checking for transaction end flag", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const timestamps: number[] = [];
        const records: string[] = [];

        outputStream.data(record => {
            expect(record.indexOf(SDS.stream)).toBeGreaterThanOrEqual(0);
            expect(record.indexOf(SDS.payload)).toBeGreaterThanOrEqual(0);

            // Extract timestamp property (dc:modified in this LDES)
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach(q => store.addQuad(q));
            const timestampQ = store.getQuads(null, DC.terms.modified)[0];
            expect(timestampQ).toBeDefined();
            // Check that member is within date constraints
            expect(new Date(timestampQ.object.value).getTime()).toBeGreaterThan(new Date("2024-03-08T15:00:00.000Z").getTime());
            // Keep track of timestamp for checking order
            timestamps.push(new Date(timestampQ.object.value).getTime());
            // Keep track of all records to check for transaction order
            records.push(record);
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            "https://era.ilabt.imec.be/rinf/ldes",
            undefined,
            new Date("2024-03-08T15:00:00.000Z"),
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
        expect(records[0].includes("isLastOfTransaction")).toBeTruthy();
    });
});