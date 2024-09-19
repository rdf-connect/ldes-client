import { Config, intoConfig } from "./config";
import { Member } from "./page";
import { rdfDereferencer, RdfDereferencer } from "rdf-dereference";
import { FileStateFactory, NoStateFactory, StateFactory } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { Writer as NWriter } from "n3";
import { Quad_Object, Term } from "@rdfjs/types";
import {
  enhanced_fetch,
  extractMainNodeShape,
  getObjects,
  ModulatorFactory,
  Notifier,
  streamToArray,
  maybeVersionMaterialize,
  handleConditions,
  processConditionFile,
} from "./utils";
import { LDES, SDS, TREE } from "@treecg/types";
import { FetchedPage, Fetcher, longPromise, resetPromise } from "./pageFetcher";
import { Manager } from "./memberManager";
import { OrderedStrategy, StrategyEvents, UnorderedStrategy } from "./strategy";
import debug from "debug";
import type { Writer } from "@rdfc/js-runner";

export { intoConfig } from "./config";
export { extractMainNodeShape, retry_fetch } from "./utils";
export {
  type Condition,
  empty_condition,
  parse_condition,
  Range,
} from "./condition/index";
export type { Member, Page, Relation } from "./page";
export type { Config, ShapeConfig } from "./config";

const log = debug("client");
const df = new DataFactory();

type Controller = ReadableStreamDefaultController<Member>;

export type Ordered = "ascending" | "descending" | "none";

export function replicateLDES(
  config: Partial<Config> & { url: string },
  ordered: Ordered = "none",
  dereferencer?: RdfDereferencer,
  streamId?: Term,
): Client {
  return new Client(intoConfig(config), ordered, dereferencer, streamId);
}

export type LDESInfo = {
  shape: Term;
  extractor: CBDShapeExtractor;
  timestampPath?: Term;
  isVersionOfPath?: Term;
};

async function getInfo(
  ldesId: Term,
  viewId: Term,
  store: RdfStore,
  dereferencer: RdfDereferencer,
  config: Config,
): Promise<LDESInfo> {
  const logger = log.extend("getShape");

  if (config.shapeFile) {
    const shapeId = config.shapeFile.startsWith("http")
      ? config.shapeFile
      : "file://" + config.shapeFile;

    const resp = await dereferencer.dereference(config.shapeFile, {
      localFiles: true,
      fetch: config.fetch,
    });
    const quads = await streamToArray(resp.data);
    config.shape = {
      quads: quads,
      shapeId: df.namedNode(shapeId),
    };
  }

  let shapeIds = config.noShape
    ? []
    : getObjects(store, ldesId, TREE.terms.shape);
  let timestampPaths = getObjects(store, ldesId, LDES.terms.timestampPath);
  let isVersionOfPaths = getObjects(store, ldesId, LDES.terms.versionOfPath);

  logger(
    "Found %d shapes, %d timestampPaths, %d isVersionOfPaths",
    shapeIds.length,
    timestampPaths.length,
    isVersionOfPaths.length,
  );

  if (
    !config.noShape &&
    (shapeIds.length === 0 ||
      timestampPaths.length === 0 ||
      isVersionOfPaths.length === 0)
  ) {
    try {
      logger("Maybe find more info at %s", viewId.value);
      const resp = await dereferencer.dereference(viewId.value, {
        localFiles: true,
        fetch: config.fetch,
      });
      store = RdfStore.createDefault();
      await new Promise((resolve, reject) => {
        store.import(resp.data).on("end", resolve).on("error", reject);
      });
      shapeIds = getObjects(store, null, TREE.terms.shape);
      timestampPaths = getObjects(store, null, LDES.terms.timestampPath);
      isVersionOfPaths = getObjects(store, null, LDES.terms.versionOfPath);
      logger(
        "Found %d shapes, %d timestampPaths, %d isVersionOfPaths",
        shapeIds.length,
        timestampPaths.length,
        isVersionOfPaths.length,
      );
    } catch (ex: any) { }
  }

  if (shapeIds.length > 1) {
    console.error("Expected at most one shape id, found " + shapeIds.length);
  }

  if (timestampPaths.length > 1) {
    console.error(
      "Expected at most one timestamp path, found " + timestampPaths.length,
    );
  }

  if (isVersionOfPaths.length > 1) {
    console.error(
      "Expected at most one versionOf path, found " + isVersionOfPaths.length,
    );
  }

  const shapeConfigStore = RdfStore.createDefault();
  if (config.shape) {
    for (const quad of config.shape.quads) {
      shapeConfigStore.addQuad(quad);
    }
    // Make sure the shapeId is as defined in the given shape file
    config.shape.shapeId = extractMainNodeShape(shapeConfigStore);
  }

  return {
    extractor: new CBDShapeExtractor(
      config.shape ? shapeConfigStore : store,
      dereferencer,
      {
        cbdDefaultGraph: config.onlyDefaultGraph,
        fetch: config.fetch,
      },
    ),
    shape: config.shape ? config.shape.shapeId : shapeIds[0],
    timestampPath: timestampPaths[0],
    isVersionOfPath: isVersionOfPaths[0],
  };
}

