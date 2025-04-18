import { DataFactory } from "rdf-data-factory";
import { SDS } from "@treecg/types";
import { Writer as NWriter } from "n3";
import { replicateLDES } from "./client";
import { enhanced_fetch } from "./fetcher"
import { processConditionFile } from "./condition";
import { getLoggerFor } from "./utils";

import type { Writer } from "@rdfc/js-runner";
import type { Quad_Object } from "@rdfjs/types";
import type { Ordered } from "./strategy";

const df = new DataFactory();

export async function processor(
    writer: Writer<string>,
    url: string,
    before?: Date,
    after?: Date,
    ordered?: string,
    follow?: boolean,
    pollInterval?: number,
    shape?: string,
    noShape?: boolean,
    save?: string,
    loose?: boolean,
    urlIsView?: boolean,
    fetch_config?: {
        auth?: {
            type: "basic";
            auth: string;
            host: string;
        };
        concurrent?: number;
        retry?: {
            codes: number[];
            maxRetries: number;
        };
    },
    condition?: string,
    materialize?: boolean,
    lastVersionOnly?: boolean,
    streamId?: string,
) {
    const logger = getLoggerFor("processor");
    const t0 = Date.now();

    if (fetch_config?.auth) {
        fetch_config.auth.host = new URL(url).host;
    }

    const client = replicateLDES(
        {
            loose,
            noShape,
            shapeFile: shape,
            polling: follow,
            url: url,
            stateFile: save,
            pollInterval: pollInterval,
            urlIsView,
            after,
            before,
            fetch: fetch_config ? enhanced_fetch(fetch_config) : fetch,
            materialize,
            lastVersionOnly,
            condition: await processConditionFile(condition),
        },
        <Ordered>ordered || "none",
        undefined,
        streamId ? df.namedNode(streamId) : undefined,
    );

    const reader = client.stream({ highWaterMark: 10 }).getReader();

    client.on("fragment", async (fragment) => {
        logger.verbose(`Got fragment: ${fragment.url}`);
    });

    writer.on("end", async () => {
        await reader.cancel();
        logger.info("Writer closed, so closing reader as well.");
    });

    return async () => {
        let memCount = 0;
        let el = await reader.read();

        while (el) {
            if (el.value) {
                memCount += 1;

                if (memCount % 100 === 0) {
                    logger.verbose(
                        `Got member number ${memCount} with ID ${el.value.id.value} and ${el.value.quads.length} quads`,
                    );
                }

                const blank = df.blankNode();
                const quads = el.value.quads.slice();
                quads.push(
                    df.quad(
                        blank,
                        SDS.terms.stream,
                        <Quad_Object>client.streamId!,
                        SDS.terms.custom("DataDescription"),
                    ),
                    df.quad(
                        blank,
                        SDS.terms.payload,
                        <Quad_Object>el.value.id!,
                        SDS.terms.custom("DataDescription"),
                    ),
                );

                await writer.push(new NWriter().quadsToString(quads));
            }

            if (el.done) {
                break;
            }

            el = await reader.read();
        }

        logger.verbose(`Found ${client.memberCount} members in ${client.fragmentCount} fragments (took ${Date.now() - t0} ms)`);

        // We extracted all members, so we can close the writer
        await writer.end();

        return client;
    };
}
