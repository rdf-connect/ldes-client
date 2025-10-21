import { CBDShapeExtractor } from "extract-cbd-shape";
import { DC, LDES, TREE } from "@treecg/types";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { getObjects, memberFromQuads, getLoggerFor } from "../utils";

import type { Quad, Term } from "@rdfjs/types";
import type { Notifier } from "./modulator";
import type { FetchedPage } from "./pageFetcher";
import { Pool } from "./extractionPool";

const { namedNode } = new DataFactory();

export interface Member {
    id: Term;
    quads: Quad[];
    timestamp?: string | Date;
    isVersionOf?: string;
    type?: Term;
    created?: Date;
}

export type LDESInfo = {
    shape: Term;
    shapeQuads: Quad[];
    extractor: CBDShapeExtractor;
    timestampPath?: Term;
    versionOfPath?: Term;
};

export type ExtractError = {
    type: "extract";
    memberId: Term;
    error: unknown;
};
export type Error = ExtractError;
export type MemberEvents = {
    extracted: Member;
    done: FetchedPage;
    error: Error;
};

interface ExtractionState {
    emitted: ReadonlySet<string>;
}

export class Manager {
    public queued: number = 0;

    private closed = false;
    private resolve?: () => void;
    private ldesUri: Term | null;

    private extractor: CBDShapeExtractor;
    private shapeId?: Term;

    private timestampPath?: Term;
    private isVersionOfPath?: Term;

    private logger = getLoggerFor(this);
    private loose: boolean;

    private pool: Pool;

    constructor(ldesUri: Term | null, info: LDESInfo, loose = false) {
        this.ldesUri = ldesUri;
        this.extractor = info.extractor;
        this.timestampPath = info.timestampPath;
        this.isVersionOfPath = info.versionOfPath;
        this.shapeId = info.shape;
        this.loose = loose;
        this.pool = new Pool(info);

        if (!this.ldesUri) {
            this.logger.debug("new local dump member extractor");
        } else {
            this.logger.debug(
                `new member extractor for ${this.ldesUri.value}:`,
            );
        }
        this.logger.debug(
            `${JSON.stringify({
                extractor: info.extractor.constructor.name,
                shape: info.shape,
                timestampPath: info.timestampPath,
                isVersionOfPath: info.versionOfPath,
            })}`,
        );
    }

    // Extract members found in this page, this does not yet emit the members
    extractMembers<S extends ExtractionState>(
        page: FetchedPage,
        state: S,
        notifier: Notifier<MemberEvents, S>,
    ) {
        const members = this.loose
            ? getObjects(page.data, null, TREE.terms.member, null)
            : getObjects(page.data, this.ldesUri, TREE.terms.member, null);

        const pageCreatedIso = getObjects(
            page.data,
            namedNode(page.url),
            DC.terms.custom("created"),
            null,
        )[0]?.value;
        const pageCreated = pageCreatedIso
            ? new Date(pageCreatedIso)
            : undefined;
        const pageUpdatedIso = getObjects(
            page.data,
            namedNode(page.url),
            DC.terms.modified,
            null,
        )[0];
        const pageUpdated = pageUpdatedIso
            ? new Date(pageUpdatedIso.value)
            : undefined;

        console.log("Extracting", members.length, page.url);

        this.logger.debug(
            `Extracting ${members.length} members for ${page.url}`,
        );

        this.pool
            .extract(
                page.data,
                members.filter((m) => !state.emitted.has(m.value)),
                (q, id) => {
                    const member = this.toMember(id, q);
                    if (member) {
                        if (!this.closed) {
                            notifier.extracted(member, state);
                        }
                    }
                },
            )
            .then(() => {
                console.log("Extracted", members.length, page.url);
                if (!this.closed) {
                    this.logger.debug(`All members extracted for ${page.url}`);
                    page.created = pageCreated;
                    page.updated = pageUpdated;
                    notifier.done(page, state);
                }
            });
    }

    close() {
        this.logger.debug("Closing stream");
        if (this.resolve) {
            this.resolve();
            this.resolve = undefined;
        }
        this.closed = true;
    }

    private async extractMemberQuads(
        member: Term,
        data: RdfStore,
        otherMembers: Term[] = [],
    ): Promise<Quad[]> {
        return await this.extractor.extract(data, member, this.shapeId, [
            namedNode(LDES.custom("IngestionMetadata")),
            ...otherMembers,
        ]);
    }

    private toMember(member: Term, quads: Quad[]): Member | undefined {
        const data = RdfStore.createDefault();
        quads.forEach((q) => data.addQuad(q));
        const created = getObjects(
            data,
            member,
            DC.terms.custom("created"),
            namedNode(LDES.custom("IngestionMetadata")),
        )[0]?.value;

        if (quads.length > 0) {
            return memberFromQuads(
                member,
                quads,
                this.timestampPath,
                this.isVersionOfPath,
                created ? new Date(created) : undefined,
            );
        }
    }

    private async extractMember(
        member: Term,
        data: RdfStore,
        otherMembers: Term[] = [],
    ): Promise<Member | undefined> {
        try {
            const quads: Quad[] = await this.extractMemberQuads(
                member,
                data,
                otherMembers,
            );
            const created = getObjects(
                data,
                member,
                DC.terms.custom("created"),
                namedNode(LDES.custom("IngestionMetadata")),
            )[0]?.value;

            if (quads.length > 0) {
                return memberFromQuads(
                    member,
                    quads,
                    this.timestampPath,
                    this.isVersionOfPath,
                    created ? new Date(created) : undefined,
                );
            }
        } catch (ex) {
            this.logger.error(ex);
            return;
        }
    }
}
