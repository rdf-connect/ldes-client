export interface ClientState {
  root: string; // Used to acquire shape
  inFlight: string[]; // fragments that are currently being checked
}

export interface State {
  init(): Promise<void>;
  seen(id: string): boolean;
  filter<T>(ids: T[], getId: (item: T) => string): T[];
  add(id: string): void;
  save(): Promise<void>;
}

export class SimpleState implements State {
  state: Set<string>;
  location: string;

  constructor(location: string) {
    this.location = location;
    this.state = new Set();
  }

  async init() {
    // Loaad location into state, or default
    // Take into account nodejs and browser runtimes
    //
    // Setup on exit hooks
  }

  filter<T>(ids: T[], getId: (item: T) => string): T[] {
    return ids.filter(async (x) => !this.seen(getId(x)));
  }

  seen(id: string): boolean {
    return this.state.has(id);
  }

  add(id: string): void {
    this.state.add(id);
  }

  async save(): Promise<void> {
    // Save state into location
  }
}
