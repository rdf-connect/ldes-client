# The LDES client

This package provides common tooling to work with LDESes.

The main functionality is to replicate an LDES, and keeping in-sync with it. It pipes the result to another processor complying to the connector architecture.

Install the package using `npm install -g ldes-client`

## Replication and synchronization

The LDES client has two modes: sync and replicate. Both are accessable view the ldes-client command.

```bash
ldes-client <url> [-f] [--save <path>] [--pollInterval <number>] [--shape <shapefile>]  
```

### Flags

- `-f` `--follow`: follow the LDES, the client stays in sync
- `-s` `--save`: filepath to the save file to use, used both to resume and to update
- `--pollInterval`: time to wait between polling the LDES when the client is following the LDES.
- `--shape`: shape file to which LDES members should conform (overwrite LDES configured shape)
- Others soon comming


You can also use this as a library in your TS/JS projects. See the [client.ts](lib/client.ts) file for documentation.

## Use cases

- I want to replicate all data as fast as possible. This takes a long time so I want options to resume, and later stay in sync.
- I want to stay up to date to all entities that are present in the data. For this, I don't care about old data, only the newest data per entity is required. And stay in sync later.
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
- the member emitter needs to know what the fragment fetcher is doing (did it know that the oldest page is fetched).
- how do we handle unbouned size?
  - Keeping state of emitted members is unbounded
  - Keeping state of visited pages is unbounded
  These are also influenced by the configuration.


## Expected Features

 * Use view that is indicated as EventSource
 * Unit tests, performance tests, integration tests and conformance tests.
 * Use the client as a library
 * Use the client to pipe members to stdout for testing purposes
 * Use the client with the connector architecture 
 * Provide a json object (or file) denoting the expected connector architecture channel to write to.
 * Maybe add little feature flag to indicate that you only want to follow greaterThan relations.
 * Add flag 'keep all state', default value would only keep some seen page id's to conserve memory
 * Flag to indicate, don't store the emitted members, this is the default only if an EventSource is found
 * Overwrite Shacl insead of the LDES provided shape


## Other tooling available from this repository

 * A TREE/LDES hypermedia extractor
 * A class comparing and ordering links based on the tree:Relation spec


## Authors and license

 - Tests and design: Pieter Colpaert
 - Actual implementation: Arthur Vercruysse

© 2023 -- Ghent University - IMEC. MIT license
