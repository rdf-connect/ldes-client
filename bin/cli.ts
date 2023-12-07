import * as process from 'process';
import { replicateLDES } from "../lib/client"
import { intoConfig } from '../lib/config';
import { Command } from 'commander';

const program = new Command();
let paramURL: string = ""
let paramFollow: boolean
let paramPollInterval: number

program
    .arguments('<url>')
    .option('-f, --follow', 'follow the LDES, the client stays in sync')
    .option('-s, --save <path>', 'filepath to the save state file to use, used both to resume and to update')
    .option('--pollInterval <number>', 'Specify poll interval')
    .option('--shape <shapefile>', 'Specify a shapefile')
    .action((url: string, program) => {
        paramURL = url;
        paramFollow = program.follow;
        paramPollInterval = program.pollInterval;
        // console.log(paramURL)
        // console.log(program.follow, paramPollInterval)
    });
program.parse(process.argv);

async function main() {
    const client = replicateLDES(
        intoConfig({
            url: paramURL,
            follow: paramFollow,
            pollInterval: paramPollInterval,
            fetcher: { maxFetched: 2, concurrentRequests: 10 },
        }),
        // intoConfig({ url: "http://marineregions.org/feed" }),
    );

    const reader = client.stream({ highWaterMark: 10 }).getReader();
    let el = await reader.read();
    const seen = new Set();
    while (el) {
        if (el.value) {
            seen.add(el.value.id);
            console.log(
                "Got member",
                // el.value.id.value,
                el.value.quads.length,
                "quads",
                seen.size,
            );
        }

        if (el.done) break;

        // await new Promise((res) => setTimeout(res, 100));

        el = await reader.read();
    }
}

main().catch(console.error);
