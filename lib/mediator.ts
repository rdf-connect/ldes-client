// Mediator makes sure nothing goes wrong
// Not too many requests at the same time

import { MediatorConfig } from "./config";
import { Member } from "./page";

// Don't do extra requests if we still need to ingest members etc
export class Mediator {
  constructor(config: MediatorConfig, controller: ReadableStreamDefaultController<Member>) {
    // Use semaphore things
    //
  }

  fetch: typeof fetch = (input, init) => {
    // Await for the right moment
    return fetch(input, init);
  };

  startHandleMember() {}

  endHandleMember() {}
}

