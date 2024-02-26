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
let urlIsView = false;
let noShape = false;
let shapeFile: string | undefined;
let ordered: Ordered = "none";
let quiet: boolean = false;
let verbose: boolean = false;
let save: string | undefined;
let onlyDefaultGraph: boolean = false;
let loose: boolean = false;

program
  .arguments("<url>")
  .addOption(
    new Option("-o --ordered <ordered>", "emit members in order")
      .choices(["ascending", "descending", "none"])
      .default("none"),
  )
  .option("-f, --follow", "follow the LDES, the client stays in sync")
  .option("--poll-interval <number>", "specify poll interval")
  .option("--shape-file <shapefile>", "specify a shapefile")
  .option(
    "--no-shape",
    "don't extract members with a shape (only use cbd and named graphs)",
  )
  .option(
    "--only-default-graph",
    "extract members only from the default graph and the member graph",
  )
  .option(
    "-s, --save <path>",
    "filepath to the save state file to use, used both to resume and to update",
  )
  .option(
    "-l --loose",
    "use loose implementation, might work on more ldes streams",
  )
  .option(
    "--url-is-view",
    "the url is the view url, don't try to find the correct view",
  )
  .option("-q --quiet", "be quiet")
  .option("-v --verbose", "be verbose")
  .action((url: string, program) => {
    urlIsView = program.urlIsView;
    noShape = !program.shape;
    save = program.save;
    paramURL = url;
    shapeFile = program.shapeFile;
    paramFollow = program.follow;
    paramPollInterval = program.pollInterval;
    ordered = program.ordered;
    quiet = program.quiet;
    verbose = program.verbose;
    loose = program.loose;
    onlyDefaultGraph = program.onlyDefaultGraph;
  });

program.parse(process.argv);

async function main() {
  const client = replicateLDES(
    intoConfig({
      loose,
      noShape,
      polling: paramFollow,
      url: paramURL,
      stateFile: save,
      follow: paramFollow,
      pollInterval: paramPollInterval,
      fetcher: { maxFetched: 2, concurrentRequests: 10 },
      urlIsView: urlIsView,
      shapeFile,
      onlyDefaultGraph,
    }),
    undefined,
    undefined,
    ordered,
    // intoConfig({ url: "http://marineregions.org/feed" }),
  );

  if (verbose) {
    client.on("fragment", () => console.error("Fragment!"));
  }

  const reader = client.stream({ highWaterMark: 10 }).getReader();
  let el = await reader.read();
  const seen = new Set();
  while (el) {
    if (el.value) {
      seen.add(el.value.id);

      if (!quiet) {
        if (verbose) {
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
      break;
    }

    el = await reader.read();
  }

  if (!quiet) {
    console.error("Found", seen.size, "members");
  }
}

main().catch(console.error);
