import { describe, expect, test } from "@jest/globals";
import { RelationChain, SimpleRelation } from "../lib/relation";

describe("Chain relations", () => {
  test("correct chaining", () => {
    let chain = new RelationChain("");
    chain = chain.push("", { value: 0, important: false });

    expect(chain.relations.length).toBe(1);
    chain = chain.push("", { value: 0, important: false });
    expect(chain.relations.length).toBe(1);
    expect(chain.relations[0]).toEqual({ important: false, value: 0 });

    chain = chain.push("", { value: 1, important: true });
    expect(chain.relations.length).toBe(1);
    expect(chain.relations[0]).toEqual({ important: true, value: 1 });

    chain = chain.push("", { value: 2, important: true });
    expect(chain.relations.length).toBe(1);
    expect(chain.relations[0]).toEqual({ important: true, value: 1 });

    chain = chain.push("", { value: 2, important: false });
    expect(chain.relations.length).toBe(2);
    expect(chain.relations[0]).toEqual({ important: true, value: 1 });
    expect(chain.relations[1]).toEqual({ important: false, value: 2 });

    chain = chain.push("", { value: 2, important: false });
    expect(chain.relations.length).toBe(2);
    expect(chain.relations[0]).toEqual({ important: true, value: 1 });
    expect(chain.relations[1]).toEqual({ important: false, value: 2 });

    chain = chain.push("", { value: 2, important: true });
    expect(chain.relations.length).toBe(1);
  });

  test("correct chaining with ord", () => {
    let chain = new RelationChain("", [], undefined, (a, b) =>
      a < b ? 1 : -1,
    );
    chain = chain.push("", { value: 0, important: false });

    expect(chain.relations.length).toBe(1);
    chain = chain.push("", { value: 0, important: false });
    expect(chain.relations.length).toBe(1);
    expect(chain.relations[0]).toEqual({ important: false, value: 0 });

    chain = chain.push("", { value: 1, important: true });
    expect(chain.relations.length).toBe(1);
    expect(chain.relations[0]).toEqual({ important: true, value: 1 });

    chain = chain.push("", { value: 2, important: true });
    expect(chain.relations.length).toBe(1);
    expect(chain.relations[0]).toEqual({ important: true, value: 2 });

    chain = chain.push("", { value: 2, important: false });
    expect(chain.relations.length).toBe(2);
    expect(chain.relations[0]).toEqual({ important: true, value: 2 });
    expect(chain.relations[1]).toEqual({ important: false, value: 2 });

    chain = chain.push("", { value: 2, important: false });
    expect(chain.relations.length).toBe(2);
    expect(chain.relations[0]).toEqual({ important: true, value: 2 });
    expect(chain.relations[1]).toEqual({ important: false, value: 2 });

    chain = chain.push("", { value: 2, important: true });
    expect(chain.relations.length).toBe(1);
  });

  test("correct ordering", () => {
    let value1 = new RelationChain("").push("", { value: 0, important: false });
    let value2 = new RelationChain("").push("", { value: 0, important: true });

    // unimportant should be handled first!
    expect(value1.ordering(value2)).toBe(-1);
    expect(value2.ordering(value1)).toBe(1);

    value1 = new RelationChain("").push("", { value: 0, important: false });
    value2 = new RelationChain("")
      .push("", { value: 0, important: true })
      .push("", {
        value: 1,
        important: false,
      });
    // unimportant should be handled first!
    expect(value1.ordering(value2)).toBe(-1);
    expect(value2.ordering(value1)).toBe(1);

    value1 = new RelationChain("").push("", { value: 0, important: false });
    value2 = new RelationChain("")
      .push("", { value: 0, important: false })
      .push("", {
        value: 1,
        important: false,
      });

    // both are not important so they are not ordered
    expect(value1.ordering(value2)).toBe(0);
    expect(value2.ordering(value1)).toBe(0);

    value1 = new RelationChain("").push("", { value: 0, important: true });
    value2 = new RelationChain("").push("", { value: 10, important: true });

    // both are imporant, smallest value first
    expect(value1.ordering(value2)).toBe(-1);
    expect(value2.ordering(value1)).toBe(1);

    value1 = new RelationChain("")
      .push("", { value: 0, important: true })
      .push({
        value: 0,
        important: false,
      });
    value2 = new RelationChain("").push("", { value: 0, important: true });

    expect(value1.ordering(value2)).toBe(0);
    expect(value2.ordering(value1)).toBe(0);
  });

  test("correct ordering with ord", () => {
    const params: [
      SimpleRelation[],
      SimpleRelation | undefined,
      (a: any, b: any) => number,
    ] = [[], undefined, (a: any, b: any) => (a == b ? 0 : a < b ? 1 : -1)];

    let value1 = new RelationChain("", ...params).push("", {
      value: 0,
      important: false,
    });
    let value2 = new RelationChain("", ...params).push("", {
      value: 0,
      important: true,
    });

    // unimportant should be handled first!
    expect(value1.ordering(value2)).toBe(-1);
    expect(value2.ordering(value1)).toBe(1);

    value1 = new RelationChain("", ...params).push("", {
      value: 0,
      important: false,
    });
    value2 = new RelationChain("", ...params)
      .push("", { value: 0, important: true })
      .push("", {
        value: 1,
        important: false,
      });
    // unimportant should be handled first!
    expect(value1.ordering(value2)).toBe(-1);
    expect(value2.ordering(value1)).toBe(1);

    value1 = new RelationChain("", ...params).push("", {
      value: 0,
      important: false,
    });
    value2 = new RelationChain("", ...params).push("", {
      value: 1,
      important: false,
    });

    // both are not important so they are not ordered
    expect(value1.ordering(value2)).toBe(0);
    expect(value2.ordering(value1)).toBe(0);

    value1 = new RelationChain("", ...params).push("", {
      value: 0,
      important: true,
    });
    value2 = new RelationChain("", ...params).push("", {
      value: 10,
      important: true,
    });

    // both are imporant, smallest value first
    expect(value1.ordering(value2)).toBe(1);
    expect(value2.ordering(value1)).toBe(-1);

    value1 = new RelationChain("", ...params)
      .push("", { value: 0, important: true })
      .push("", {
        value: 0,
        important: false,
      });
    value2 = new RelationChain("", ...params).push("", {
      value: 0,
      important: true,
    });

    expect(value1.ordering(value2)).toBe(0);
    expect(value2.ordering(value1)).toBe(0);
  });
});
