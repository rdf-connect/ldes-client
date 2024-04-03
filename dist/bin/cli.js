#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const process = require("process");
const client_1 = require("../lib/client");
const config_1 = require("../lib/config");
const commander_1 = require("commander");
const n3_1 = require("n3");
const program = new commander_1.Command();
let paramURL = "";
let paramFollow = false;
let after;
let before;
let paramPollInterval;
let urlIsView = false;
let noShape = false;
let shapeFiles;
let ordered = "none";
let quiet = false;
let verbose = false;
let save;
let onlyDefaultGraph = false;
let loose = false;
let basicAuth;
program
    .arguments("<url>")
    .addOption(new commander_1.Option("-o --ordered <ordered>", "emit members in order")
    .choices(["ascending", "descending", "none"])
    .default("none"))
    .option("-f, --follow", "follow the LDES, the client stays in sync")
    .option("--after <after>", "follow only relations including members after a certain point in time")
    .option("--before <before>", "follow only relations including members before a certain point in time")
    .option("--poll-interval <number>", "specify poll interval")
    .option("--shape-files [shapeFiles...]", "specify a shapefile")
    .option("--no-shape", "don't extract members with a shape (only use cbd and named graphs)")
    .option("--only-default-graph", "extract members only from the default graph and the member graph")
    .option("-s, --save <path>", "filepath to the save state file to use, used both to resume and to update")
    .option("-l --loose", "use loose implementation, might work on more ldes streams")
    .option("--url-is-view", "the url is the view url, don't try to find the correct view")
    .option("-q --quiet", "be quiet")
    .option("-v --verbose", "be verbose")
    .option("--basic-auth <username>:<password>", "HTTP basic auth information")
    .action((url, program) => {
    urlIsView = program.urlIsView;
    noShape = !program.shape;
    save = program.save;
    paramURL = url;
    shapeFiles = program.shapeFiles;
    paramFollow = program.follow;
    paramPollInterval = program.pollInterval;
    ordered = program.ordered;
    quiet = program.quiet;
    verbose = program.verbose;
    loose = program.loose;
    onlyDefaultGraph = program.onlyDefaultGraph;
    basicAuth = program.basicAuth;
    if (program.after) {
        if (!isNaN(new Date(program.after).getTime())) {
            after = new Date(program.after);
        }
        else {
            console.error(`--after ${program.after} is not a valid date`);
            process.exit();
        }
    }
    if (program.before) {
        if (!isNaN(new Date(program.before).getTime())) {
            before = new Date(program.before);
        }
        else {
            console.error(`--before ${program.before} is not a valid date`);
            process.exit();
        }
    }
});
program.parse(process.argv);
async function main() {
    const client = (0, client_1.replicateLDES)((0, config_1.intoConfig)({
        loose,
        noShape,
        polling: paramFollow,
        url: paramURL,
        stateFile: save,
        follow: paramFollow,
        pollInterval: paramPollInterval,
        fetcher: { maxFetched: 2, concurrentRequests: 10 },
        urlIsView: urlIsView,
        shapeFiles,
        onlyDefaultGraph,
        after,
        before,
        basicAuth,
    }), undefined, undefined, ordered);
    if (verbose) {
        client.on("fragment", () => console.error("Fragment!"));
    }
    const reader = client.stream({ highWaterMark: 10 }).getReader();
    let el = await reader.read();
    let count = 0;
    while (el) {
        if (el.value) {
            count += 1;
            if (!quiet) {
                if (verbose) {
                    console.log(new n3_1.Writer().quadsToString(el.value.quads));
                }
                if (count % 100 == 1) {
                    console.error("Got member", count, "with", el.value.quads.length, "quads");
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
main().catch(console.error);
