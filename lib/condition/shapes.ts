export const SHAPES = `
@prefix csp:   <http://vocab.deri.ie/csp#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix sh: <http://www.w3.org/ns/shacl#>.
@prefix tree: <https://w3id.org/tree#>.
@prefix rdfl: <https://w3id.org/rdf-lens/ontology#>.

[ ] a sh:NodeShape;
  sh:targetClass _:rdfThing;
  sh:property [
    sh:path ( );
    sh:datatype xsd:iri;
    sh:maxCount 1;
    sh:minCount 1;
    sh:name "entry";
  ], [
    sh:path ( );
    sh:class rdfl:CBD;
    sh:maxCount 1;
    sh:minCount 1;
    sh:name "quads";
  ].

[ ] a sh:NodeShape;
  sh:targetClass csp:And;
  sh:property [
    sh:path csp:and;
    sh:class rdfl:TypedExtract;
    sh:minCount 1;
    sh:name "items";
  ].

[ ] a sh:NodeShape;
  sh:targetClass csp:Or;
  sh:property [
    sh:path csp:or;
    sh:class rdfl:TypedExtract;
    sh:minCount 1;
    sh:name "items";
  ].

[] a sh:NodeShape;
  sh:targetClass csp:MaxCount;
  sh:property [
    sh:path csp:val;
    sh:datatype xsd:integer;
    sh:minCount 1;
    sh:maxCount 1;
    sh:name "count";
  ], [
    sh:path csp:reset;
    sh:datatype xsd:boolean;
    sh:maxCount 1;
    sh:name "reset_on_poll";
  ].
  

[ ] a sh:NodeShape;
  sh:targetClass csp:Condition;
  sh:property [
    sh:path tree:relationType;
    sh:datatype xsd:iri;
    sh:maxCount 1;
    sh:minCount 1;
    sh:name "relationType";
  ], [
    sh:path tree:path;
    sh:class _:rdfThing;
    sh:maxCount 1;
    sh:minCount 1;
    sh:name "pathQuads";
  ], [
    sh:path tree:path;
    sh:class rdfl:PathLens;
    sh:maxCount 1;
    sh:minCount 1;
    sh:name "path";
  ], [
    sh:path tree:value;
    sh:datatype xsd:string;
    sh:maxCount 1;
    sh:name "value";
  ], [
    sh:path tree:compareType;
    sh:datatype xsd:string;
    sh:name "compareType";
    sh:maxCount 1;
    sh:in ("string" "date" "integer" "float");
  ].
`;