type EventMap = Record<string, any>;

type EventKey<T extends EventMap> = string & keyof T;
type EventReceiver<T> = (params: T) => void;

export type ClientEvents = {
  fragment: void;
  mutable: void;
  poll: void;
  error: any;
};

export class Client {
  private config: Config;
  private dereferencer: RdfDereferencer;

  private fetcher!: Fetcher;
  private memberManager!: Manager;
  private strategy!: OrderedStrategy | UnorderedStrategy;

  public streamId?: Term;
  private ordered: Ordered;

  private modulatorFactory: ModulatorFactory;

  private stateFactory: StateFactory;

  private listeners: {
    [K in keyof ClientEvents]?: Array<(p: ClientEvents[K]) => void>;
  } = {};

  constructor(
    config: Config,
    ordered: Ordered = "none",
    dereferencer?: RdfDereferencer,
    stream?: Term,
  ) {
    this.config = config;
    this.dereferencer = dereferencer ?? rdfDereferencer;

    this.streamId = stream;
    this.ordered = ordered;
    this.stateFactory = config.stateFile
      ? new FileStateFactory(config.stateFile)
      : new NoStateFactory();
    this.modulatorFactory = new ModulatorFactory(this.stateFactory);

    if (typeof process !== 'undefined') {
      process.on("SIGINT", () => {
        console.log("Caught interrupt signal, saving");
        this.stateFactory.write();
        process.exit();
      });
    }
  }

  on<K extends EventKey<ClientEvents>>(
    key: K,
    fn: EventReceiver<ClientEvents[K]>,
  ) {
    this.listeners[key] = (
      this.listeners[key] || <Array<(p: ClientEvents[K]) => void>>[]
    ).concat(fn);
  }

  private emit<K extends EventKey<ClientEvents>>(
    key: K,
    data: ClientEvents[K],
  ) {
    (this.listeners[key] || []).forEach(function (fn) {
      fn(data);
    });
  }

  async init(
    emit: (member: Member) => void,
    close: () => void,
    factory: ModulatorFactory,
  ): Promise<void> {
    const logger = log.extend("init");
    // Fetch the url
    const root = await fetchPage(
      this.config.url,
      this.dereferencer,
      this.config.fetch,
    );
    const ldesId: Term = df.namedNode(this.config.url);

    // TODO Choose a view
    const viewQuads = root.data.getQuads(null, TREE.terms.view, null, null);
    let viewId: Term = ldesId;

    if (!this.config.urlIsView) {
      if (viewQuads.length === 0) {
        console.error(
          "Did not find tree:view predicate, this is required to interpret the LDES",
        );
      } else {
        viewId = viewQuads[0].object;
      }
    }

    const info = await getInfo(
      ldesId,
      viewId,
      root.data,
      this.dereferencer,
      this.config,
    );

    // Build factory to keep track of the replication state
    const state = this.stateFactory.build<Set<string>>(
      "members",
      (set) => {
        const arr = [...set.values()];
        return JSON.stringify(arr);
      },
      (inp) => new Set(JSON.parse(inp)),
      () => new Set(),
    );

    // Build factory to keep track of member versions
    const versionState = this.config.lastVersionOnly ?
      this.stateFactory.build<Map<string, Date>>(
        "versions",
        (map) => {
          const arr = [...map.entries()];
          return JSON.stringify(arr);
        },
        (inp) => new Map(JSON.parse(inp)),
        () => new Map(),
      ) : undefined;

    this.streamId = this.streamId || viewQuads[0].subject;
    
    this.memberManager = new Manager(
      this.streamId || viewQuads[0].subject,
      state.item,
      info,
    );

    logger("timestampPath %o", !!info.timestampPath);

    if (this.ordered !== "none" && !info.timestampPath) {
      throw "Can only emit members in order, if LDES is configured with timestampPath";
    }

    // Handle and assemble condition object if needed
    this.config.condition = handleConditions(
        this.config.condition,
        this.config.before,
        this.config.after,
        info.timestampPath
    );

    this.fetcher = new Fetcher(
      this.dereferencer,
      this.config.loose,
      this.config.condition,
      this.config.fetch,
    );

    const notifier: Notifier<StrategyEvents, {}> = {
      error: (ex: any) => this.emit("error", ex),
      fragment: () => this.emit("fragment", undefined),
      member: (m) => {
        if (this.config.condition.matchMember(m)) {

          // Check if this is a newer version of this member (if we are extracting the last version only)
          if (m.isVersionOf && m.timestamp && versionState) {
            const versions = versionState.item;

            if (versions.has(m.isVersionOf)) {
              const registeredDate = <Date>versions.get(m.isVersionOf);
              if (<Date>m.timestamp > registeredDate) {
                // We got a newer version
                versions.set(m.isVersionOf, <Date>m.timestamp);
              } else {
                // This is an older version, so we ignore it
                return;
              }
            } else {
              // First time we see this member
              versions.set(m.isVersionOf, <Date>m.timestamp);
            }
          }
          // Check if versioned member is to be materialized
          emit(maybeVersionMaterialize(m, this.config.materialize === true, info));
        }
      },
      pollCycle: () => {
        this.emit("poll", undefined);
      },
      mutable: () => {
        this.emit("mutable", undefined);
      },
      close: () => {
        this.stateFactory.write();
        close();
      },
    };

    // Opt for descending order strategy if last version only is true, to start reading at the newest end.
    if (this.config.lastVersionOnly) this.ordered = "descending";

    this.strategy =
      this.ordered !== "none"
        ? new OrderedStrategy(
          this.memberManager,
          this.fetcher,
          notifier,
          factory,
          this.ordered,
          this.config.polling,
          this.config.pollInterval,
        )
        : new UnorderedStrategy(
          this.memberManager,
          this.fetcher,
          notifier,
          factory,
          this.config.polling,
          this.config.pollInterval,
        );

    logger("Found %d views, choosing %s", viewQuads.length, viewId.value);

    this.strategy.start(viewId.value);
  }

