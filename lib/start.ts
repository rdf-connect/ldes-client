import rdfDereference, { RdfDereferencer } from "rdf-dereference";
import { replicateLDES } from "./client";
import { intoConfig } from "./config";
import { streamToArray } from "./utils";

async function main() {
  const client = replicateLDES(
    intoConfig({ url: "http://era.ilabt.imec.be/ldes/default" }),
  );

  const reader = client.stream().getReader();
  let el = await reader.read();
  const seen = new Set();
  while (el) {
    if (el.value) {
      seen.add(el.value.id);
      console.log(
        "Got member",
        el.value.id.value,
        el.value.quads.length,
        "quads",
        seen.size
      );
    }

    if (el.done) break;

    el = await reader.read();
  }
}

main().catch(console.error);

