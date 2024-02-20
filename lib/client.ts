import { Config } from "./config";
import { Member } from "./page";
import rdfDereference, { RdfDereferencer } from "rdf-dereference";
import { FileStateFactory, NoStateFactory, State, StateFactory } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { DataFactory } from "n3";
import { RdfStore } from "rdf-stores";
import { Term } from "@rdfjs/types";
import { ModulatorFactory, Notifier, streamToArray } from "./utils";
import { LDES, TREE } from "@treecg/types";
import { FetchedPage, Fetcher, longPromise, resetPromise } from "./pageFetcher";
import { Manager } from "./memberManager";
import { OrderedStrategy, StrategyEvents, UnorderedStrategy } from "./strategy";
export { intoConfig } from "./config";
export type { Member, Page, Relation } from "./page";
export type { Config, MediatorConfig, ShapeConfig } from "./config";

import debug from "debug";
const log = debug("client");
const { namedNode } = DataFactory;

type Controller = ReadableStreamDefaultController<Member>;

export type Ordered = "ascending" | "descending" | "none";

const getSubjects = function (store: RdfStore, predicate: Term|null, object: Term|null, graph?:Term|null) {
  return store.getQuads(null, predicate, object, graph).map((quad) => {
    return quad.subject;
  });
}

const getObjects = function (store: RdfStore, subject:Term|null, predicate: Term|null, graph?:Term|null) {
  return store.getQuads(subject, predicate, null, graph).map((quad) => {
    return quad.object;
  });
}

export function replicateLDES(
  config: Config,
  states: {
    membersState?: State;
    fragmentState?: State;
    dereferencer?: RdfDereferencer;
  } = {},
  streamId?: Term,
  ordered: Ordered = "none",
): Client {
  return new Client(config, states, streamId, ordered);
}

export type LDESInfo = {
  shape?: Term;
  extractor: CBDShapeExtractor;
  timestampPath?: Term;
  isVersionOfPath?: Term;
};

