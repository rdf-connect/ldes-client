import { Config, getConfig } from "./config";
import { extractMembers, extractRelations, Member, Relation } from "./page";
import rdfDereference, { RdfDereferencer } from "rdf-dereference";
import { SimpleState, State } from "./state";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { DataFactory, Store } from "n3";
import { Quad } from "@rdfjs/types";
import { Semaphore, streamToArray } from "./utils";

const { namedNode } = DataFactory;

type Controller = ReadableStreamDefaultController<Member>;

export async function startClient() {
  // Extract config from command line args
  const config = await getConfig();

  // Start channel from target

  const client = replicateLDES(config);
}

type FetchedPage = {
  url: string;
  page: Quad[];
};

export function replicateLDES(
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
): ReadableStream<Member> {
  const queueingStrategy = new CountQueuingStrategy({ highWaterMark: 100 });
  const fetchedPages: FetchedPage[] = [];
  const myFetch = new Semaphore(10).wrapFunction(fetch);

  if (!dereferencer) {
    dereferencer = rdfDereference;
  }
  let cbdExtractor: CBDShapeExtractor = new CBDShapeExtractor(
    undefined,
    dereferencer,
  );

  return new ReadableStream(
    {
      async start(controller) {
        if (!membersState) {
          membersState = new SimpleState(config.memberStateLocation);
          await membersState.init();
        }

        if (!fragmentState) {
          fragmentState = new SimpleState(config.fragmentStateLocation);
          await fragmentState.init();
        }

        // Fetch the url
        // Try to get a shape
        // Choose a view
        // Fetch view but do not interpret
        fetchedPages.push({ url: config.url, page: [] });
      },

      async pull(controller) {
        if (!fetchedPages && config.follow) return controller.close();

        const newPages: Promise<any>[] = [];
        // Fetched Pages can be more smart
        let page = fetchedPages.shift();
        while (page) {
          const store = new Store();
          // Streaming parse?
          store.addQuads(page.page);

          extractMembers(
            store,
            namedNode(page.url),
            cbdExtractor,
            (member) => controller.enqueue(member),
            membersState,
          );

          const relations = extractRelations(store, namedNode(page.url));

          const goodRelations = await fragmentState.filter(
            relations,
            (x) => x.node,
          );

          // This is an array that holds all promises that fetch a new page
          // Please do not `pull` us again, before at least one is loaded
          // This is incorrect though, please pull use again if at least one is done
          // This might be one that was already started on the previous page
          newPages.push(
            ...goodRelations.map((x) => {
              fragmentState.add(x.node);
              return fetchPage(x, dereferencer, myFetch).then((page) =>
                fetchedPages.push(page),
              );
            }),
          );

          page = fetchedPages.shift();
        }

        // Create Store
        // Some fragments are already polled, but not interpretted
        // Interpret these fragments and emit the members
        // Poll all linked fragments according to the strategy
        // Return this pull function when at least one fetch is completed
        if (newPages) {
          await Promise.race(newPages);
        }
      },
      cancel() {},
    },
    queueingStrategy,
  );
}

async function fetchPage(
  relation: Relation,
  dereferencer: RdfDereferencer,
  myFetch: typeof fetch,
): Promise<FetchedPage> {
  const resp = await dereferencer.dereference(relation.node, {
    fetch: myFetch,
  });
  const url = resp.url;
  const page = await streamToArray(resp.data);
  return <FetchedPage>{ url, page };
}
