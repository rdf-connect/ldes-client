# The tests

Ha! The most exciting part of the repository! Welcome!

Looking for performance tests? Then you should check the [/perf](/perf) folder.

We’ve made tests for various parts of the LDES client:

## 1. LDES context

### 1.1 Given a URL, detect what’s the event stream and what’s the page IRI

 * Should work with `tree:view`, `dcterms:partOf` and `void:subset``
 * Should work with a URL after redirection

### 1.2 Shape

 * Should extract a SHACL shape when it’s embedded in the page
 * Should extract a SHACL shape when it’s described out of band but linked in the page

### 1.3 Retention policies on a view

 * Should be able to indicate there’s a retention policy and provide the triples as-is

## 2. Extracting members and sending them through the connector architecture

For the member extraction algorithm, we refer to the Extract CBD Shape algorithm’s repository.

## 3. Keeping the state

### 3.1 Keeping state using an HTTP bookkeeper

 * Should be able to replicate and later on synchronize
 * The state should use a LIFO approach after a configurable waterlevel

### 4.2 Keeping the state using a bookmark

This is only possible on LDESes that specifically document the `ldes:timestampPath`.

 * Should be able to replicate and later on synchronize using the documented bookmark

