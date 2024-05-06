#!/usr/bin/env node
import * as process from "process";
import { Ordered, replicateLDES } from "../lib/client";
import { intoConfig } from "../lib/config";
import { Command, Option } from "commander";
import { Writer } from "n3";
import { enhanced_fetch, FetchConfig } from "../lib/utils";

const program = new Command();
let paramURL: string = "";
let polling: boolean = false;
let after: Date | undefined;
let before: Date | undefined;
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

let fetch_config: FetchConfig = {
  retry: {},
};

program
  .arguments("<url>")
  .addOption(
    new Option("-o --ordered <ordered>", "emit members in order")
      .choices(["ascending", "descending", "none"])
      .default("none"),
  )
  .option("-f, --follow", "follow the LDES, the client stays in sync")
  .option(
    "--after <after>",
    "follow only relations including members after a certain point in time",
  )
  .option(
    "--before <before>",
    "follow only relations including members before a certain point in time",
  )
  .option("--poll-interval <number>", "specify poll interval")
  .option("--shape-file <shapeFile>", "specify a shapefile")
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
  .option("--basic-auth <username>:<password>", "HTTP basic auth information")
  .option(
    "--concurrent <requests>",
    "Allowed amount of concurrent HTTP request to the same domain",
    "5",
  )
  .option(
    "--retry-count <retry>",
    "Retry count per failing request (0 is infinite)",
    "3",
  )
  .option("--http-codes [codes...]", "What HTTP codes to retry")
  .action((url: string, program) => {
    urlIsView = program.urlIsView;
    noShape = !program.shape;
    save = program.save;
    paramURL = url;
    shapeFile = program.shapeFile;
    polling = program.follow;
    paramPollInterval = program.pollInterval;
    ordered = program.ordered;
    quiet = program.quiet;
    verbose = program.verbose;
    loose = program.loose;
    onlyDefaultGraph = program.onlyDefaultGraph;

    fetch_config.concurrent = parseInt(program.concurrent);
    if (program.basicAuth) {
      fetch_config.auth = {
        auth: program.basicAuth,
        host: new URL(url).host,
        type: "basic",
      };
    }
    fetch_config.retry!.maxRetries = parseInt(program.retryCount);
    if (program.httpCodes) {
      fetch_config.retry!.codes = program.httpCodes.map(parseInt);
    }

    if (program.after) {
      if (!isNaN(new Date(program.after).getTime())) {
        after = new Date(program.after);
      } else {
        console.error(`--after ${program.after} is not a valid date`);
        process.exit();
      }
    }
    if (program.before) {
      if (!isNaN(new Date(program.before).getTime())) {
        before = new Date(program.before);
      } else {
        console.error(`--before ${program.before} is not a valid date`);
        process.exit();
      }
    }
  });

program.parse(process.argv);

async function main() {
  const client = replicateLDES(
    intoConfig({
      loose,
      noShape,
      polling: polling,
      url: paramURL,
      stateFile: save,
      pollInterval: paramPollInterval,
      urlIsView: urlIsView,
      shapeFile,
      onlyDefaultGraph,
      after,
      before,
      fetch: enhanced_fetch(fetch_config),
    }),
    ordered,
  );

  if (!quiet) {
    client.on("description", (info) => {
      if (info.extractor.shapesGraph) {
        try {
          const mermaid = info.extractor.shapesGraph!.toMermaid(info.shape);
          console.log("mermaid:");
          console.log(mermaid);
        } catch (ex) {
          console.log("Failed mermaid extract");
        }
      } else {
        console.log("No mermaid extracted");
      }
    });
  }

  if (verbose) {
    client.on("relation", (xs) =>
      console.log("Relation", xs.source, xs.type.value, xs.node),
    );
    client.on("fragment", () => {
      console.error("Fragment!");
    });
  }

  if (!quiet) {
    client.on("error", (error) => {
      console.error("Error", error);
    });
  }

  const reader = client.stream({ highWaterMark: 10 }).getReader();
  let el = await reader.read();
  let count = 0;
  while (el) {
    if (el.value) {
      count += 1;

      if (!quiet) {
        if (verbose) {
          console.log(new Writer().quadsToString(el.value.quads));
        }

        if (count % 100 == 1) {
          console.error(
            "Got member",
            count,
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
    console.error("Found", count, "members");
  }
}

main().catch(() => {
  process.exit(1);
});
