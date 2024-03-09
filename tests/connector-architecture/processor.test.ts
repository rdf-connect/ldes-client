import { describe, expect, test } from "@jest/globals";
import { extractProcessors, extractSteps, Source } from "@ajuvercr/js-runner";

describe("Tests for js:LdesClient processor", async () => {
    const pipeline = `
        @prefix js: <https://w3id.org/conn/js#>.
        @prefix ws: <https://w3id.org/conn/ws#>.
        @prefix : <https://w3id.org/conn#>.
        @prefix owl: <http://www.w3.org/2002/07/owl#>.
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
        @prefix sh: <http://www.w3.org/ns/shacl#>.

        <> owl:imports <./node_modules/@ajuvercr/js-runner/ontology.ttl>, <./processor.ttl>.

        [ ] a :Channel;
            :writer <jw>.
        <jw> a js:JsWriterChannel.
    `;

    const baseIRI = process.cwd() + "/config.ttl";

    test("js:LdesClient is properly defined", async () => {
        const proc = `
            [ ] a js:LdesClient;
                js:output <jw>;
                js:url <https://era.ilabt.imec.be/rinf/ldes>;
                js:before "2025-01-01T00:00:00.000Z"^^xsd:dateTime;
                js:after "2023-12-31T23:59:59.000Z"^^xsd:dateTime;
                js:ordered "ascending";
                js:follow true;
                js:interval 5;
                js:shapeFile </path/to/shape.ttl>;
                js:noShape false;
                js:savePath </state/save.json>;
                js:loose false;
                js:urlIsView false;
                js:verbose true.
        `;

        const source: Source = {
            value: pipeline + proc,
            baseIRI,
            type: "memory",
        };

        const { processors, quads, shapes: config } = await extractProcessors(source);

        const env = processors.find((x) => x.ty.value === "https://w3id.org/conn/js#LdesClient")!;
        expect(env).toBeDefined();

        const argss = extractSteps(env, quads, config);
        expect(argss.length).toBe(1);
        expect(argss[0].length).toBe(13);

        const [[
            output, url, before, after, ordered, follow, pollInterval, shapeFile, 
            noShape, savePath, loose, urlIsView, verbose
        ]] = argss;
        
        testWriter(output);
        expect(url).toBe("https://era.ilabt.imec.be/rinf/ldes");
        expect(before.toISOString()).toBe("2025-01-01T00:00:00.000Z");
        expect(after.toISOString()).toBe("2023-12-31T23:59:59.000Z");
        expect(ordered).toBe("ascending");
        expect(follow).toBeTruthy();
        expect(pollInterval).toBe(5);
        expect(shapeFile).toBe("/path/to/shape.ttl");
        expect(noShape).toBeFalsy();
        expect(savePath).toBe("/state/save.json");
        expect(loose).toBeFalsy();
        expect(urlIsView).toBeFalsy();
        expect(verbose).toBeTruthy();

        await checkProc(env.file, env.func);
    });
});

function testWriter(arg: any) {
    expect(arg).toBeInstanceOf(Object);
    expect(arg.channel).toBeDefined();
    expect(arg.channel.id).toBeDefined();
    expect(arg.ty).toBeDefined();
}

async function checkProc(location: string, func: string) {
    const mod = await import("file://" + location);
    expect(mod[func]).toBeDefined();
}