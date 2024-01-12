import { Stream } from "@rdfjs/types";
import { BaseQuad } from "n3";

export type Notifier<Events, S> = {
  [K in keyof Events]: (event: Events[K], state: S) => void;
};

export function readableToArray<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  const reader = stream.getReader();
  return new Promise(async (res, rej) => {
    let obj = await reader.read().catch(rej);
    while (obj) {
      if (obj.done) {
        res(out);
        break;
      }
      if (obj.value) out.push(obj.value);
      obj = await reader.read().catch(rej);
    }
  });
}

/**
 * Converts a stream to an array, pushing all elements to an array
 * Resolving the promise with the 'end' event
 */
export function streamToArray<T extends BaseQuad>(
  stream: Stream<T>,
): Promise<T[]> {
  const out: T[] = [];
  return new Promise(async (res, rej) => {
    stream.on("end", () => res(out));
    stream.on("data", (x) => {
      out.push(x);
    });
    stream.on("error", (ex) => {
      console.error("Stream to Array failed");
      rej(ex);
    });
  });
}

/**
 * Generic interface that represents a structure that ranks elements.
 * Most common is a Prority Queue (heap like) the pops elements in order.
 * An array is also a Ranker, without ordering.
 */
export interface Ranker<T> {
  push(item: T): void;
  pop(): T | undefined;
}

export type ModulartorEvents<T> = {
  ready: T;
};

/**
 * Factory that creates Modulator's
 * This is a factory to keep track whether or not the Modulator should be paused or not.
 */
export class ModulatorFactory {
  concurrent = 10;
  paused: boolean = false;

  children: ModulatorInstance<any>[] = [];

  constructor(concurrent?: number) {
    if (concurrent) {
      this.concurrent = concurrent;
    }
  }

  create<T>(
    ranker: Ranker<T>,
    notifier: Notifier<ModulartorEvents<T>, {}>,
  ): Modulator<T> {
    const out = new ModulatorInstance(ranker, notifier, this);
    this.children.push(out);
    return out;
  }

  pause() {
    this.paused = true;
  }

  unpause() {
    this.paused = false;
    this.children.forEach((x) => x.checkReady());
  }
}

/**
 * Modulator is a stucture that only buffers elements and only handles elements
 * when the factory is not paused and when not too many items are active at once.
 */
export interface Modulator<T> {
  push(item: T): void;
  finished(): void;
}

class ModulatorInstance<T> {
  at: number = 0;

  private ranker: Ranker<T>;
  private notifier: Notifier<ModulartorEvents<T>, {}>;
  private factory: ModulatorFactory;

  constructor(
    ranker: Ranker<T>,
    notifier: Notifier<ModulartorEvents<T>, {}>,
    factory: ModulatorFactory,
  ) {
    this.ranker = ranker;
    this.notifier = notifier;
    this.factory = factory;
  }

  push(item: T) {
    this.ranker.push(item);
    this.checkReady();
  }

  finished() {
    this.at -= 1;
    this.checkReady();
  }

  checkReady() {
    if (this.factory.paused) {
      return;
    }

    while (this.at < this.factory.concurrent) {
      const item = this.ranker.pop();
      if (item) {
        this.at += 1;
        this.notifier.ready(item, {});
      } else {
        break;
      }
    }
  }
}
