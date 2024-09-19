import { describe, expect, it } from "@jest/globals";
import { Range } from "../lib/condition";
import { TREE } from "@treecg/types";

const lessers = [
    new Range(5, TREE.LessThanOrEqualToRelation),
    new Range(5, TREE.LessThanRelation),
    new Range(4, TREE.LessThanOrEqualToRelation),
    new Range(4, TREE.GreaterThanOrEqualToRelation),
    new Range(3, TREE.GreaterThanOrEqualToRelation),
    new Range(3, TREE.GreaterThanRelation),

    new Range(4, TREE.EqualToRelation),
];

const not_lessers = [
    new Range(4, TREE.GreaterThanRelation),
    new Range(5, TREE.GreaterThanRelation),
    new Range(5, TREE.GreaterThanOrEqualToRelation),
    new Range(5, TREE.EqualToRelation),
];

const equals = [
    new Range(6, TREE.LessThanOrEqualToRelation),
    new Range(6, TREE.LessThanRelation),
    new Range(5, TREE.LessThanOrEqualToRelation),
    new Range(5, TREE.GreaterThanOrEqualToRelation),
    new Range(4, TREE.GreaterThanOrEqualToRelation),
    new Range(4, TREE.GreaterThanRelation),
    new Range(5, TREE.EqualToRelation),
];

const not_equals = [
    new Range(4, TREE.LessThanOrEqualToRelation),
    new Range(5, TREE.GreaterThanRelation),
    new Range(5, TREE.LessThanRelation),
    new Range(6, TREE.GreaterThanOrEqualToRelation),
    new Range(4, TREE.EqualToRelation),
    new Range(6, TREE.EqualToRelation),
];

const greaters = [
    new Range(7, TREE.LessThanRelation),
    new Range(7, TREE.LessThanOrEqualToRelation),
    new Range(6, TREE.LessThanOrEqualToRelation),
    new Range(6, TREE.GreaterThanOrEqualToRelation),
    new Range(5, TREE.GreaterThanOrEqualToRelation),
    new Range(5, TREE.GreaterThanRelation),

    new Range(6, TREE.EqualToRelation),
];

const not_greater = [
    new Range(6, TREE.LessThanRelation),
    new Range(5, TREE.LessThanRelation),
    new Range(5, TREE.LessThanOrEqualToRelation),
    new Range(5, TREE.EqualToRelation),
];

describe("contains", () => {
    lessers.forEach((x) =>
        it(`${x.toString()} contains 4}`, () => {
            expect(x.contains(4)).toBeTruthy();
        }),
    );
    equals.forEach((x) =>
        it(`${x.toString()} contains 5}`, () => {
            expect(x.contains(5)).toBeTruthy();
        }),
    );
    greaters.forEach((x) =>
        it(`${x.toString()} contains 6}`, () => {
            expect(x.contains(6)).toBeTruthy();
        }),
    );

    not_lessers.forEach((x) =>
        it(`${x.toString()} does not contain 4}`, () => {
            expect(x.contains(4)).toBeFalsy();
        }),
    );
    not_equals.forEach((x) =>
        it(`${x.toString()} does not contain 5}`, () => {
            expect(x.contains(5)).toBeFalsy();
        }),
    );
    not_greater.forEach((x) =>
        it(`${x.toString()} does not contain 6}`, () => {
            expect(x.contains(6)).toBeFalsy();
        }),
    );
});

describe("range", () => {
    describe("things 4 or less)", () => {
        const tests = [
            new Range(4, TREE.EqualToRelation),
            new Range(4, TREE.LessThanOrEqualToRelation),
        ];

        describe("overlaps", () => {
            lessers.forEach((x) => {
                tests.forEach((y) => {
                    it(`${x.toString()} overlaps ${y.toString()}`, () => {
                        expect(x.overlaps(y)).toBeTruthy();
                    });
                    it(`${y.toString()} overlaps ${x.toString()}`, () => {
                        expect(y.overlaps(x)).toBeTruthy();
                    });
                });
            });
        });
        describe("does not overlap", () => {
            not_lessers.forEach((x) => {
                tests.forEach((y) => {
                    it(`${x.toString()} not overlaps ${y.toString()}`, () => {
                        expect(x.overlaps(y)).toBeFalsy();
                    });
                    it(`${y.toString()} not overlaps ${x.toString()}`, () => {
                        expect(y.overlaps(x)).toBeFalsy();
                    });
                });
            });
        });
    });

    describe("things 6 or more)", () => {
        const tests = [
            new Range(6, TREE.EqualToRelation),
            new Range(6, TREE.GreaterThanOrEqualToRelation),
        ];

        describe("overlaps", () => {
            greaters.forEach((x) => {
                tests.forEach((y) => {
                    it(`${x.toString()} overlaps ${y.toString()}`, () => {
                        expect(x.overlaps(y)).toBeTruthy();
                    });
                    it(`${y.toString()} overlaps ${x.toString()}`, () => {
                        expect(y.overlaps(x)).toBeTruthy();
                    });
                });
            });
        });
        describe("does not overlap", () => {
            not_greater.forEach((x) => {
                tests.forEach((y) => {
                    it(`${x.toString()} not overlaps ${y.toString()}`, () => {
                        expect(x.overlaps(y)).toBeFalsy();
                    });
                    it(`${y.toString()} not overlaps ${x.toString()}`, () => {
                        expect(y.overlaps(x)).toBeFalsy();
                    });
                });
            });
        });
    });
});
