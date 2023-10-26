import { Config, getConfig } from "./config";
import { Member } from "./page";
import rdfDereference, { RdfDereferencer } from "rdf-dereference";
import { SimpleState, State } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { DataFactory, Store } from "n3";
import { Term } from "@rdfjs/types";
import { streamToArray } from "./utils";
import { LDES, TREE } from "@treecg/types";
import { FetchedPage, Fetcher } from "./pageFetcher";
import { Manager } from "./memberManager";
import { orderedHelper, unorderedHelper } from "./helper";

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
): Client {
  return new Client(config, states);
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
  const shapeIds = store.getObjects(ldesId, TREE.terms.shape, null);
  const timestampPaths = store.getObjects(
    ldesId,
    LDES.terms.timestampPath,
    null,
  );
  const isVersionOfPaths = store.getObjects(
    ldesId,
    LDES.terms.versionOfPath,
    null,
  );

  if (!shapeIds || !timestampPaths || !isVersionOfPaths) {
    try {
      const resp = await dereferencer.dereference(ldesId.value);
      store = new Store(await streamToArray(resp.data));
      shapeIds.push(...store.getObjects(ldesId, TREE.terms.shape, null));

      timestampPaths.push(
        ...store.getObjects(ldesId, LDES.terms.timestampPath, null),
      );
      isVersionOfPaths.push(
        ...store.getObjects(ldesId, LDES.terms.versionOfPath, null),
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
  private cbdExtractor: CBDShapeExtractor;

  private fetcher!: Fetcher;
  private memberManager!: Manager;

  private streamId?: Term;

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
  ) {
    this.config = config;
    this.dereferencer = dereferencer ?? rdfDereference;
    this.membersState =
      membersState ?? new SimpleState(config.memberStateLocation);
    this.fragmentState =
      fragmentState ?? new SimpleState(config.fragmentStateLocation);
    this.cbdExtractor = new CBDShapeExtractor(undefined, this.dereferencer);

    this.streamId = stream;
  }

  async init(cb: (member: Member) => void): Promise<void> {
    await this.membersState.init();
    await this.fragmentState.init();

    // Fetch the url
    const root = await fetchPage(this.config.url, this.dereferencer, fetch);
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
    this.cbdExtractor = info.extractor;

    this.memberManager = new Manager(
      this.streamId || ldesId,
      this.membersState,
      cb,
      info,
    );

    const helper = info.timestampPath
      ? orderedHelper(this.memberManager)
      : unorderedHelper(this.memberManager);

    this.fetcher = new Fetcher(
      this.dereferencer,
      this.fragmentState,
      helper,
      this.config.fetcher,
    );

    console.log("Found", viewQuads.length, "views, choosing", ldesId.value);

    // Fetch view but do not interpret
    this.fetcher.start(viewQuads[0].object.value, (a, b) => {
      if (a == b) return 0;
      if (a < b) return -1;
      return 1;
    });
  }

  async pull(cb: (member: Member) => void, close: () => void, highWater = 10) {
    const submitMember = this.memberManager.reset();
    await submitMember;
  }

  stream(strategy?: { highWaterMark?: number }): ReadableStream<Member> {
    const config = {
      start: (controller: Controller) => 
        this.init((member) => controller.enqueue(member)),
      pull: (controller: Controller) =>
        this.pull(
          (member) => controller.enqueue(member),
          () => controller.close(),
          controller.desiredSize || 10,
        ),
    };
    return new ReadableStream(config, strategy);
  }
}

async function fetchPage(
  location: string,
  dereferencer: RdfDereferencer,
  myFetch: typeof fetch,
): Promise<FetchedPage> {
  const resp = await dereferencer.dereference(location, {
    fetch: myFetch,
  });
  const url = resp.url;
  const page = await streamToArray(resp.data);
  const data = new Store(page);
  return <FetchedPage>{ url, data };
}
