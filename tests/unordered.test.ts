import { describe, expect, test } from "@jest/globals";
import { read, Tree } from "./helper";

import { replicateLDES } from "../lib/client";
import { intoConfig } from "../lib/config";
import { Parser } from "n3";
import { TREE } from "@treecg/types";

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
      intoConfig({
        url: base,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
      }),
      undefined,
      undefined,
      "ascending",
    );

    const members = await read(client.stream());

    expect(members.length).toBe(2);
    expect(members.map((x) => x.timestamp)).toEqual(["2", "3"]);

    mock.mockClear();
  });
  test("descending tree, emits ordered", async () => {
    const tree = simpleTree(1);

    const base = tree.base() + tree.root();
    const mock = tree.mock();
    global.fetch = mock;

    const client = replicateLDES(
      intoConfig({
        url: base,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
      }),
      undefined,
      undefined,
      "descending",
    );

    const members = await read(client.stream());

    expect(members.length).toBe(2);
    expect(members.map((x) => x.timestamp)).toEqual(["3", "2"]);

    mock.mockClear();
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
      intoConfig({
        url: base,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
      }),
      undefined,
      undefined,
      "none",
    );

    const stream = client.stream({ highWaterMark: 1, size: () => 1 });

    await new Promise((res) => setTimeout(res, 500));
    expect(tree.fetched.length).toEqual(5);

    const members = await read(stream);

    expect(members.length).toBe(12);

    mock.mockClear();
  });

  test("unordered tree, emits", async () => {
    const tree = simpleTree();

    const base = tree.base() + tree.root();
    const mock = tree.mock();
    global.fetch = mock;

    const client = replicateLDES(
      intoConfig({
        url: base,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
      }),
      undefined,
      undefined,
      "none",
    );

    const members = await read(client.stream());

    expect(members.length).toBe(2);
    expect(members.map((x) => x.timestamp)).toEqual(["3", "2"]);

    mock.mockClear();
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
        TREE.GreaterThanOrEqualRelation,
        "http://example.com/value",
        "3",
      );

    const second = tree.newFragment();
    tree.fragment(second).addMember("c", 2);
    tree.fragment(tree.root()).relation(second, TREE.relation);

    return tree;
  }

  test("unordered tree, emits", async () => {
    const tree = simpleTree();

    const base = tree.base() + tree.root();
    const mock = tree.mock();
    global.fetch = mock;

    const client = replicateLDES(
      intoConfig({
        url: base,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
      }),
      undefined,
      undefined,
      "none",
    );

    const members = await read(client.stream());
    expect(members.length).toBe(3);

    mock.mockClear();
  });

  test("ascending tree, emits ordered", async () => {
    const tree = simpleTree();

    const base = tree.base() + tree.root();
    const mock = tree.mock();
    global.fetch = mock;

    const client = replicateLDES(
      intoConfig({
        url: base,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
      }),
      undefined,
      undefined,
      "ascending",
    );

    const members = await read(client.stream());

    expect(members.length).toBe(3);
    expect(members.map((x) => x.timestamp)).toEqual(["2", "3", "5"]);

    mock.mockClear();
  });

  test("descending tree, emits ordered", async () => {
    const tree = simpleTree();

    const base = tree.base() + tree.root();
    const mock = tree.mock();
    global.fetch = mock;

    const client = replicateLDES(
      intoConfig({
        url: base,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
      }),
      undefined,
      undefined,
      "descending",
    );

    const members = await read(client.stream());

    expect(members.length).toBe(3);
    expect(members.map((x) => x.timestamp)).toEqual(["5", "3", "2"]);

    mock.mockClear();
  });

  test("ordered tree, emits asap", async () => {
    const tree = simpleTree();

    const base = tree.base() + tree.root();
    const mock = tree.mock();
    global.fetch = mock;

    const client = replicateLDES(
      intoConfig({
        url: base,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
      }),
      undefined,
      undefined,
      "ascending",
    );

    const first = await client.stream().getReader().read();
    expect(first.done).toBe(false);
    expect(first.value?.timestamp).toBe("2");

    mock.mockClear();
  });
});
