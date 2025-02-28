import { getLoggerFor } from "./utils/logUtil";
import { replicateLDES } from "./client";
import { enhanced_fetch, processConditionFile } from "./utils";
import { DataFactory } from "rdf-data-factory";
import { SDS } from "@treecg/types";
import { Writer as NWriter } from "n3";

import type { Writer } from "@rdfc/js-runner";
import type { Quad_Object } from "@rdfjs/types";
import type { Ordered } from "./client";

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

    client.on("fragment", () => logger.verbose("Fragment!"));

    const reader = client.stream({ highWaterMark: 10 }).getReader();

    writer.on("end", async () => {
        await reader.cancel();
        logger.info("Writer closed, so closing reader as well.");
    });

    return async () => {
        let el = await reader.read();
        const seen = new Set();
        while (el) {
            if (el.value) {
                seen.add(el.value.id);

                if (seen.size % 100 == 1) {
                    logger.verbose(
                        `Got member ${seen.size} with ${el.value.quads.length} quads`,
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

        logger.verbose(`Found ${seen.size} members`);
        
        // We extracted all members, so we can close the writer
        await writer.end();
    };
}
