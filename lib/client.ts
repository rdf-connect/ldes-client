import { Config, getConfig } from "./config";
import { Member } from "./page";
import rdfDereference, { RdfDereferencer } from "rdf-dereference";
import { SimpleState, State } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { DataFactory, Store } from "n3";
import { Term } from "@rdfjs/types";
import { streamToArray } from "./utils";
import { TREE } from "@treecg/types";
import { FetchedPage, Fetcher } from "./pageFetcher";
import { Manager } from "./memberManager";

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

async function getShape(
  ldesId: Term,
  store: Store,
  dereferencer: RdfDereferencer,
): Promise<[CBDShapeExtractor, Term] | undefined> {
  try {
    const shapeIds = store.getObjects(ldesId, TREE.terms.shape, null);
    if (shapeIds.length === 0) {
      const resp = await dereferencer.dereference(ldesId.value);
      store = new Store(await streamToArray(resp.data));
      shapeIds.push(...store.getObjects(ldesId, TREE.terms.shape, null));
      if (shapeIds.length === 0) {
        console.error("Could not determine the shape, no shape found");
        return;
      }
    }

    if (shapeIds.length > 1) {
      console.error("Expected at most one shape id, found " + shapeIds.length);
    }

    return [new CBDShapeExtractor(store, dereferencer), shapeIds[0]];
  } catch (ex: any) {
    console.error("Could not determine the shape");
    console.error(ex);
    return;
  }
}

export class Client {
  private config: Config;
  private membersState: State;
  private fragmentState: State;

  private dereferencer: RdfDereferencer;
  private cbdExtractor: CBDShapeExtractor;

  private fetcher: Fetcher;
  private memberManager: Manager;

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

    this.fetcher = new Fetcher(this.dereferencer, this.fragmentState, config.fetcher);

    this.memberManager = new Manager(
      stream || namedNode(config.url),
      this.membersState,
      this.cbdExtractor,
    );
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

    this.memberManager.setOptions({
      callback: cb,
      ldesId,
    });

    const shapeOutput = await getShape(ldesId, root.data, this.dereferencer);
    let shapeId;
    if (shapeOutput) {
      console.log("Found shape!", shapeOutput[1]);
      this.cbdExtractor = shapeOutput[0];
      shapeId = shapeOutput[1];

      this.memberManager.setOptions({
        shapeId,
        extractor: this.cbdExtractor,
      });
    }

    console.log("Found", viewQuads.length, "views, choosing", ldesId.value);

    // Fetch view but do not interpret
    this.fetcher.start(viewQuads[0].object.value);
  }

  async pull(cb: (member: Member) => void, close: () => void, highWater = 10) {
    let page = await this.fetcher.getPage();
    if (!page) return close();

    const submitMember = this.memberManager.reset();

    // const newMembers: Promise<any>[] = [];
    // Fetched Pages can be more smart
    while (page && this.memberManager.queued < highWater) {
      this.memberManager.extractMembers(page);
      // This is an array that holds all promises that fetch a new page
      // Please do not `pull` us again, before at least one is loaded
      // This is incorrect though, please pull use again if at least one is done
      // This might be one that was already started on the previous page
      page = await this.fetcher.getPage();
      if (!page) return close();
    }

    // Return this pull function when at least one fetch is completed
    // await this.fetcher.ready();

    console.log("Members queued", this.memberManager.queued);
    if (this.memberManager.queued > 0) {
      await submitMember;
    } else {
      await this.pull(cb, close, highWater);
    }
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
