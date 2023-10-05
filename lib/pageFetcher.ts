import { RdfDereferencer } from "rdf-dereference";
import { streamToArray } from "./utils";
import { State } from "./state";
import { DataFactory, Store } from "n3";
import { extractRelations } from "./page";

const { namedNode } = DataFactory;

export type FetchedPage = {
  url: string;
  data: Store;
};

export class Fetcher {
  private dereferencer: RdfDereferencer;
  private fetch: typeof fetch;

  private pages: Promise<void>[] = [];
  private readyPages: FetchedPage[] = [];
  private state: State;

  private staged: string[] = [];

  constructor(
    dereferencer: RdfDereferencer,
    myFetch: typeof fetch,
    state: State,
  ) {
    this.dereferencer = dereferencer;
    this.fetch = myFetch;
    this.state = state;
  }

  private async _fetchPage(location: string) {
    const resp = await this.dereferencer.dereference(location, {
      fetch: this.fetch,
    });
    const url = resp.url;
    const page = await streamToArray(resp.data);
    const data = new Store(page);

    // Maybe extract relations here
    // And already add them to me
    for (let relation of extractRelations(data, namedNode(url))) {
      this.stage(relation.node);
    }

    this.readyPages.push({ data, url });
    console.log("Adding ready page", this.readyPages.length);
  }

  /// Stage an url to be fetched on the next commit
  stage(url: string) {
    console.log("Staging ", url);
    this.staged.push(url);
  }

  // Start fetch the staged urls
  commit() {
    this.pages = [];
    console.log("Commit", this.staged.length);
    const staged = this.staged;
    this.staged = [];
    staged.forEach((x) => this.fetchPage(x));
  }

  // Fetch a page, don't stage and commit, just fetch it
  fetchPage(url: string) {
    if (!this.state.seen(url)) {
      this.state.add(url);
      this.pages.push(this._fetchPage(url));
    }
  }

  /// Get a page that is ready
  getPage(): FetchedPage | undefined {
    return this.readyPages.shift();
  }

  /// Wait until at least one page is ready
  async ready(): Promise<void> {
    if (!!this.readyPages.length) return Promise.resolve();

    await Promise.any(this.pages);
  }
}
