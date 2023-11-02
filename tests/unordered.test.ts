import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { read, Tree } from "./helper";

import { replicateLDES } from "../lib/client";
import { intoConfig } from "../lib/config";
import { Parser, Writer } from "n3";
import { TREE } from "@treecg/types";

describe("Simple Tree", () => {
  function simpleTree(): Tree<number> {
    // root -> first -> second
    const tree = new Tree<number>(
      (x, numb) =>
        new Parser().parse(`<${x}> <http://example.com/value> ${numb}.`),
      "http://example.com/value",
    );

    const first = tree.newFragment();
    tree.fragment(first).addMember("a", 3);
    tree
      .fragment(tree.root())
      .relation(first, "https://w3id.org/tree#relation");

    const second = tree.newFragment();
    tree.fragment(second).addMember("b", 2);
    tree.fragment(first).relation(second, "https://w3id.org/tree#relation");
    return tree;
  }

  test("ordered tree, emits ordered", async () => {
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
      true,
    );

    const members = await read(client.stream());

    expect(members.length).toBe(2);
    expect(members.map((x) => x.timestamp)).toEqual(["2", "3"]);

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
      false,
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
      false,
    );

    const members = await read(client.stream());

    expect(members.length).toBe(3);

    mock.mockClear();
  });

  test("ordered tree, emits ordered", async () => {
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
      true,
    );

    const members = await read(client.stream());

    expect(members.length).toBe(3);

    console.log("members", members.map(x => x.timestamp))
    expect(members.map(x => x.timestamp)).toEqual(["2", "3", "5"])

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
      true,
    );

    const first = await client.stream().getReader().read();
    expect(first.done).toBe(false);
    expect(first.value?.timestamp).toBe("2");

    mock.mockClear();
  });
});
