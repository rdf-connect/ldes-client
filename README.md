# The LDES client

[![NodeJS CI](https://github.com/rdf-connect/ldes-client/actions/workflows/ci-tests.yml/badge.svg)](https://github.com/rdf-connect/ldes-client/actions/workflows/ci-tests.yml) [![npm](https://img.shields.io/npm/v/ldes-client.svg?style=popout)](https://npmjs.com/package/ldes-client)

This package provides a reference implementation of a [Linked Data Event Stream (LDES)](https://w3id.org/ldes/specification) client.

The main functionality is to extract/replicate members within an LDES, and keeping in-sync with it. This library can be used also as a [RDF-Connect](https://rdf-connect.github.io/) processor to build more complex data processing pipelines.

Install the package using: 
```bash
npm install -g ldes-client
```

## Replication and synchronization

The LDES client has two modes: replicate and sync. Both are accessable view the ldes-client command line interface (CLI).

```bash
ldes-client <url> [--follow] [--ordered <order>] [--after <datetime>] [--before <datetime>] [--save <path>] [--poll-interval <number>] [--basic-auth <username>:<password>] [--shape-file <shapeFile>] [--only-default-graph] [--no-shape] [--materialize] [--last-version-only] [--default-timezone <timezone>] [--condition <conditionFile>] [--concurrent <number>] [--retry-count <number>] [--http-codes codes...] [--url-is-view] [--loose] [--quiet] [--metadata]
```

### CLI options

- `-f` `--follow`: follow the LDES, the client stays in sync
- `-o` `--ordered`: temporal order of member emission based on the `ldes:timestampPath` value (if any). `none|ascending|descending` Default: `none`.
- `--before`: emit only members timestamped before (exclusive) the given timestamp. 
- `--after`: emit only members timestamped after (exclusive) the given timestamp. 
- `-s` `--save`: filepath to the save state file to use, used both to resume and to update.
- `--poll-interval`: time to wait between polling cycles of the LDES. This property applies only when the client is following the LDES.
- `--basic-auth`: user and password for HTTP basic authentication.
- `--shape-file`: shape file (local or remote via URL) to which LDES members should conform (overwrites LDES configured shape if any).
- `--only-default-graph`: the client will consider only the default graph (and the member graph if so) for extracting member triples.
- `--no-shape`: the client ignores any shape defined in the LDES and extracts members based on CBD (Concise Bounded Description) or named graph bounds. 
- `--materialize`: the client emits the canonical version of every member, based on the `ldes:versionOfPath` property value.
- `--last-version-only`: the clients emits only the latest version of every member.
- `-t` `--default-timezone`: default timezone to use for dates in tree:InBetweenRelation. `AoE|Z|±HH:mm` Default: `AoE`.
- `--condition`: filter the LDES stream to only emit members that adhere to this condition.
- `--url-is-view`: informs the client that the given URL corresponds already to a `tree:view` avoiding the client to fail when no declared view is found. 
- `-l` `--loose`: the client is less strict when following `tree:relation` properties and ignores if the page URL does not correspond to the `tree:Node` IRI.
- `-q` `--quiet`: the client does not print the extracted members in the console when run via the CLI.
- `--concurrent`: maximum number of concurrent HTTP request that the client can make.
- `--retry-count`: maximum number of HTTP request retries that the client would perform before failing.
- `--http-codes`: list of HTTP response codes over which the client would retry a request.
- `-m`, `--metadata`: include metadata in the emitted members. Notifies the ldes server that it is interested in metadata, via the HTTP header `Accept: application/metadata+trig`.

### Use it as a library

You can also use the `ldes-client` programatically as a library in your TS/JS projects as follows:

```typescript
import { replicateLDES, intoConfig } from "ldes-client";

async function main() {
  const ldesClient = replicateLDES(intoConfig({
    url: "http://my.ldes.org",
    materialize: true,
    ...
  }));

  const memberReader = ldesClient.stream({ highWaterMark: 10 }).getReader();
  let member = await memberReader.read();

  while (member) {
    // Do something with the member
    // ...
    // Read the next member
    member = await memberReader.read();

    if (member.done) {
      break;
    }
  }
}

main().catch((err) => {console.error(err)});
```

### `ldes-client` in an RDF-Connect pipeline

The `ldes-client` is also implemented as an RDF-Connect processor (see the semantic definition at [processor.ttl](https://github.com/rdf-connect/ldes-client/blob/main/processor.ttl) and the implementation at [`lib/rdf-connect.ts`](https://github.com/rdf-connect/ldes-client/blob/main/lib/rdfc-processor.ts)) and may be used in a pipeline as follows:

```turtle
@prefix rdfc: <https://w3id.org/rdf-connect#>.
@prefix owl: <http://www.w3.org/2002/07/owl#>.

### Import the processor definitions
<> owl:imports <./node_modules/@rdfc/js-runner/index.ttl>.
<> owl:imports <./node_modules/ldes-client/processors.ttl>.

### Define the channels your processor needs
<members> a rdfc:Reader, rdfc:Writer.

### Attach the processor to the pipeline under the e.g., the rdfc:NodeRunner
<> a rdfc:Pipeline;
    rdfc:consistsOf [
        rdfc:instantiates rdfc:NodeRunner;
        rdfc:processor <ldes-client>
    ].

### Define and configure the processor
<ldes-client> a rdfc:LdesClient;
    rdfc:url <http://my.ldes.org>;
    rdfc:output <members>;
    rdfc:follow true;
    ...
```

## Conditions

When passing a condition file to the `ldes-client` CLI, the expected content is a condition where the subject is the file itself.


### Simple condition
```turtle
@prefix csp: <http://vocab.deri.ie/csp#>.
@prefix tree: <https://w3id.org/tree#>.
<> a csp:Condition;
    # Type of relation to filter on
    tree:relationType tree:GreaterThanOrEqualToRelation;
    # Path to extract values for the filter
    tree:path <http://def.isotc211.org/iso19156/2011/Observation#OM_Observation.resultTime>;
    # Alpha value for comparison
    tree:value "2024-01-14T08:35:35.720Z";
    tree:compareType "date".
```

### And condition
```turtle
@prefix csp: <http://vocab.deri.ie/csp#>.
@prefix tree: <https://w3id.org/tree#>.
<> a csp:And;
  csp:and [
    a csp:Condition;
    tree:relationType tree:GreaterThanOrEqualToRelation;
    tree:path <http://def.isotc211.org/iso19156/2011/Observation#OM_Observation.resultTime>;
    tree:value "2024-01-14T08:35:35.720Z"
    tree:compareType "date";
  ];
  csp:and [
    a csp:Condition;
    tree:relationType tree:LessThanRelation;
    tree:path <http://def.isotc211.org/iso19156/2011/Observation#OM_Observation.resultTime>;
    tree:value "2024-01-15T08:35:35.720Z"
    tree:compareType "date";
  ].
```

### Or condition
```turtle
@prefix sh: <http://www.w3.org/ns/shacl#>.
@prefix sosa: <http://www.w3.org/ns/sosa/>.
@prefix as: <https://www.w3.org/ns/activitystreams#>.
@prefix owl: <http://www.w3.org/2002/07/owl#>.
@prefix csp:   <http://vocab.deri.ie/csp#> .
@prefix tree: <https://w3id.org/tree#>.

<> a csp:Or;
  csp:or [
    a csp:Condition;
    tree:relationType tree:EqualToRelation;
    tree:value ex:sensor1;
    tree:path ( sosa:madeBySensor [ sh:inversePath sosa:hosts ] );
  ];
  csp:or [
    a csp:Condition;
    tree:relationType tree:EqualToRelation;
    tree:value ex:sensor2;
    tree:path ( sosa:madeBySensor [ sh:inversePath sosa:hosts ] );
  ].
```

## Use cases

These are some of the use cases for which the `ldes-client` can be used:

- I want to replicate all data as fast as possible. This takes a long time so I want this to be fault tolerant and be able to stop and resume later to stay in sync.
- I want to stay up to date with all entities present in a dataset (published as an LDES). For this, I don't care about old data, only the newest data per entity is required. And stay in sync later.
  - It is acceptable that some data is emitted twice, as long as the timestamp is in the correct order.
  - It is not acceptable that some data is emitted twice. If an entity is re-emitted, the entity is changed at this instance.
- I want to do timeseries analysis, for this I want all data in order, according to their timestamp path. I want options to resume, and later stay in sync.

## Software architecture

The client contains two parts, fetching the fragments and emitting the members.
Use cases have different influences on these parts.

For example:
  - the time series analysis wants to fetch pages first that contain older members, the member emitter only wants to emit a member when the oldest page has been found.
  - emitting latest versions is the inverse, first fetch the youngest pages, so some members can already be emitted.

Difficulties:
- the member emitter needs to know what the fragment fetcher is doing (did it know that the oldest page is fetched?).
- how do we handle unbouned size?
  - Keeping state of emitted members is unbounded
  - Keeping state of visited pages is unbounded
  These are also influenced by the configuration.

### Fragment Fetcher

The fragment fetcher fetches the fragments. These fragments are targeted by relation chains, but only two types exist, important and not important. For example, when emitting members in order, the important relations are the GreaterThan relations, because all other relation types are equivalent, that is to say, we can only emit members when all unimportant relations are fetched and processed.

Relation Chains are chains, because when you fetch a page, you can find new relations pointing from that page. But we need to distinguish between a relation after an important relation or a relation after an unimportant relation.
Important relations squash unimportant relations, these chains should only be fetched if all unimportant relations are done.
Unimportant relations squash other unimportant relations. Important relations squash other important relations, the new _value_ is the bigger value of the two.
The ordering of these chains is thus, first unimportant relations, then important relations ordered on value.

These chains dictate the order that pages should be fetched.
Because fetching is asynchronous, we can only interpret a page, if no pages are in flight, that came from a smaller relation. In code this is managed by a `Modulator` ([`lib/fetcher/modulator.ts`](https://github.com/rdf-connect/ldes-client/blob/main/lib/fetcher/modulator.ts)) instance.

**Fault tolerance**

The fetcher tries to be tault tolerant. HTTP codes that indicate that the server is overloaded or something else is going wrong are caught and retried, following an exponential back-off strategy.
This is the default behaviour when the provided config does not provide a fetch function.

Caught HTTP codes:

- 408: Request timeout
- 425: Too Early
- 429: Too Many requests
- 500: Internal Server Error
- 502: Bad Gateway
- 503: Service Unavailable
- 504: Gateway Timeout

```typescript
// Provide your own codes with a custom retry function
config.fetch = enhanced_fetch({ retry: { codes: [408, 425, 429, 500, 502, 503, 504] } });
```

### Member Manager

The member manager _just_ extracts members and emits them when they are ready.
Extracting members is asynchonous, because it is possible that some members require out of band requests.

The streaming API comes with a requirement to always emit at least one member, per poll.
To achieve this, the `memberManager` has a function called `reset()` which returns a promise when a member is emitted.


## Expected Features

 * Use view that is indicated as EventSource
 * conformance tests and test cases


## Authors and license

 - Tests and design: Pieter Colpaert
 - Actual implementation: Arthur Vercruysse, Ieben Smessaert, Julián Rojas

© 2025 -- Ghent University - IMEC. MIT license
