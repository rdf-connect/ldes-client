export interface ClientState {
  root: string; // Used to acquire shape
  inFlight: string[]; // fragments that are currently being checked
}

export interface State {
  init(): Promise<void>;
  seen(id: string): Promise<boolean>;
  filter<T>(ids: T[], getId: (item: T) => string): Promise<T[]>;
  add(id: string): Promise<void>;
  save(): Promise<void>;
}

export class SimpleState implements State {
  state: Set<string>;
  location: string;

  constructor(location: string) {
    this.location = location;
  }

  async init() {
    // Loaad location into state, or default
    // Take into account nodejs and browser runtimes
    //
    // Setup on exit hooks
  }

  filter<T>(ids: T[], getId: (item: T) => string): Promise<T[]> {
    return Promise.all(ids.filter((x) => !this.seen(getId(x))));
  }

  async seen(id: string): Promise<boolean> {
    return this.state.has(id);
  }

  async add(id: string): Promise<void> {
    this.state.add(id);
  }

  async save(): Promise<void> {
    // Save state into location
  }
}
