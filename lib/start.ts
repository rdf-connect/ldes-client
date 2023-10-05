import { replicateLDES } from "./client";
import { intoConfig } from "./config";

async function main() {
  const reader = replicateLDES(
    intoConfig({ url: "http://era.ilabt.imec.be/ldes/" }),
  ).getReader();
  let el = await reader.read();
  while (el) {
    if (el.value) {
      console.log(
        "Got member",
        el.value.id.value,
        el.value.quads.length,
        "quads",
      );
    }

    if (el.done) break;
  }
}

main();
