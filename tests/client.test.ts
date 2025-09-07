import { describe, beforeAll, afterAll, afterEach, expect, test, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fastify, RequestPayload } from "fastify";
import { fastifyStatic } from "@fastify/static";
import { createUriAndTermNamespace } from "@treecg/types";
import { RdfStore } from "rdf-stores";
import { streamToString } from "../lib/utils";
import { replicateLDES } from "../lib/client";

import type { FastifyInstance } from "fastify";
import type { FetchedPage, LDESInfo } from "../lib/fetcher";

describe("Client tests", () => {
    const LDES = "http://localhost:3001/mock-ldes.ttl";
    const LINKED_LIST_LDES = "http://localhost:3001/mock-ldes-linked-list.ttl";
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
                root: path.join(__dirname, "./data/mock-ldes"),
            });
            server.addHook(
                "onSend",
                async (request, reply, payload: RequestPayload) => {
                    const st = await streamToString(payload);

                    if (st.startsWith("# immutable")) {
                        reply.header("Cache-Control", "immutable");
                    }
                    return st;
                },
            );

            await server.listen({ port: 3001 });
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
        if (fs.existsSync("./tests/data/client-state.json")) {
            fs.rmSync(path.resolve("./tests/data/client-state.json"));
        }
    });

    afterEach(() => {
        if (fs.existsSync("./tests/data/client-state.json")) {
            fs.rmSync(path.resolve("./tests/data/client-state.json"));
        }
    });

    test("Client runs successfuly and all events are triggered", async () => {
        // Setup client
        const client = replicateLDES({
            url: LDES,
            stateFile: "./tests/data/client-state.json",
        });

        // Check that fragment event is triggered
        let gotFragmentEvent = false;
        client.on("fragment", async () => {
            gotFragmentEvent = true;
        });

        // Check that description event is triggered
        let gotDescEvent = false;
        client.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent = true;
        });

        // Start stream of members
        let memCount = 0;
        const members = client.stream({ highWaterMark: 10 });

        for await (const mem of members) {
            memCount += 1;
            expect(mem.id.value).toBeDefined();
            expect(mem.quads.length).toBeGreaterThan(0);
            expect(mem.timestamp).toBeDefined();
            expect(mem.isVersionOf).toBeDefined();

            // Check quad content
            const store = RdfStore.createDefault();
            mem.quads.forEach((q) => store.addQuad(q));

            // Check that all member data is present
            expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
        }

        expect(client.memberCount).toBe(12);
        expect(client.fragmentCount).toBe(4);
        // Check that we received all memebers
        expect(memCount).toBe(client.memberCount);
        expect(gotFragmentEvent).toBe(true);
        expect(gotDescEvent).toBe(true);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();
    })

    test("Client interruption and resuming in unoredered replication", async () => {
        // Setup client 1
        const client1 = replicateLDES({
            url: LDES,
            stateFile: "./tests/data/client-state.json",
        });

        let memCount = 0;

        // Member stream object
        const members1 = client1.stream({ highWaterMark: 10 }).getReader();

        // Check that description event is triggered
        let gotDescEvent1 = false;
        client1.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent1 = true;
        });

        // Check that fragment event is triggered
        let gotFragmentEvent1 = false;
        client1.on("fragment", async (fragment: FetchedPage) => {
            gotFragmentEvent1 = true;

            // Interrupt the stream after getting a specific fragment
            if (fragment.url === "http://localhost:3001/mock-ldes-1.ttl") {
                await members1.cancel();
            }
        });

        let memRes1 = await members1.read();
        while (memRes1) {
            const mem = memRes1.value;

            if (mem) {
                memCount += 1;
                expect(mem.id.value).toBeDefined();
                expect(mem.quads.length).toBeGreaterThan(0);
                expect(mem.timestamp).toBeDefined();
                expect(mem.isVersionOf).toBeDefined();

                // Check quad content
                const store = RdfStore.createDefault();
                mem.quads.forEach((q) => store.addQuad(q));

                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }

            if (memRes1.done) {
                break;
            }
            memRes1 = await members1.read();
        }

        // Depending on when the interruption happens, sometimes the client manages to fetch more or less fragments
        expect(client1.memberCount).toBeGreaterThanOrEqual(3);
        expect(client1.fragmentCount).toBeGreaterThanOrEqual(3);
        // Check that we received all memebers
        expect(memCount).toBe(client1.memberCount);
        expect(gotFragmentEvent1).toBe(true);
        expect(gotDescEvent1).toBe(true);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();

        /**
         * End of client 1
         */

        // Setup client 2
        const client2 = replicateLDES({
            url: LDES,
            stateFile: "./tests/data/client-state.json",
        });

        // Member stream object
        const members2 = client2.stream({ highWaterMark: 10 }).getReader();

        // Check that description event is triggered
        let gotDescEvent2 = false;
        client2.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent2 = true;
        });

        // Check that fragment event is triggered
        let gotFragmentEvent2 = false;
        client2.on("fragment", () => {
            gotFragmentEvent2 = true;
        });

        let memRes2 = await members2.read();
        while (memRes2) {
            const mem = memRes2.value;

            if (mem) {
                memCount += 1;
                expect(mem.id.value).toBeDefined();
                expect(mem.quads.length).toBeGreaterThan(0);
                expect(mem.timestamp).toBeDefined();
                expect(mem.isVersionOf).toBeDefined();

                // Check quad content
                const store = RdfStore.createDefault();
                mem.quads.forEach((q) => store.addQuad(q));

                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }

            if (memRes2.done) {
                break;
            }
            memRes2 = await members2.read();
        }

        expect(client2.fragmentCount).toBeGreaterThanOrEqual(1);
        // Check the total count of members
        expect(client1.memberCount + client2.memberCount).toBe(12);
        // Check that we received all memebers
        expect(memCount).toBe(client1.memberCount + client2.memberCount);
        expect(gotFragmentEvent2).toBe(true);
        expect(gotDescEvent2).toBe(true);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();
    })

    test("Client interruption and resuming in ordered replication (ascending)", async () => {
        // Setup client 1
        const client1 = replicateLDES(
            {
                url: LDES,
                stateFile: "./tests/data/client-state.json",
            },
            "ascending"
        );

        let memCount = 0;

        // Member stream object
        const members1 = client1.stream({ highWaterMark: 10 }).getReader();

        // Check that description event is triggered
        let gotDescEvent1 = false;
        client1.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent1 = true;
        });

        // Check that fragment event is triggered
        let gotFragmentEvent1 = false;
        client1.on("fragment", async (fragment: FetchedPage) => {
            gotFragmentEvent1 = true;

            // Interrupt the stream after getting a specific fragment
            if (fragment.url === "http://localhost:3001/mock-ldes-1.ttl") {
                await members1.cancel();
            }
        });

        const timestamps1: number[] = [];
        let memRes1 = await members1.read();
        while (memRes1) {
            const mem = memRes1.value;

            if (mem) {
                memCount += 1;
                expect(mem.id.value).toBeDefined();
                expect(mem.quads.length).toBeGreaterThan(0);
                expect(mem.timestamp).toBeDefined();
                expect(mem.isVersionOf).toBeDefined();

                // Keep track o the timestamps
                timestamps1.push((<Date>mem.timestamp).getTime());
                // Check quad content
                const store = RdfStore.createDefault();
                mem.quads.forEach((q) => store.addQuad(q));

                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }

            if (memRes1.done) {
                break;
            }
            memRes1 = await members1.read();
        }

        // Depending on when the interruption happens, sometimes the client manages to fetch more or less fragments
        expect(client1.memberCount).toBeGreaterThanOrEqual(3);
        expect(client1.fragmentCount).toBeGreaterThanOrEqual(3);
        // Check that we received all memebers
        expect(memCount).toBe(client1.memberCount);
        expect(gotFragmentEvent1).toBe(true);
        expect(gotDescEvent1).toBe(true);
        // Check that the timestamps are in ascending order
        expect(timestamps1.every(
            (v, i) => i === 0 || v >= timestamps1[i - 1],
        )).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();

        /**
         * End of client 1
         */

        // Setup client 2
        const client2 = replicateLDES(
            {
                url: LDES,
                stateFile: "./tests/data/client-state.json",
            },
            "ascending"
        );

        // Member stream object
        const members2 = client2.stream({ highWaterMark: 10 }).getReader();

        // Check that description event is triggered
        let gotDescEvent2 = false;
        client2.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent2 = true;
        });

        // Check that fragment event is triggered
        let gotFragmentEvent2 = false;
        client2.on("fragment", () => {
            gotFragmentEvent2 = true;
        });

        const timestamps2: number[] = [];
        let memRes2 = await members2.read();
        while (memRes2) {
            const mem = memRes2.value;

            if (mem) {
                memCount += 1;
                expect(mem.id.value).toBeDefined();
                expect(mem.quads.length).toBeGreaterThan(0);
                expect(mem.timestamp).toBeDefined();
                expect(mem.isVersionOf).toBeDefined();

                // Keep track o the timestamps
                timestamps2.push((<Date>mem.timestamp).getTime());
                // Check quad content
                const store = RdfStore.createDefault();
                mem.quads.forEach((q) => store.addQuad(q));

                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }

            if (memRes2.done) {
                break;
            }
            memRes2 = await members2.read();
        }

        expect(client2.fragmentCount).toBeGreaterThanOrEqual(2);
        // Check the total count of members
        expect(client1.memberCount + client2.memberCount).toBe(12);
        // Check that we received all memebers
        expect(memCount).toBe(client1.memberCount + client2.memberCount);
        expect(gotFragmentEvent2).toBe(true);
        expect(gotDescEvent2).toBe(true);
        // Check that the timestamps are in ascending order
        expect(timestamps2.every(
            (v, i) => i === 0 || v >= timestamps2[i - 1],
        )).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();
    })

    test("Client interruption and resuming in ordered replication (descending)", async () => {
        // Setup client 1
        const client1 = replicateLDES(
            {
                url: LDES,
                stateFile: "./tests/data/client-state.json",
            },
            "descending"
        );

        let memCount = 0;

        // Member stream object
        const members1 = client1.stream({ highWaterMark: 10 }).getReader();

        // Check that description event is triggered
        let gotDescEvent1 = false;
        client1.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent1 = true;
        });

        // Check that fragment event is triggered
        let gotFragmentEvent1 = false;
        client1.on("fragment", async (fragment: FetchedPage) => {
            gotFragmentEvent1 = true;

            // Interrupt the stream after getting a specific fragment
            if (fragment.url === "http://localhost:3001/mock-ldes-1.ttl") {
                await members1.cancel();
            }
        });

        let memRes1 = await members1.read();
        while (memRes1) {
            const mem = memRes1.value;

            if (mem) {
                memCount += 1;
            }

            if (memRes1.done) {
                break;
            }
            memRes1 = await members1.read();
        }

        // Depending on when the interruption happens, sometimes the client manages to fetch more or less fragments
        expect(client1.memberCount).toBe(0);
        expect(client1.fragmentCount).toBeGreaterThanOrEqual(3);
        // Check that no members were received
        expect(memCount).toBe(client1.memberCount);
        expect(gotFragmentEvent1).toBe(true);
        expect(gotDescEvent1).toBe(true);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();

        /**
         * End of client 1
         */

        // Setup client 2
        const client2 = replicateLDES(
            {
                url: LDES,
                stateFile: "./tests/data/client-state.json",
            },
            "descending"
        );

        // Member stream object
        const members2 = client2.stream({ highWaterMark: 10 }).getReader();

        // Check that description event is triggered
        let gotDescEvent2 = false;
        client2.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent2 = true;
        });

        // Check that fragment event is triggered
        let gotFragmentEvent2 = false;
        client2.on("fragment", () => {
            gotFragmentEvent2 = true;
        });

        const timestamps2: number[] = [];
        let memRes2 = await members2.read();
        while (memRes2) {
            const mem = memRes2.value;

            if (mem) {
                memCount += 1;
                expect(mem.id.value).toBeDefined();
                expect(mem.quads.length).toBeGreaterThan(0);
                expect(mem.timestamp).toBeDefined();
                expect(mem.isVersionOf).toBeDefined();

                // Keep track o the timestamps
                timestamps2.push((<Date>mem.timestamp).getTime());
                // Check quad content
                const store = RdfStore.createDefault();
                mem.quads.forEach((q) => store.addQuad(q));

                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }

            if (memRes2.done) {
                break;
            }
            memRes2 = await members2.read();
        }

        expect(client2.fragmentCount).toBeGreaterThanOrEqual(2);
        // Check the total count of members
        expect(client1.memberCount + client2.memberCount).toBe(12);
        // Check that we received all memebers
        expect(memCount).toBe(client1.memberCount + client2.memberCount);
        expect(gotFragmentEvent2).toBe(true);
        expect(gotDescEvent2).toBe(true);
        // Check that the timestamps are in ascending order
        expect(timestamps2.every(
            (v, i) => i === 0 || v <= timestamps2[i - 1],
        )).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();
    })

    test("Client interruption and resuming in ordered replication (ascending) of Linked List LDES", async () => {
        // Setup client 1
        const client1 = replicateLDES(
            {
                url: LINKED_LIST_LDES,
                stateFile: "./tests/data/client-state.json",
            },
            "ascending"
        );

        let memCount = 0;

        // Member stream object
        const members1 = client1.stream({ highWaterMark: 10 }).getReader();

        // Check that description event is triggered
        let gotDescEvent1 = false;
        client1.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent1 = true;
        });

        // Check that fragment event is triggered
        let gotFragmentEvent1 = false;
        client1.on("fragment", async (fragment: FetchedPage) => {
            gotFragmentEvent1 = true;

            // Interrupt the stream after getting a specific fragment
            if (fragment.url === "http://localhost:3001/mock-ldes-linked-list-1.ttl") {
                await members1.cancel();
            }
        });

        let memRes1 = await members1.read();
        while (memRes1) {
            const mem = memRes1.value;

            if (mem) {
                memCount += 1;
            }

            if (memRes1.done) {
                break;
            }
            memRes1 = await members1.read();
        }

        // Depending on when the interruption happens, sometimes the client manages to fetch more or less fragments
        expect(client1.memberCount).toBe(0);
        expect(client1.fragmentCount).toBeGreaterThanOrEqual(2);
        // Check that no members were received
        expect(memCount).toBe(client1.memberCount);
        expect(gotFragmentEvent1).toBe(true);
        expect(gotDescEvent1).toBe(true);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();

        /**
         * End of client 1
         */

        // Setup client 2
        const client2 = replicateLDES(
            {
                url: LINKED_LIST_LDES,
                stateFile: "./tests/data/client-state.json",
            },
            "ascending"
        );

        // Member stream object
        const members2 = client2.stream({ highWaterMark: 10 }).getReader();

        // Check that description event is triggered
        let gotDescEvent2 = false;
        client2.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent2 = true;
        });

        // Check that fragment event is triggered
        let gotFragmentEvent2 = false;
        client2.on("fragment", () => {
            gotFragmentEvent2 = true;
        });

        const timestamps2: number[] = [];
        let memRes2 = await members2.read();
        while (memRes2) {
            const mem = memRes2.value;

            if (mem) {
                memCount += 1;
                expect(mem.id.value).toBeDefined();
                expect(mem.quads.length).toBeGreaterThan(0);
                expect(mem.timestamp).toBeDefined();
                expect(mem.isVersionOf).toBeDefined();

                // Keep track o the timestamps
                timestamps2.push((<Date>mem.timestamp).getTime());
                // Check quad content
                const store = RdfStore.createDefault();
                mem.quads.forEach((q) => store.addQuad(q));

                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }

            if (memRes2.done) {
                break;
            }
            memRes2 = await members2.read();
        }

        expect(client2.fragmentCount).toBeGreaterThanOrEqual(2);
        // Check the total count of members
        expect(client1.memberCount + client2.memberCount).toBe(9);
        // Check that we received all memebers
        expect(memCount).toBe(client1.memberCount + client2.memberCount);
        expect(gotFragmentEvent2).toBe(true);
        expect(gotDescEvent2).toBe(true);
        // Check that the timestamps are in ascending order
        expect(timestamps2.every(
            (v, i) => i === 0 || v >= timestamps2[i - 1],
        )).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();
    })

    test("Client interruption and resuming in ordered replication (descending) of Linked List LDES", async () => {
        // Setup client 1
        const client1 = replicateLDES(
            {
                url: LINKED_LIST_LDES,
                stateFile: "./tests/data/client-state.json",
            },
            "descending"
        );

        let memCount = 0;

        // Member stream object
        const members1 = client1.stream({ highWaterMark: 10 }).getReader();

        // Check that fragment event is triggered
        let gotFragmentEvent1 = false;
        client1.on("fragment", async (fragment: FetchedPage) => {
            gotFragmentEvent1 = true;

            // Interrupt the stream after getting a specific fragment
            if (fragment.url === "http://localhost:3001/mock-ldes-linked-list.ttl") {
                await members1.cancel();
            }
        });

        let memRes1 = await members1.read();
        while (memRes1) {
            const mem = memRes1.value;

            if (mem) {
                memCount += 1;
            }

            if (memRes1.done) {
                break;
            }
            memRes1 = await members1.read();
        }

        // Depending on when the interruption happens, sometimes the client manages to fetch more or less fragments
        expect(client1.memberCount).toBe(0);
        expect(client1.fragmentCount).toBeGreaterThanOrEqual(1);
        // Check that no members were received
        expect(memCount).toBe(client1.memberCount);
        expect(gotFragmentEvent1).toBe(true);
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();

        /**
         * End of client 1
         */

        // Setup client 2
        const client2 = replicateLDES(
            {
                url: LINKED_LIST_LDES,
                stateFile: "./tests/data/client-state.json",
            },
            "descending"
        );

        // Member stream object
        const members2 = client2.stream({ highWaterMark: 10 }).getReader();

        // Check that description event is triggered
        let gotDescEvent2 = false;
        client2.on("description", async (info: LDESInfo) => {
            expect(info).toBeDefined();
            expect(info.shape).toBeDefined();
            expect(info.timestampPath?.value).toBe(EX.modified);
            expect(info.versionOfPath?.value).toBe(EX.isVersionOf);
            gotDescEvent2 = true;
        });

        // Check that fragment event is triggered
        let gotFragmentEvent2 = false;
        client2.on("fragment", () => {
            gotFragmentEvent2 = true;
        });

        const timestamps2: number[] = [];
        let memRes2 = await members2.read();
        while (memRes2) {
            const mem = memRes2.value;

            if (mem) {
                memCount += 1;
                expect(mem.id.value).toBeDefined();
                expect(mem.quads.length).toBeGreaterThan(0);
                expect(mem.timestamp).toBeDefined();
                expect(mem.isVersionOf).toBeDefined();

                // Keep track o the timestamps
                timestamps2.push((<Date>mem.timestamp).getTime());
                // Check quad content
                const store = RdfStore.createDefault();
                mem.quads.forEach((q) => store.addQuad(q));

                // Check that all member data is present
                expect(store.getQuads(null, EX.terms.subprop).length).toBeGreaterThan(0);
            }

            if (memRes2.done) {
                break;
            }
            memRes2 = await members2.read();
        }

        expect(client2.fragmentCount).toBe(4);
        // Check the total count of members
        expect(client1.memberCount + client2.memberCount).toBe(9);
        // Check that we received all memebers
        expect(memCount).toBe(client1.memberCount + client2.memberCount);
        expect(gotFragmentEvent2).toBe(true);
        expect(gotDescEvent2).toBe(true);
        // Check that the timestamps are in ascending order
        expect(timestamps2.every(
            (v, i) => i === 0 || v <= timestamps2[i - 1],
        )).toBeTruthy();
        // Check that state was saved
        expect(fs.existsSync("./tests/data/client-state.json")).toBeTruthy();
    })

    test("Client throws error when configured SHACL shape cannot be dereferenced", async () => {
        let threwError = false;
        try {
            // Setup client
            const client = replicateLDES({
                url: LDES,
                shapeFile: "http://localhost:3001/invalid-shape.ttl",
            });

            const members = client.stream({ highWaterMark: 10 }).getReader();
            await members.read();
        } catch (e) {
            threwError = true;
        }

        expect(threwError).toBeTruthy();
    })
});