import * as process from "process";
import { Ordered, replicateLDES } from "../lib/client";
import { intoConfig } from "../lib/config";
import { Command, Option } from "commander";

const program = new Command();
let paramURL: string = "";
let paramFollow: boolean;
let paramPollInterval: number;
let ordered: Ordered = "none";

program
  .arguments("<url>")
  .option("-f, --follow", "follow the LDES, the client stays in sync")
  .addOption(
    new Option("--ordered <ordered>", "emit members in order")
      .choices(["ascending", "descending", "none"])
      .default("none"),
  )
  .option(
    "-s, --save <path>",
    "filepath to the save state file to use, used both to resume and to update",
  )
  .option("--pollInterval <number>", "Specify poll interval")
  .option("--shape <shapefile>", "Specify a shapefile")
  .action((url: string, program) => {
    paramURL = url;
    paramFollow = program.follow;
    paramPollInterval = program.pollInterval;
    ordered = program.ordered;
    // console.log(paramURL)
    // console.log(program.follow, paramPollInterval)
  });

program.parse(process.argv);

async function main() {
  const client = replicateLDES(
    intoConfig({
      url: paramURL,
      follow: paramFollow,
      pollInterval: paramPollInterval,
      fetcher: { maxFetched: 2, concurrentRequests: 10 },
    }),
    undefined,
    undefined,
    ordered,
    // intoConfig({ url: "http://marineregions.org/feed" }),
  );

  const reader = client.stream({ highWaterMark: 10 }).getReader();
  let el = await reader.read();
  const seen = new Set();
  while (el) {
    if (el.value) {
      seen.add(el.value.id);
      if (seen.size % 100 == 1) {
        console.log("Got member", seen.size, "quads", el.value.quads.length);
      }
      console.log("Found", seen.size, "members");
    }

    if (el.done) {
      console.log("Break");
      break;
    }

    // await new Promise((res) => setTimeout(res, 100));

    el = await reader.read();
  }
  console.log("Found", seen.size, "members");
}

main().catch(console.error);
