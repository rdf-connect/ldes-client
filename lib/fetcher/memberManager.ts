import { CBDShapeExtractor } from "extract-cbd-shape";
import { DC, LDES, TREE } from "@treecg/types";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { getObjects, memberFromQuads, getLoggerFor } from "../utils";

import type { Quad, Term } from "@rdfjs/types";
import type { Notifier } from "./modulator";
import type { FetchedPage } from "./pageFetcher";

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
    private ldesId: Term | null;

    private extractor: CBDShapeExtractor;
    private shapeId?: Term;

    private timestampPath?: Term;
    private isVersionOfPath?: Term;

    private logger = getLoggerFor(this);

    constructor(ldesId: Term | null, info: LDESInfo) {
        this.ldesId = ldesId;
        this.extractor = info.extractor;
        this.timestampPath = info.timestampPath;
        this.isVersionOfPath = info.versionOfPath;
        this.shapeId = info.shape;

        if (!this.ldesId) {
            this.logger.debug(
                `new local dump member extractor ${JSON.stringify({
                    extractor: info.extractor.constructor.name,
                    shape: info.shape,
                    timestampPath: info.timestampPath,
                    isVersionOfPath: info.versionOfPath,
                })}`
            );
        } else {
            this.logger.debug(
                `new member extractor for ${this.ldesId.value} ${JSON.stringify({
                    extractor: info.extractor.constructor.name,
                    shape: info.shape,
                    timestampPath: info.timestampPath,
                    isVersionOfPath: info.versionOfPath,
                })}`,
            );
        }
    }

    // Extract members found in this page, this does not yet emit the members
    extractMembers<S extends ExtractionState>(
        page: FetchedPage,
        state: S,
        notifier: Notifier<MemberEvents, S>,
    ) {
        const members = getObjects(
            page.data,
            this.ldesId,
            TREE.terms.member,
            null,
        );

        const pageCreatedIso = getObjects(
            page.data,
            namedNode(page.url),
            DC.terms.custom("created"),
            null,
        )[0]?.value;
        const pageCreated = pageCreatedIso ? new Date(pageCreatedIso) : undefined;
        const pageUpdatedIso = getObjects(
            page.data,
            namedNode(page.url),
            DC.terms.modified,
            null,
        )[0];
        const pageUpdated = pageUpdatedIso ? new Date(pageUpdatedIso.value) : undefined;

        this.logger.debug(`Extracting ${members.length} members for ${page.url}`);

        const promises: Promise<Member | undefined | void>[] = [];

        for (const member of members) {
            if (!state.emitted.has(member.value)) {
                const promise = this.extractMember(member, page.data)
                    .then((member) => {
                        if (member) {
                            if (!this.closed) {
                                notifier.extracted(member, state);
                            }
                        }
                        return member;
                    })
                    .catch((ex) => {
                        this.logger.error(ex);
                        notifier.error(
                            { error: ex, type: "extract", memberId: member },
                            state,
                        );
                    });

                promises.push(promise);
            }
        }

        Promise.all(promises).then(() => {
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

    /// Only listen to this promise if a member is queued
    reset(): Promise<void> {
        this.logger.debug(`Resetting with ${this.queued} members in queue`);

        this.queued = 0;
        return new Promise((res) => (this.resolve = res));
    }

    private async extractMemberQuads(
        member: Term,
        data: RdfStore,
    ): Promise<Quad[]> {
        return await this.extractor.extract(data, member, this.shapeId, [namedNode(LDES.custom("IngestionMetadata"))]);
    }

    private async extractMember(
        member: Term,
        data: RdfStore,
    ): Promise<Member | undefined> {
        try {
            const quads: Quad[] = await this.extractMemberQuads(member, data);
            const created = getObjects(
                data, 
                member, 
                DC.terms.custom("created"), 
                namedNode(LDES.custom("IngestionMetadata"))
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