async function getInfo(
  ldesId: Term,
  store: RdfStore,
  dereferencer: RdfDereferencer,
  noShape: boolean,
): Promise<LDESInfo> {
  const logger = log.extend("getShape");

  let shapeIds = noShape
    ? []
    : getObjects(store, ldesId, TREE.terms.shape);
  let timestampPaths = getObjects(store,ldesId, LDES.terms.timestampPath);
  let isVersionOfPaths = getObjects(store,
    ldesId,
    LDES.terms.versionOfPath,
  );

  logger(
    "Found %d shapes, %d timestampPaths, %d isVersionOfPaths",
    shapeIds.length,
    timestampPaths.length,
    isVersionOfPaths.length,
  );

  if (
    !noShape &&
    (shapeIds.length === 0 ||
      timestampPaths.length === 0 ||
      isVersionOfPaths.length === 0)
  ) {
    try {
      logger("Maybe find more info at %s", ldesId.value);
      const resp = await dereferencer.dereference(ldesId.value, {
        localFiles: true,
      });
      store = RdfStore.createDefault();
      await new Promise((resolve, reject) => {
        store.import(resp.data).on("end", resolve).on("error", reject);
      });
      shapeIds = getObjects(store, null, TREE.terms.shape);
      timestampPaths = getObjects(store, null, LDES.terms.timestampPath);
      isVersionOfPaths = getObjects(store,null, LDES.terms.versionOfPath);
      logger(
        "Found %d shapes, %d timestampPaths, %d isVersionOfPaths",
        shapeIds.length,
        timestampPaths.length,
        isVersionOfPaths.length,
      );
    } catch (ex: any) {}
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

  return {
    extractor: new CBDShapeExtractor(store, dereferencer, {
      cbdDefaultGraph: true,
    }),
    shape: shapeIds[0],
    timestampPath: timestampPaths[0],
    isVersionOfPath: isVersionOfPaths[0],
  };
}

type EventMap = Record<string, any>;

type EventKey<T extends EventMap> = string & keyof T;
type EventReceiver<T> = (params: T) => void;

export type ClientEvents = {
  fragment: void;
  poll: void;
};

export class Client {
  private config: Config;
  private dereferencer: RdfDereferencer;

  private fetcher!: Fetcher;
  private memberManager!: Manager;
  private strategy!: OrderedStrategy | UnorderedStrategy;

  private streamId?: Term;
  private ordered: Ordered;

  private modulatorFactory;

  private pollCycle: (() => void)[] = [];
  private stateFactory: StateFactory;

  private listeners: {
    [K in keyof ClientEvents]?: Array<(p: ClientEvents[K]) => void>;
  } = {};

  constructor(
    config: Config,
    {
      dereferencer,
    }: {
      membersState?: State;
      fragmentState?: State;
      dereferencer?: RdfDereferencer;
    } = {},
    stream?: Term,
    ordered: Ordered = "none",
  ) {
    this.config = config;
    this.dereferencer = dereferencer ?? rdfDereference;

    this.streamId = stream;
    this.ordered = ordered;
    this.stateFactory = config.stateFile
      ? new FileStateFactory(config.stateFile)
      : new NoStateFactory();
    this.modulatorFactory = new ModulatorFactory(this.stateFactory);

    if (process) {
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

  addPollCycle(cb: () => void) {
    this.pollCycle.push(cb);
  }

  async init(
    emit: (member: Member) => void,
    close: () => void,
    factory: ModulatorFactory,
  ): Promise<void> {
    const logger = log.extend("init");
    // Fetch the url
    const root = await fetchPage(this.config.url, this.dereferencer);
    // Try to get a shape
    // TODO Choose a view
    const viewQuads = root.data.getQuads(null, TREE.terms.view, null, null);

    let ldesId: Term = namedNode(this.config.url);
    if (!this.config.urlIsView) {
      if (viewQuads.length === 0) {
        console.error(
          "Did not find tree:view predicate, this is required to interpret the LDES",
        );
      } else {
        ldesId = viewQuads[0].object;
      }
    }

    const info = await getInfo(
      ldesId,
      root.data,
      this.dereferencer,
      this.config.noShape,
    );
    console.log("Info", info);

    const state = this.stateFactory.build<Set<string>>(
      "members",
      (set) => {
        const arr = [...set.values()];
        return JSON.stringify(arr);
      },
      (inp) => new Set(JSON.parse(inp)),
      () => new Set(),
    );
    this.memberManager = new Manager(
      this.streamId || viewQuads[0].subject,
      state.item,
      info,
    );

    logger("timestampPath %o", !!info.timestampPath);

    if (this.ordered !== "none" && !info.timestampPath) {
      throw "Can only emit members in order, if LDES is configured with timestampPath";
    }

    this.fetcher = new Fetcher(this.dereferencer, this.config.loose);

    const notifier: Notifier<StrategyEvents, {}> = {
      fragment: () => this.emit("fragment", undefined),
      member: (m) => emit(m),
      pollCycle: () => {
        this.emit("poll", undefined);
        this.pollCycle.forEach((cb) => cb());
      },
      close: () => {
        this.stateFactory.write();
        close();
      },
    };

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

    logger("Found %d views, choosing %s", viewQuads.length, ldesId.value);
    this.strategy.start(ldesId.value);
  }

  stream(strategy?: {
    highWaterMark?: number;
    size?: (chunk: Member) => number;
  }): ReadableStream<Member> {
    const emitted = longPromise();
    const config: UnderlyingDefaultSource = {
      start: async (controller: Controller) => {
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
      pull: async () => {
        resetPromise(emitted);
        this.modulatorFactory.unpause();
        await emitted.waiting;
        this.modulatorFactory.pause();
        return;
      },
      cancel: async () => {
        this.stateFactory.write();
        console.log("Cancled");
        this.strategy.cancle();
      },
    };

    const out = new ReadableStream(config, strategy);
    return out;
  }
}

async function fetchPage(
  location: string,
  dereferencer: RdfDereferencer,
): Promise<FetchedPage> {
  const resp = await dereferencer.dereference(location, { localFiles: true });
  const url = resp.url;
  const data = RdfStore.createDefault();
  await new Promise((resolve, reject) => {
    data.import(resp.data).on("end", resolve).on("error", reject);
  });
  return <FetchedPage>{ url, data };
}
