import { describe, test, expect } from "@jest/globals";
import { SimpleStream } from "@ajuvercr/js-runner";
import { Parser } from "n3";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { processor } from "../../lib/client";
import { createUriAndTermNamespace, DC, RDF, SDS } from "@treecg/types";

const df = new DataFactory();

describe("Functional tests for the js:LdesClient Connector Architecture function", () => {
    const ERA_LDES = "https://era.ilabt.imec.be/rinf/ldes";
    const ERA = createUriAndTermNamespace("http://data.europa.eu/949/");
    const GSP = createUriAndTermNamespace("http://www.opengis.net/ont/geosparql#");

    test("Fetching a remote LDES unordered and with after filter", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        outputStream.data(() => {
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ERA_LDES,
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
            ERA_LDES,
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
            ERA_LDES,
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
            ERA_LDES,
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
            ERA_LDES,
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

    test("Fetching a remote LDES unordered, with before and after filter and LDES original shapes", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [ERA.custom("ContactLineSystem"), false],
            [ERA.custom("ETCSLevel"), false],
            [ERA.custom("LoadCapability"), false],
            [ERA.custom("NationalRailwayLine"), false],
            [ERA.custom("NetElement"), false],
            [ERA.custom("NetRelation"), false],
            [ERA.custom("OperationalPoint"), false],
            //[ERA.custom("Geometry"), false],
            //[ERA.custom("LineReference"), false],
            [ERA.custom("SectionOfLine"), false],
            [ERA.custom("Track"), false],
            [ERA.custom("TrainDetectionSystem"), false]
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
            ERA_LDES,
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

    test("Fetching a remote LDES unordered, with before and after filter and overridden full shapes 1", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [ERA.custom("ContactLineSystem"), false],
            [ERA.custom("ETCSLevel"), false],
            [ERA.custom("LoadCapability"), false],
            [ERA.custom("NationalRailwayLine"), false],
            [ERA.custom("NetElement"), false],
            [ERA.custom("NetRelation"), false],
            [ERA.custom("OperationalPoint"), false],
            [GSP.custom("Geometry"), false],
            [ERA.custom("LineReference"), false],
            [ERA.custom("SectionOfLine"), false],
            [ERA.custom("Track"), false],
            [ERA.custom("TrainDetectionSystem"), false]
        ]);

        outputStream.data(record => {
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach(q => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }

            // Check era:OperationalPoint instances include triples of related gsp:Geometry (if not an as:Delete)
            if (
                record.includes(ERA.custom("OperationalPoint")) &&
                !record.includes("<https://www.w3.org/ns/activitystreams#Delete>")
            ) {
                expect(store.getQuads(
                    null,
                    RDF.terms.type,
                    df.namedNode("http://www.opengis.net/ont/geosparql#Geometry")
                ).length).toBe(1);
                expect(store.getQuads(
                    null,
                    df.namedNode(GSP.custom("asWKT"))
                ).length).toBe(1);
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ERA_LDES,
            new Date("2024-03-08T11:43:00.000Z"),
            new Date("2024-03-08T11:39:00.000Z"),
            "none",
            false,
            undefined,
            "./tests/data/shape-full-1.ttl",
            false
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBeGreaterThan(0);
        // Check we saw all expected classes
        expect(Array.from(observedClasses.values()).every(v => v === true)).toBeTruthy();
    });

    test("Fetching a remote LDES unordered, with before and after filter and overridden full shapes 2", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        const observedClasses = new Map<string, boolean>([
            [ERA.custom("ContactLineSystem"), false],
            [ERA.custom("ETCSLevel"), false],
            [ERA.custom("LoadCapability"), false],
            [ERA.custom("NationalRailwayLine"), false],
            [ERA.custom("NetElement"), false],
            [ERA.custom("NetRelation"), false],
            [ERA.custom("OperationalPoint"), false],
            [GSP.custom("Geometry"), false],
            [ERA.custom("LineReference"), false],
            [ERA.custom("SectionOfLine"), false],
            [ERA.custom("Track"), false],
            [ERA.custom("TrainDetectionSystem"), false]
        ]);

        outputStream.data(record => {
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach(q => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }

            // Check era:OperationalPoint instances include triples of related gsp:Geometry (if not an as:Delete)
            if (
                record.includes(ERA.custom("OperationalPoint")) &&
                !record.includes("<https://www.w3.org/ns/activitystreams#Delete>")
            ) {
                expect(store.getQuads(
                    null,
                    RDF.terms.type,
                    df.namedNode(GSP.custom("Geometry"))
                ).length).toBe(1);
                expect(store.getQuads(
                    null,
                    df.namedNode(GSP.custom("asWKT"))
                ).length).toBe(1);
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ERA_LDES,
            new Date("2024-03-08T11:43:00.000Z"),
            new Date("2024-03-08T11:39:00.000Z"),
            "none",
            false,
            undefined,
            "./tests/data/shape-full-2.ttl",
            false
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBeGreaterThan(0);
        // Check we saw all expected classes
        expect(Array.from(observedClasses.values()).every(v => v === true)).toBeTruthy();
    });

    test("Fetching a remote LDES unordered, with before and after filter and overridden partial shapes", async () => {
        const outputStream = new SimpleStream<string>();

        let count = 0;
        // All classes except for classes of sub-entities gsp:Geometry and era:LineReference
        const observedClasses = new Map<string, boolean>([
            [ERA.custom("ContactLineSystem"), false],
            [ERA.custom("ETCSLevel"), false],
            [ERA.custom("LoadCapability"), false],
            [ERA.custom("NationalRailwayLine"), false],
            [ERA.custom("NetElement"), false],
            [ERA.custom("NetRelation"), false],
            [ERA.custom("OperationalPoint"), false],
            [ERA.custom("SectionOfLine"), false],
            [ERA.custom("Track"), false],
            [ERA.custom("TrainDetectionSystem"), false]
        ]);

        outputStream.data(record => {
            const store = RdfStore.createDefault();
            new Parser().parse(record).forEach(q => store.addQuad(q));

            // Check which classes we got
            for (const classSuffix of observedClasses.keys()) {
                if (record.includes(classSuffix)) {
                    observedClasses.set(classSuffix, true);
                }
            }

            // Check era:OperationalPoint instances does not include triples of a related gsp:Geometry (if not an as:Delete)
            if (
                record.includes(ERA.custom("OperationalPoint")) &&
                !record.includes("<https://www.w3.org/ns/activitystreams#Delete>")
            ) {
                expect(store.getQuads(
                    null,
                    RDF.terms.type,
                    df.namedNode("http://www.opengis.net/ont/geosparql#Geometry")
                ).length).toBe(0);
            }
            count++;
        });

        // Setup client
        const exec = await processor(
            outputStream,
            ERA_LDES,
            new Date("2024-03-08T11:43:00.000Z"),
            new Date("2024-03-08T11:39:00.000Z"),
            "none",
            false,
            undefined,
            "./tests/data/shape-partial.ttl",
            false
        );

        // Run client
        await exec();
        // Check we got some members
        expect(count).toBeGreaterThan(0);
        // Check we saw all expected classes
        expect(Array.from(observedClasses.values()).every(v => v === true)).toBeTruthy();
    });
});
