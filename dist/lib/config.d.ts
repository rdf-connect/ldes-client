import { NamedNode, Quad } from "@rdfjs/types";
import { FetcherConfig } from "./pageFetcher";
export interface ShapeConfig {
    quads: Quad[];
    shapeId: NamedNode;
}
export interface MediatorConfig {
    maxRequests: number;
    maxMembers: number;
}
export interface Config {
    loose: boolean;
    polling: boolean;
    follow: boolean;
    url: string;
    urlIsView: boolean;
    noShape: boolean;
    stateFile?: string;
    pollInterval: number;
    mediator: MediatorConfig;
    fetcher: FetcherConfig;
    before?: Date;
    after?: Date;
    shapes?: ShapeConfig[];
    shapeFiles?: string[];
    onlyDefaultGraph?: boolean;
    materialize?: boolean;
    lastVersionOnly?: boolean;
}
export interface WithTarget {
    target: Object;
}
export declare function getConfig(): Promise<Config & WithTarget>;
export declare function intoConfig(config: Partial<Config>): Config;
