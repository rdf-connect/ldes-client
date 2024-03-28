const Benchmark = require("benchmark");
const { replicateLDES } = require("../dist/lib/client");
const { intoConfig } = require("../dist/lib/config");
const { Tree } = require("../tests/helper");
const { Parser } = require("n3");
const { TREE } = require("@treecg/types");

const tree = new Tree(
  (x, numb) => {
    console.log("x", x, "numb", numb);
    if (!numb) {
      return new Parser().parse(`<${x}> <http://example.com/value> 0.`);
    } else {
      return new Parser().parse(`<${x}> <http://example.com/value> ${numb}.`);
    }
  },
  "http://example.com/value",
);

function wide_tree(depth, width, node, member, delay, memberCount) {
  if (depth == 0) return;

  const newId = tree.newFragment(delay);
  const frag = tree.fragment(newId);
  tree.fragment(node).relation(newId, TREE.Relation);
  console.log("setting up relation", node, "->", newId);

  for (let i = 0; i < memberCount; i++) {
    frag.addMember("member-" + member, member);
    member += 1;
  }

  for (let i = 0; i < width; i++) {
    member = wide_tree(depth - 1, width, newId, member, delay, memberCount);
  }

  return member;
}

wide_tree(2, 3, tree.root(), 0, 200, 5);
global.fetch = tree.mock();

let concurrent = 0;
async function bench_it() {
  concurrent += 1;
  let client = replicateLDES(
    intoConfig({
      url: tree.base() + tree.root(),
      fetcher: { maxFetched: 1, concurrentRequests: 1 },
      mediator: { maxRequests: 1, maxMembers: 1 },
      onlyDefaultGraph: true,
    }),
    undefined,
    undefined,
    "none",
  );

  const stream = client.stream();
  const members = stream.getReader();

  console.log("concurrent", concurrent);
  let item = await members.read();
  while (item && !item.done) {
    item = await members.read();
  }
  console.log("DONE");
}

const bench = new Benchmark(bench_it, { async: false });
bench.hz = 1;
bench.run({ maxTime: 500, delay: 20 });
