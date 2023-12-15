import { Config, getConfig } from "./config";
import { Member } from "./page";
import rdfDereference, { RdfDereferencer } from "rdf-dereference";
import { SimpleState, State } from "./state";
import { CBDShapeExtractor, shape } from "extract-cbd-shape";
import { DataFactory, Store } from "n3";
import { Term } from "@rdfjs/types";
import { ModulatorFactory, Notifier, streamToArray } from "./utils";
import { LDES, TREE } from "@treecg/types";
import {
  FetchedPage,
  Fetcher,
  Helper,
  longPromise,
  resetPromise,
} from "./pageFetcher";
import { Manager } from "./memberManager";
import { orderedHelper, unorderedHelper } from "./helper";
import { OrderedStrategy, StrategyEvents, UnorderedStrategy } from "./strategy";

import debug from "debug";
const log = debug("client");
const { namedNode } = DataFactory;

type Controller = ReadableStreamDefaultController<Member>;

export async function startClient() {
  // Extract config from command line args
  const config = await getConfig();

  // Start channel from target

  const client = replicateLDES(config);
}

export type Ordered = "ascending" | "descending" | "none";

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

async function getShape(
  ldesId: Term,
  store: Store,
  dereferencer: RdfDereferencer,
): Promise<LDESInfo> {
  const logger = log.extend("getShape");

  let shapeIds = store.getObjects(ldesId, TREE.terms.shape, null);
  let timestampPaths = store.getObjects(ldesId, LDES.terms.timestampPath, null);
  let isVersionOfPaths = store.getObjects(
    ldesId,
    LDES.terms.versionOfPath,
    null,
  );
  logger(
    "Found %d shapes, %d timestampPaths, %d isVersionOfPaths",
    shapeIds.length,
    timestampPaths.length,
    isVersionOfPaths.length,
  );

  if (
    shapeIds.length === 0 ||
    timestampPaths.length === 0 ||
    isVersionOfPaths.length === 0
  ) {
    try {
      logger("Maybe find more info at %s", ldesId.value);
      const resp = await dereferencer.dereference(ldesId.value);
      store = new Store(await streamToArray(resp.data));
      shapeIds = store.getObjects(null, TREE.terms.shape, null);
      timestampPaths = store.getObjects(null, LDES.terms.timestampPath, null);
      isVersionOfPaths = store.getObjects(null, LDES.terms.versionOfPath, null);
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
    extractor: new CBDShapeExtractor(store, dereferencer),
    shape: shapeIds[0],
    timestampPath: timestampPaths[0],
    isVersionOfPath: isVersionOfPaths[0],
  };
}

export class Client {
  private config: Config;
  private membersState: State;
  private fragmentState: State;

  private dereferencer: RdfDereferencer;

  private fetcher!: Fetcher;
  private memberManager!: Manager;
  private strategy!: OrderedStrategy | UnorderedStrategy;

  private streamId?: Term;
  private ordered: Ordered;

  private modulatorFactory = new ModulatorFactory();

  constructor(
    config: Config,
    {
      membersState,
      fragmentState,
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
    this.membersState =
      membersState ?? new SimpleState(config.memberStateLocation);
    this.fragmentState =
      fragmentState ?? new SimpleState(config.fragmentStateLocation);

    this.streamId = stream;
    this.ordered = ordered;
  }

  async init(
    emit: (member: Member) => void,
    close: () => void,
    factory: ModulatorFactory,
  ): Promise<void> {
    const logger = log.extend("init");
    await this.membersState.init();
    await this.fragmentState.init();

    // Fetch the url
    const root = await fetchPage(this.config.url, this.dereferencer);
    // Try to get a shape
    // TODO
    // Choose a view
    const viewQuads = root.data.getQuads(null, TREE.terms.view, null, null);

    let ldesId: Term = namedNode(this.config.url);
    if (viewQuads.length === 0) {
      console.error(
        "Did not find tree:view predicate, this is required to interpret the LDES",
      );
    } else {
      ldesId = viewQuads[0].object;
    }

    const info = await getShape(ldesId, root.data, this.dereferencer);

    this.memberManager = new Manager(
      this.streamId || viewQuads[0].subject,
      this.membersState,
      info,
    );

    logger("timestampPath %o", !!info.timestampPath);

    if (this.ordered && !info.timestampPath) {
      throw "Can only emit members in order, if LDES is configured with timestampPath";
    }

    const wantsOrderedHelper =
      this.ordered === undefined ? !!info.timestampPath : this.ordered;

    this.fetcher = new Fetcher(
      this.dereferencer,
      this.fragmentState,
      this.config.fetcher,
    );

    const notifier: Notifier<StrategyEvents, {}> = {
      member: (m) => emit(m),
      close: () => close(),
    };

    this.strategy = this.ordered !== "none"
      ? new OrderedStrategy(this.memberManager, this.fetcher, notifier, factory, this.ordered)
      : new UnorderedStrategy(
          this.memberManager,
          this.fetcher,
          notifier,
          factory,
        );

    logger("Found %d views, choosing %s", viewQuads.length, ldesId.value);
    this.strategy.start(ldesId.value);
  }

  stream(strategy?: {
    highWaterMark?: number;
    size?: (chunk: Member) => number;
  }): ReadableStream<Member> {
    const emitted = longPromise();
    const config = {
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
      pull: async (controller: Controller) => {
        resetPromise(emitted);
        this.modulatorFactory.unpause();
        await emitted.waiting;
        this.modulatorFactory.pause();
        return;
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
  const resp = await dereferencer.dereference(location, {});
  const url = resp.url;
  const page = await streamToArray(resp.data);
  const data = new Store(page);
  return <FetchedPage>{ url, data };
}
