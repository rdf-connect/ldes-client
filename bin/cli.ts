#!/usr/bin/env node

import * as process from "process";
import { Ordered, replicateLDES } from "../lib/client";
import { intoConfig } from "../lib/config";
import { Command, Option } from "commander";
import { Writer } from "n3";

const program = new Command();
let paramURL: string = "";
let paramFollow: boolean = false;
let paramPollInterval: number;
let ordered: Ordered = "none";
let quiet: boolean = false;
let verbose: boolean = false;
let save: string | undefined;
let loose: boolean = false;

program
  .arguments("<url>")
  .option("-f, --follow", "follow the LDES, the client stays in sync")
  .option("-q", "Be quiet")
  .option("-v --verbose", "Be verbose")
  .addOption(
    new Option("-o --ordered <ordered>", "emit members in order")
      .choices(["ascending", "descending", "none"])
      .default("none"),
  )
  .option(
    "-s, --save <path>",
    "filepath to the save state file to use, used both to resume and to update",
  )
  .option("--pollInterval <number>", "Specify poll interval")
  .option("--shape <shapefile>", "Specify a shapefile")
  .option("--save <shapefile>", "Specify save location")
  .option("--loose", "Use loose implementation, might work on more ldeses")
  .action((url: string, program) => {
    console.log(program);
    save = program.save;
    paramURL = url;
    paramFollow = program.follow;
    paramPollInterval = program.pollInterval;
    ordered = program.ordered;
    quiet = program.q;
    verbose = program.verbose;
    loose = program.loose;
  });

program.parse(process.argv);

async function main() {
  const client = replicateLDES(
    intoConfig({
      loose,
      polling: paramFollow,
      url: paramURL,
      stateFile: save,
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
      if (!quiet) {
        if(verbose) {
          console.log(new Writer().quadsToString(el.value.quads));
        }

        if (seen.size % 100 == 1) {
          console.error(
            "Got member",
            seen.size,
            "with",
            el.value.quads.length,
            "quads",
          );
        }
      }
    }

    if (el.done) {
      console.error("Break");
      break;
    }

    el = await reader.read();
  }
  console.error("Found", seen.size, "members");
}

main().catch(console.error);
