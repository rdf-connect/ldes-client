import { NamedNode, Quad, Stream, Term } from "@rdfjs/types";
import { BaseQuad } from "n3";
import { StateFactory, StateT } from "./state";
import { RdfStore } from "rdf-stores";
import { RDF, SHACL } from "@treecg/types";
import debug from "debug";
import { Member } from "./page";

export type Notifier<Events, S> = {
  [K in keyof Events]: (event: Events[K], state: S) => void;
};

export function getSubjects(
  store: RdfStore,
  predicate: Term | null,
  object: Term | null,
  graph?: Term | null,
) {
  return store.getQuads(null, predicate, object, graph).map((quad) => {
    return quad.subject;
  });
}

export function getObjects(
  store: RdfStore,
  subject: Term | null,
  predicate: Term | null,
  graph?: Term | null,
) {
  return store.getQuads(subject, predicate, null, graph).map((quad) => {
    return quad.object;
  });
}

export function readableToArray<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  const reader = stream.getReader();
  return new Promise(async (res, rej) => {
    let obj = await reader.read().catch(rej);
    while (obj) {
      if (obj.done) {
        res(out);
        break;
      }
      if (obj.value) out.push(obj.value);
      obj = await reader.read().catch(rej);
    }
  });
}

/**
 * Converts a stream to an array, pushing all elements to an array
 * Resolving the promise with the 'end' event
 */
export function streamToArray<T extends BaseQuad>(
  stream: Stream<T>,
): Promise<T[]> {
  const out: T[] = [];
  return new Promise(async (res, rej) => {
    stream.on("end", () => res(out));
    stream.on("data", (x) => {
      out.push(x);
    });
    stream.on("error", (ex) => {
      console.error("Stream to Array failed");
      rej(ex);
    });
  });
}

/**
 * Find the main sh:NodeShape subject of a given Shape Graph.
 * We determine this by assuming that the main node shape
 * is not referenced by any other shape description.
 * If more than one is found an exception is thrown.
 */
export function extractMainNodeShape(store: RdfStore): NamedNode {
  const nodeShapes = getSubjects(
    store,
    RDF.terms.type,
    SHACL.terms.NodeShape,
    null,
  );
  let mainNodeShape = null;

  if (nodeShapes && nodeShapes.length > 0) {
    for (const ns of nodeShapes) {
      const isNotReferenced = getSubjects(store, null, ns, null).length === 0;

      if (isNotReferenced) {
        if (!mainNodeShape) {
          mainNodeShape = ns;
        } else {
          throw new Error(
            "There are multiple main node shapes in a given shape graph. Unrelated shapes must be given as separate shape graphs",
          );
        }
      }
    }
    if (mainNodeShape) {
      return <NamedNode>mainNodeShape;
    } else {
      throw new Error("No main SHACL Node Shapes found in given shape graph");
    }
  } else {
    throw new Error("No SHACL Node Shapes found in given shape graph");
  }
}

/**
 * Generic interface that represents a structure that ranks elements.
 * Most common is a Prority Queue (heap like) the pops elements in order.
 * An array is also a Ranker, without ordering.
 */
export interface Ranker<T> {
  push(item: T): void;
  pop(): T | undefined;
}

export type ModulartorEvents<T> = {
  ready: Indexed<T>;
};

/**
 * Factory that creates Modulator's
 * This is a factory to keep track whether or not the Modulator should be paused or not.
 */
export class ModulatorFactory {
  concurrent = 10;
  paused: boolean = false;

  factory: StateFactory;
  children: ModulatorInstance<any>[] = [];

  constructor(stateFactory: StateFactory, concurrent?: number) {
    this.factory = stateFactory;
    if (concurrent) {
      this.concurrent = concurrent;
    }
  }

