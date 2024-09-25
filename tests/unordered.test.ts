/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { read, Tree } from "./helper";

import { replicateLDES, retry_fetch } from "../lib/client";
import { Parser } from "n3";
import { TREE } from "@treecg/types";
import { rmSync } from "fs";

const oldFetch = global.fetch;
beforeEach(() => {
    rmSync("save.json", {
        force: true,
    });
    if ("mockClear" in global.fetch) {
        console.log("Clearing");
        (<any>global.fetch).mockClear();
    }
    console.log("running test.");
    global.fetch = oldFetch;
});
afterEach(() => {
    if ("mockClear" in global.fetch) {
        console.log("Clearing");
        (<any>global.fetch).mockClear();
    }
    console.log("done with test.");
    global.fetch = oldFetch;
});

describe("Simple Tree", () => {
    function simpleTree(
        perPage = 1,
        pages = 2,
        values = [3, 2],
        delay?: number,
    ): Tree<number> {
        // root -> first -> second
        const tree = new Tree<number>(
            (x, numb) =>
                new Parser().parse(`<${x}> <http://example.com/value> ${numb}.`),
            "http://example.com/value",
        );

        let prev = tree.root();

        for (let j = 0; j < pages; j++) {
            const first = tree.newFragment(delay);
            for (let i = 0; i < perPage; i++) {
                tree.fragment(first).addMember("a" + j + i, values[j * perPage + i]);
            }
            tree.fragment(prev).relation(first, "https://w3id.org/tree#relation");
            prev = first;
        }
        return tree;
    }

    test("ascending tree, emits ordered", async () => {
        const tree = simpleTree(1);
        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
            },
            "ascending",
        );

        const members = await read(client.stream());

        expect(members.length).toBe(2);
        expect(members.map((x) => x.timestamp)).toEqual(
            ["2", "3"].map((x) => new Date(x)),
        );
    });

    test("descending tree, emits ordered", async () => {
        const tree = simpleTree(1);

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
            },
            "descending",
        );

        const members = await read(client.stream());

        expect(members.length).toBe(2);
        expect(members.map((x) => x.timestamp)).toEqual(
            ["3", "2"].map((x) => new Date(x)),
        );
    });

    test("tree handles backpressure", async () => {
        const tree = simpleTree(
            2,
            6,
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            50,
        );

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
            },
            "none",
        );

        const stream = client.stream({ highWaterMark: 1, size: () => 1 });

        await new Promise((res) => setTimeout(res, 500));
        expect(tree.fetched.length).toEqual(5);

        const members = await read(stream);
        expect(members.length).toBe(12);
    });

    test("unordered tree, emits", async () => {
        const tree = simpleTree();

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
            },
            "none",
        );

        const members = await read(client.stream());

        expect(members.length).toBe(2);
        expect(members.map((x) => x.timestamp)).toEqual(
            ["3", "2"].map((x) => new Date(x)),
        );
    });
});

