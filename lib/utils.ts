import { Stream } from "@rdfjs/types";
import { BaseQuad } from "n3";

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