  /**
   * Note: `T` should be plain javascript objects (because that how state is saved)
   */
  create<T>(
    name: string,
    ranker: Ranker<Indexed<T>>,
    notifier: Notifier<ModulartorEvents<T>, {}>,
    parse?: (item: any) => T,
  ): Modulator<T> {
    const state = this.factory.build<ModulatorInstanceState<T>>(
      name,
      JSON.stringify,
      JSON.parse,
      () => ({
        todo: [],
        inflight: [],
      }),
    );

    if (parse) {
      state.item.todo = state.item.todo.map(({ item, index }) => ({
        index,
        item: parse(item),
      }));
      state.item.inflight = state.item.inflight.map(({ item, index }) => ({
        index,
        item: parse(item),
      }));
    }

    const modulator = new ModulatorInstance(state, ranker, notifier, this);
    this.children.push(modulator);
    return modulator;
  }

  pause() {
    this.paused = true;
  }

  unpause() {
    this.paused = false;
    this.children.forEach((x) => x.checkReady());
  }
}

/**
 * Modulator is a structure that only buffers elements and only handles elements
 * when the factory is not paused and when not too many items are active at once.
 */
export interface Modulator<T> {
  push(item: T): void;
  finished(index: number): void;
  length(): number;
}

type Indexed<T> = {
  item: T;
  index: number;
};

type ModulatorInstanceState<T> = {
  todo: Indexed<T>[];
  inflight: Indexed<T>[];
};

class ModulatorInstance<T> implements Modulator<T> {
  at: number = 0;
  index = 0;

  private state: StateT<ModulatorInstanceState<T>>;

  private ranker: Ranker<Indexed<T>>;
  private notifier: Notifier<ModulartorEvents<T>, {}>;
  private factory: ModulatorFactory;

  constructor(
    state: StateT<ModulatorInstanceState<T>>,
    ranker: Ranker<Indexed<T>>,
    notifier: Notifier<ModulartorEvents<T>, {}>,
    factory: ModulatorFactory,
  ) {
    this.state = state;
    const readd = [...this.state.item.todo, ...this.state.item.inflight];
    this.state.item.todo.push(...this.state.item.inflight);
    while (this.state.item.inflight.pop()) {}
    while (this.state.item.todo.pop()) {}
    this.ranker = ranker;
    this.notifier = notifier;
    this.factory = factory;
    for (let item of readd) {
      this.push(item.item);
    }
  }

  length(): number {
    return this.state.item.todo.length;
  }

  push(item: T) {
    const indexed = { item, index: this.index };
    this.state.item.todo.push(indexed);
    this.index += 1;
    this.ranker.push(indexed);
    this.checkReady();
  }

  finished(index: number) {
    const removeIdx = this.state.item.inflight.findIndex(
      (x) => x.index == index,
    );
    if (removeIdx >= 0) {
      this.state.item.inflight.splice(removeIdx, 1);
    } else {
      console.error("Expected to be able to remove inflight item");
    }

    this.at -= 1;
    this.checkReady();
  }

  checkReady() {
    if (this.factory.paused) {
      return;
    }

    while (this.at < this.factory.concurrent) {
      const item = this.ranker.pop();
      if (item) {
        // This item is no longer todo
        // I'm quite afraid to use filter for this
        const removeIdx = this.state.item.todo.findIndex(
          (x) => x.index == item.index,
        );
        if (removeIdx >= 0) {
          this.state.item.todo.splice(removeIdx, 1);
        } else {
          console.error("Expected to be able to remove inflight item");
        }

        // This item is now inflight
        this.state.item.inflight.push(item);

        this.at += 1;
        this.notifier.ready(item, {});
      } else {
        break;
      }
    }
  }
}

function urlToUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string") {
    return new URL(input);
  } else if (input instanceof URL) {
    return input;
  } else if (input instanceof Request) {
    return new URL(input.url);
  } else {
    throw "Not a real url";
  }
}

const log = debug("fetch");

export type AuthConfig = {
  type: "basic";
  auth: string;
  host: string;
};

export type RetryConfig = {
  codes: number[];
  base: number;
  maxRetries: number;
};

export type FetchConfig = {
  auth?: AuthConfig;
  concurrent?: number;
  retry?: Partial<RetryConfig>;
};

export function enhanced_fetch(
  config: FetchConfig,
  start?: typeof fetch,
): typeof fetch {
  const fetch_f = config.auth
    ? handle_basic_auth(start || fetch, config.auth)
    : fetch;
  return limit_fetch_per_domain(
    retry_fetch(fetch_f, config.retry || {}),
    config.concurrent,
  );
}

