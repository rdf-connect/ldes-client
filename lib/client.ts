import { Config, getConfig } from "./config";
import { Member } from "./page";
import rdfDereference, { RdfDereferencer } from "rdf-dereference";
import { SimpleState, State } from "./state";
import { CBDShapeExtractor, shape } from "extract-cbd-shape";
import { DataFactory, Store } from "n3";
import { Term } from "@rdfjs/types";
import { streamToArray } from "./utils";
import { LDES, TREE } from "@treecg/types";
import { FetchedPage, Fetcher, Helper } from "./pageFetcher";
import { Manager } from "./memberManager";
import { orderedHelper, unorderedHelper } from "./helper";
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

export function replicateLDES(
  config: Config,
  states: {
    membersState?: State;
    fragmentState?: State;
    dereferencer?: RdfDereferencer;
  } = {},
  streamId?: Term,
  ordered?: boolean,
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

  private streamId?: Term;
  private ordered?: boolean;

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
    ordered?: boolean,
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

  async init(cb: (member: Member) => void): Promise<void> {
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
      ldesId = viewQuads[0].subject;
    }

    const info = await getShape(ldesId, root.data, this.dereferencer);

    this.memberManager = new Manager(
      this.streamId || ldesId,
      this.membersState,
      cb,
      info,
    );

    logger("timestampPath %o", !!info.timestampPath);

    if (this.ordered && !info.timestampPath) {
      throw "Can only emit members in order, if LDES is configured with timestampPath";
    }

    const wantsOrderedHelper =
      this.ordered === undefined ? !!info.timestampPath : this.ordered;

    const helper = wantsOrderedHelper
      ? orderedHelper(this.memberManager)
      : unorderedHelper(this.memberManager);

    this.fetcher = new Fetcher(
      this.dereferencer,
      this.fragmentState,
      helper,
      this.config.fetcher,
    );

    logger("Found %d views, choosing %s", viewQuads.length, ldesId.value);

    // Fetch view but do not interpret
    this.fetcher.start(viewQuads[0].object.value, (a, b) => {
      if (a == b) return 0;
      if (a < b) return -1;
      return 1;
    });
  }

  async pull(controller: Controller, highWater = 10) {
    const logger = log.extend("pull");
    logger("PULL");
    if ( await this.fetcher.checkFinished()) {
      controller.close();
    } else {
      const submitMember = this.memberManager.reset();
      logger("awaiting");
      await submitMember;
      logger("awaited %d", this.memberManager.queued);
      // iew
      if (this.memberManager.queued === 0) controller.close();
    }
  }

  stream(strategy?: { highWaterMark?: number }): ReadableStream<Member> {
    const config = {
      start: (controller: Controller) =>
        this.init((member) => controller.enqueue(member)),
      pull: (controller: Controller) => this.pull(controller),
    };
    return new ReadableStream(config, strategy);
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
