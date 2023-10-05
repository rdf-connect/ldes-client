import { Stream } from "@rdfjs/types";
import { BaseQuad } from "n3";

interface Task<F extends (...args: any) => any> {
  resolve: (value: ReturnType<F>) => void;
  reject: (reason: any) => void;
  fnToCall: F;
  args: Parameters<F>;
}

export class Semaphore {
  currentRequests: Task<any>[] = [];
  runningRequests = 0;
  maxConcurrentRequests: number;

  constructor(maxConcurrentRequests = 1) {
    this.currentRequests = [];
    this.runningRequests = 0;
    this.maxConcurrentRequests = maxConcurrentRequests;
  }

  /// Call a function behind a semaphore. This helps manage trafic
  callFunction<F extends (...args: any) => any>(
    fnToCall: F,
    ...args: Parameters<F>
  ): Promise<ReturnType<F>> {
    return new Promise((resolve, reject) => {
      this.currentRequests.push({
        resolve,
        reject,
        fnToCall,
        args,
      });
      this.tryNext();
    });
  }

  /// Wraps a function behind a semaphore, can be used to manage fetch requests
  wrapFunction<F extends (...args: any) => Promise<any>>(func: F): F {
    return <F>((...args: Parameters<F>) => this.callFunction(func, ...args));
  }

  private tryNext() {
    if (!this.currentRequests.length) {
      return;
    } else if (this.runningRequests < this.maxConcurrentRequests) {
      let { resolve, reject, fnToCall, args } = this.currentRequests.shift()!;
      this.runningRequests++;
      let req = fnToCall(...args);
      req
        .then((res: any) => resolve(res))
        .catch((err: any) => reject(err))
        .finally(() => {
          this.runningRequests--;
          this.tryNext();
        });
    }
  }
}

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

export function streamToArray<T extends BaseQuad>(
  stream: Stream<T>,
): Promise<T[]> {
  const out: T[] = [];
  return new Promise(async (res, rej) => {
    stream.on("data", (x) => out.push(x));
    stream.on("error", rej);
    stream.on("end", () => res(out));
  });
}
