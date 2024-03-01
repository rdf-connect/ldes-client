const Benchmark = require("benchmark");
const suite = new Benchmark.Suite();
const { replicateLDES } = require("../dist/lib/client");
const { intoConfig } = require("../dist/lib/config");
const { Parser } = require("n3");
const { rmSync, read } = require("fs");

// Add listeners
suite
  .on('cycle', function(event) {
    console.log(String(event.target));
  })
  .on('complete', function() {
    console.log('Benchmark of ldes-client is completed.');
  });

// Add benchmarks
suite
  .add("descending tree, emits ordered", async function() {
    let client = await replicateLDES(
      intoConfig({
        url: "https://www.pieter.pm/dcat/sweden/feed.ttl",
        fetcher: { maxFetched: 1, concurrentRequests: 1 },
        mediator: { maxRequests: 1, maxMembers: 1, },
      }),
      undefined,
      undefined,
      "descending",
    );
   
  })
  // Add more benchmarks if needed

// Run the benchmarks
.run({ 'async': true });