# Performance tests for the LDES client

## Datasets

TODO 

## Tests

Special flags cannot be used in the tests. An LDES client MUST be able to work without any extra information.

### 1. Replication velocity

Client config:
 1. Unordered
 2. Ordered

###  2. From an existing state, catch up with a feed

Pre-configures a state on different existing LDESes, and tests performance of catching up with the feed.