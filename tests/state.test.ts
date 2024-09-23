import { beforeEach, describe, expect, test } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { FileStateFactory } from "../lib/state";

const location = "save.json";
describe("State", () => {
    beforeEach(() => {
        rmSync(location, {
            force: true,
        });
    });
    test("correct chaining", () => {
        const factory = new FileStateFactory(location);

        const state = factory.build<number[]>(
            "test",
            JSON.stringify,
            JSON.parse,
            () => [],
        );

        expect(state.item.length).toBe(0);

        state.item.push(5);
        state.item.push(6);
        state.item.push(7);

        factory.write();

        const save = JSON.parse(readFileSync(location, { encoding: "utf8" }));

        expect(save).toEqual({ test: "[5,6,7]" });

        const factory2 = new FileStateFactory(location);

        const state2 = factory2.build<number[]>(
            "test",
            JSON.stringify,
            JSON.parse,
            () => [],
        );

        expect(state2.item.length).toBe(3);
        expect(state2.item).toEqual([5, 6, 7]);
    });
});