  stream(strategy?: {
    highWaterMark?: number;
    size?: (chunk: Member) => number;
  }): ReadableStream<Member> {
    const emitted = longPromise();
    const config: UnderlyingDefaultSource = {
      //
      // Called when starting the stream
      //
      start: async (controller: Controller) => {
        this.on("error", (error) => {
          this.stateFactory.write();
          this.memberManager.close();
          this.fetcher.close();
          controller.error(error);
        });

        this.modulatorFactory.pause();
        await this.init(
          (member) => {
            controller.enqueue(member);
            resetPromise(emitted);
          },
          () => controller.close(),
          this.modulatorFactory,
        );
      },

      //
      // Called when the internal buffer is not full
      //
      pull: async () => {
        resetPromise(emitted);
        this.modulatorFactory.unpause();
        await emitted.waiting;
        this.modulatorFactory.pause();
        return;
      },

      //
      // Called when canceled
      //
      cancel: async () => {
        log("Canceled");
        this.stateFactory.write();
        this.strategy.cancel();
        this.memberManager.close();
        this.fetcher.close();
      },
    };

    return new ReadableStream(config, strategy);
  }
}

async function fetchPage(
  location: string,
  dereferencer: RdfDereferencer,
  fetch_f?: typeof fetch,
): Promise<FetchedPage> {
  const resp = await dereferencer.dereference(location, {
    localFiles: true,
    fetch: fetch_f,
  });
  const url = resp.url;
  const data = RdfStore.createDefault();
  await new Promise((resolve, reject) => {
    data.import(resp.data).on("end", resolve).on("error", reject);
  });
  return <FetchedPage>{ url, data };
}

export async function processor(
  writer: Writer<string>,
  url: string,
  before?: Date,
  after?: Date,
  ordered?: string,
  follow?: boolean,
  pollInterval?: number,
  shape?: string,
  noShape?: boolean,
  save?: string,
  loose?: boolean,
  urlIsView?: boolean,
  verbose?: boolean,
  fetch_config?: {
    auth?: {
      type: "basic";
      auth: string;
      host: string;
    };
    concurrent?: number;
    retry?: {
      codes: number[];
      maxRetries: number;
    };
  },
  condition?: string,
  materialize?: boolean,
  lastVersionOnly?: boolean,
) {
  if (fetch_config?.auth) {
    fetch_config.auth.host = new URL(url).host;
  }
  const client = replicateLDES(
    {
      loose,
      noShape,
      shapeFile: shape,
      polling: follow,
      url: url,
      stateFile: save,
      pollInterval: pollInterval,
      urlIsView,
      after,
      before,
      fetch: fetch_config ? enhanced_fetch(fetch_config) : fetch,
      materialize,
      lastVersionOnly,
      condition: await processConditionFile(condition)
    },
    <Ordered>ordered || "none",
  );

  if (verbose) {
    client.on("fragment", () => console.error("Fragment!"));
  }

  return async () => {
    const reader = client.stream({ highWaterMark: 10 }).getReader();
    let el = await reader.read();
    const seen = new Set();
    while (el) {
      if (el.value) {
        seen.add(el.value.id);

        if (verbose) {
          if (seen.size % 100 == 1) {
            console.error(
              "Got member",
              seen.size,
              "with",
              el.value.quads.length,
              "quads",
            );
          }
        }

        const blank = df.blankNode();
        const quads = el.value.quads.slice();
        quads.push(
          df.quad(blank, SDS.terms.stream, <Quad_Object>client.streamId!, SDS.terms.custom("DataDescription")),
          df.quad(blank, SDS.terms.payload, <Quad_Object>el.value.id!, SDS.terms.custom("DataDescription")),
        );

        await writer.push(new NWriter().quadsToString(quads));
      }

      if (el.done) {
        break;
      }

      el = await reader.read();
    }

    if (verbose) {
      console.error("Found", seen.size, "members");
    }
  };
}
