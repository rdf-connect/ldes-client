import * as os from "os";
import { empty_condition as emptyCondition } from "./condition";

import type { NamedNode, Quad } from "@rdfjs/types";
import type { Condition } from "./condition";

export interface ShapeConfig {
    quads: Quad[];
    shapeId: NamedNode;
}

export interface Config {
    loose: boolean;
    polling: boolean;
    url: string;
    urlIsView: boolean;
    noShape: boolean;
    stateFile?: string;
    pollInterval?: number;
    condition: Condition;
    defaultTimezone: string;
    after?: Date;
    before?: Date;
    shape?: ShapeConfig;
    shapeFile?: string;
    onlyDefaultGraph?: boolean;
    materialize?: boolean;
    lastVersionOnly?: boolean;
    includeMetadata?: boolean;
    fetch?: typeof fetch;
    workers: number;
}

export interface WithTarget {
    target: object;
}

const defaultConfig: Config = {
    urlIsView: false,
    noShape: false,
    condition: emptyCondition(),
    loose: false,
    polling: false,
    url: "",
    defaultTimezone: "AoE",
    materialize: false,
    lastVersionOnly: false,
    includeMetadata: false,
    workers: os.cpus().length > 1 ? os.cpus().length - 1 : 1,
};


const defaultTarget: WithTarget = {
    target: {},
};

export async function getConfig(): Promise<Config & WithTarget> {
    return Object.assign({}, defaultConfig, defaultTarget);
}

export function intoConfig(config: Partial<Config>): Config {
    const cleanConfig = Object.fromEntries(
        Object.entries(config).filter(([_Readable, value]) => value !== undefined)
    );
    return Object.assign({}, defaultConfig, defaultTarget, cleanConfig);
}