export function limit_fetch_per_domain(
  fetch_f: typeof fetch,
  concurrent: number = 10,
): typeof fetch {
  const logger = log.extend("limit");
  const domain_dict: { [domain: string]: Array<(value: void) => void> } = {};

  const out: typeof fetch = async (input, init) => {
    let url: URL = urlToUrl(input);
    const domain = url.origin;

    if (!(domain in domain_dict)) {
      domain_dict[domain] = [];
    }

    const requests = domain_dict[domain];
    await new Promise((res) => {
      logger("%s capacity %d/%d", domain, requests.length, concurrent);
      if (requests.length < concurrent) {
        requests.push(res);
        res({});
      } else {
        requests.push(res);
      }
    });
    const resp = await fetch_f(input, init);

    requests.shift();
    for (let i = 0; i < concurrent; i++) {
      if (requests[i]) {
        requests[i]();
      }
    }

    return resp;
  };

  return out;
}

export function handle_basic_auth(
  fetch_f: typeof fetch,
  config: AuthConfig,
): typeof fetch {
  const logger = log.extend("auth");
  let authRequired = false;

  const basicAuthValue = `Basic ${Buffer.from(config.auth).toString("base64")}`;
  const setHeader = (init?: RequestInit): RequestInit => {
    const reqInit = init || {};
    const headers = new Headers(reqInit.headers);
    headers.set("Authorization", basicAuthValue);
    reqInit.headers = headers;
    return reqInit;
  };

  const auth_f: typeof fetch = async (input, init) => {
    let url: URL = urlToUrl(input);
    if (authRequired && url.host === config.host) {
      return await fetch_f(input, setHeader(init));
    }

    const resp = await fetch_f(input, init);
    if (resp.status === 401) {
      logger("Unauthorized, adding basic auth");
      if (url.host === config.host) {
        authRequired = true;
        return await fetch_f(input, setHeader(init));
      }
    }

    return resp;
  };

  return auth_f;
}

export function retry_fetch(
  fetch_f: typeof fetch,
  partial_config: Partial<RetryConfig>,
): typeof fetch {
  const config: RetryConfig = Object.assign(
    {
      codes: [408, 425, 429, 500, 502, 503, 504],
      base: 500,
      maxRetries: 5,
    },
    partial_config,
  );

  const logger = log.extend("retry");
  const retry: typeof fetch = async (input, init) => {
    let tryCount = 0;
    let retryTime = config.maxRetries;
    while (config.maxRetries == 0 || tryCount < config.maxRetries) {
      const resp = await fetch_f(input, init);
      if (!resp.ok) {
        if (config.codes.some((x) => x == resp.status)) {
          logger("Retry %s %d/%d", input, tryCount, config.maxRetries);
          // Wait 500ms, 1 second, 2 seconds, 4 seconds, 8 seconds, fail
          tryCount += 1;
          await new Promise((res) => setTimeout(res, retryTime));
          retryTime *= 2;
          continue;
        }
        return resp;
      }
      return resp;
    }

    throw `Max retries exceeded (${config.maxRetries})`;
  };

  return retry;
}

export function memberFromQuads(
  member: Term,
  quads: Quad[],
  timestampPath: Term | undefined,
  isVersionOfPath: Term | undefined,
): Member {
  // Get timestamp
  let timestamp: string | Date | undefined;
  if (timestampPath) {
    const ts = quads.find(
      (x) => x.subject.equals(member) && x.predicate.equals(timestampPath)
    )?.object.value;
    if (ts) {
      try {
        timestamp = new Date(ts);
      } catch (ex: any) {
        timestamp = ts;
      }
    }
  }

  // Get isVersionof
  let isVersionOf: string | undefined;
  if (isVersionOfPath) {
    isVersionOf = quads.find(
      (x) => x.subject.equals(member) && x.predicate.equals(isVersionOfPath)
    )?.object.value;
  }

  // Get type
  let type: Term | undefined;
  type = quads.find(
    (x) => x.subject.equals(member) && x.predicate.value === RDF.type
  )?.object;
  return { quads, id: member, isVersionOf, timestamp, type };
}
