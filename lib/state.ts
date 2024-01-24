import { storage } from "./storage";

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
export type FileStateFactoryItem<T> = {
  name: string;
  state: StateT<T>;
  serialize: (item: T) => string;
};

export interface StateFactory {
  build<T>(
    name: string,
    serialize: (item: T) => string,
    deserialize: (item: string) => T | undefined,
    create: () => T,
  ): StateT<T>;

  write(): void;
}

export class LocalStorateStateFactory {}

export class FileStateFactory implements StateFactory {
  private location: string;
  private elements: FileStateFactoryItem<any>[];
  private found: { [label: string]: string };

  constructor(location: string) {
    this.location = location;
    this.elements = [];

    this.found = {};
    try {
      const item = storage.getItem(location);
      this.found = JSON.parse(item);
    } catch (ex: any) {}
  }

  write() {
    const out: { [label: string]: string } = {};
    for (let element of this.elements) {
      out[element.name] = element.serialize(element.state.item);
    }

    storage.setItem(this.location, JSON.stringify(out));
  }

  build<T>(
    name: string,
    serialize: (item: T) => string,
    deserialize: (item: string) => T | undefined,
    create: () => T,
  ): StateT<T> {
    const out = this.elements.find((x) => x.name == name);
    if (out) return out.state;

    const found: string | undefined = this.found[name];
    const state = new StateT<any>(deserialize, create, found);
    this.elements.push({
      name,
      serialize,
      state,
    });

    return state;
  }
}

export class StateT<T> {
  item: T;
  constructor(
    deserialize: (item: string) => T | undefined,
    create: () => T,
    prev?: string,
  ) {
    const item = prev ? deserialize(prev) : create();
    if (item) {
      this.item = item;
    } else {
      this.item = create();
    }
  }
}
