import { NamedNode, Quad } from "@rdfjs/types";
import { DefaultFetcherConfig, FetcherConfig } from "./pageFetcher";
import { retry_fetch } from "./utils";

export interface ShapeConfig {
  quads: Quad[];
  shapeId: NamedNode;
}

export interface MediatorConfig {
  maxRequests: number;
  maxMembers: number;
}

const defaultMediatorConfig = {
  maxRequests: 10,
  maxMembers: 100,
};

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
  fetch?: typeof fetch;
  // Add flag to indicate in order (default true)
  // Make sure that slower pages to first emit the first members
  //
  // Maybe we can go faster if we only emit the latests timestamp path members (maybe per version id)
}

export interface WithTarget {
  target: Object;
}

const defaultConfig: Config = {
  urlIsView: false,
  noShape: false,
  loose: false,
  polling: false,
  follow: false,
  url: "",
  pollInterval: 200,
  fetcher: DefaultFetcherConfig,
  mediator: defaultMediatorConfig,
};

const defaultTarget: WithTarget = {
  target: {},
};

export async function getConfig(): Promise<Config & WithTarget> {
  // TODO: Get config from params
  const extracted = {};
  // TODO: Better merging of configs
  return Object.assign({}, defaultConfig, defaultTarget, extracted);
}

export function intoConfig(config: Partial<Config>): Config {
  if (!config.fetch) {
    config.fetch = retry_fetch(fetch, [408, 425, 429, 500, 502, 503, 504]);
  }

  return Object.assign({}, defaultConfig, defaultTarget, config);
}
