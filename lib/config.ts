import { NamedNode, Quad } from "@rdfjs/types";
import { DefaultFetcherConfig, FetcherConfig } from "./pageFetcher";

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
  stateFile?: string;
  pollInterval: number;
  mediator: MediatorConfig;
  fetcher: FetcherConfig;
  before?: Date;
  after?: Date;
  shape?: ShapeConfig;

  // Add flag to indicate in order (default true)
  // Make sure that slower pages to first emit the first members
  //
  // Maybe we can go faster if we only emit the latests timestamp path members (maybe per version id)
}

export interface WithTarget {
  target: Object;
}

const defaultConfig: Config = {
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
  return Object.assign({}, defaultConfig, defaultTarget, config);
}