describe("more complex tree", () => {
    function simpleTree(): Tree<number> {
        // root (2) -GTE> first (3)
        //  |> second (2)
        const tree = new Tree<number>(
            (x, numb) =>
                new Parser().parse(`<${x}> <http://example.com/value> ${numb}.`),
            "http://example.com/value",
        );
        tree.fragment(tree.root()).addMember("a", 5);

        const first = tree.newFragment();
        tree.fragment(first).addMember("b", 3);
        tree
            .fragment(tree.root())
            .relation(
                first,
                TREE.GreaterThanOrEqualToRelation,
                "http://example.com/value",
                "3",
            );

        const second = tree.newFragment();
        tree.fragment(second).addMember("c", 2);
        tree.fragment(tree.root()).relation(second, TREE.relation);

        return tree;
    }

    test("tree handles backpressure", async () => {
        const tree = simpleTree();

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
            },
            "none",
        );

        const stream = client.stream({ highWaterMark: 1, size: () => 1 });

        await new Promise((res) => setTimeout(res, 500));
        console.log(tree.fetched);
        expect(tree.fetched.length).toEqual(5);

        const members = await read(stream);
        expect(members.length).toBe(3);
    });

    test("unordered tree, emits", async () => {
        const tree = simpleTree();

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
            },
            "none",
        );

        const members = await read(client.stream());
        expect(members.length).toBe(3);
    });

    test("ascending tree, emits ordered", async () => {
        const tree = simpleTree();

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
            },
            "ascending",
        );

        const members = await read(client.stream());

        expect(members.length).toBe(3);
        expect(members.map((x) => x.timestamp)).toEqual(
            ["2", "3", "5"].map((x) => new Date(x)),
        );
    });

    test("descending tree, emits ordered", async () => {
        const tree = simpleTree();

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
            },
            "descending",
        );

        const members = await read(client.stream());

        expect(members.length).toBe(3);
        expect(members.map((x) => x.timestamp)).toEqual(
            ["5", "3", "2"].map((x) => new Date(x)),
        );
    });

    test("ordered tree, emits asap", async () => {
        const tree = simpleTree();

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
            },
            "ascending",
        );

        const first = await client.stream().getReader().read();
        expect(first.done).toBe(false);
        expect(first.value?.timestamp).toEqual(new Date("2"));
    });

    test("Polling works, single page", async () => {
        // return;
        const tree = new Tree<number>(
            (x, numb) =>
                new Parser().parse(`<${x}> <http://example.com/value> ${numb}.`),
            "http://example.com/value",
        );
        tree.fragment(tree.root()).addMember("a", 5);
        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                polling: true,
                url: base,
            },
            "none",
        );

        let hasPolled: undefined | ((b: unknown) => void) = undefined;
        const polled = new Promise((res) => (hasPolled = res));

        let added = false;

        client.on("poll", () => {
            console.log("Poll cycle!");
            if (!added) {
                tree.fragment(tree.root()).addMember("b", 7);
                added = true;
                hasPolled!({});
            }
        });

        const reader = client.stream().getReader();

        const first = await reader.read();
        expect(first.done).toBe(false);
        expect(first.value?.timestamp).toEqual(new Date("5"));

        await polled;

        const second = await reader.read();
        expect(second.done).toBe(false);
        expect(second.value?.timestamp).toEqual(new Date("7"));

        await reader.cancel();
    });

    test("Polling works, single page - ordered", async () => {
        const tree = new Tree<number>(
            (x, numb) =>
                new Parser().parse(`<${x}> <http://example.com/value> ${numb}.`),
            "http://example.com/value",
        );
        tree.fragment(tree.root()).addMember("a", 5);
        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                polling: true,
                url: base,
            },
            "ascending",
        );

        let hasPolled: undefined | ((b: unknown) => void) = undefined;
        const polled = new Promise((res) => (hasPolled = res));

        let added = false;

        client.on("poll", () => {
            console.log("Poll cycle!");
            if (!added) {
                tree.fragment(tree.root()).addMember("b", 7);
                added = true;
                hasPolled!({});
            }
        });

        const reader = client.stream().getReader();

        const first = await reader.read();
        expect(first.done).toBe(false);
        expect(first.value?.timestamp).toEqual(new Date("5"));

        console.log("Awaiting promise");
        await polled;
        console.log("Promise resolved");

        const second = await reader.read();
        expect(second.done).toBe(false);
        expect(second.value?.timestamp).toEqual(new Date("7"));

        await reader.cancel();
    });

    test("Exponential backoff works", async () => {
        const tree = new Tree<number>(
            (x, numb) =>
                new Parser().parse(`<${x}> <http://example.com/value> ${numb}.`),
            "http://example.com/value",
        );
        tree.fragment(tree.root()).addMember("a", 5);
        const frag = tree.newFragment();
        tree.fragment(tree.root()).relation(frag, "https://w3id.org/tree#relation");
        tree.fragment(frag).setFailcount(2).addMember("b", 7);

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
                fetch: retry_fetch(fetch, {
                    codes: [408, 425, 429, 500, 502, 503, 504],
                    base: 100,
                    maxRetries: 5,
                }),
            },
            "none",
        );

        const members = await read(client.stream());
        expect(members.length).toBe(2);
    });

    test("Exponential backoff works, handle max retries", async () => {
        const tree = new Tree<number>(
            (x, numb) =>
                new Parser().parse(`<${x}> <http://example.com/value> ${numb}.`),
            "http://example.com/value",
        );
        tree.fragment(tree.root()).addMember("a", 5);
        const frag = tree.newFragment();
        tree.fragment(tree.root()).relation(frag, "https://w3id.org/tree#relation");
        tree.fragment(frag).setFailcount(5).addMember("b", 7);

        const base = tree.base() + tree.root();
        const mock = tree.mock();
        global.fetch = mock;

        const client = replicateLDES(
            {
                url: base,
                fetch: retry_fetch(fetch, {
                    codes: [408, 425, 429, 500, 502, 503, 504],
                    base: 100,
                    maxRetries: 5,
                }),
            },
            "none",
        );

        let errorCb = false;
        let thrown = false;

        client.on("error", () => (errorCb = true));
        try {
            await read(client.stream());
        } catch (ex) {
            thrown = true;
        }

        expect(thrown).toBeTruthy();
        expect(errorCb).toBeTruthy();
    });
});
