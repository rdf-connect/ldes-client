import { CBDShapeExtractor } from "extract-cbd-shape";
import { RDF, DC, LDES, TREE } from "@treecg/types";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { getObjects, getLoggerFor } from "../utils";

import type { Quad, Term, Quad_Subject, Quad_Predicate } from "@rdfjs/types";
import type { Notifier } from "./modulator";
import type { Fragment, Member } from "./page";
import type { FetchedPage } from "./pageFetcher";

const { quad, namedNode, defaultGraph } = new DataFactory();

export type LDESInfo = {
    shape: Term;
    extractor: CBDShapeExtractor;
    timestampPath?: Term;
    versionOfPath?: Term;
};

export interface Options {
    ldesId?: Term;
    shapeId?: Term;
    callback?: (member: Member) => void;
    extractor?: CBDShapeExtractor;
}

export type ExtractedMember = {
    member: Member;
};

export type ExtractError = {
    type: "extract";
    memberId: Term;
    error: unknown;
};
export type Error = ExtractError;
export type MemberEvents = {
    extracted: Member;
    done: Fragment;
    error: Error;
};

export function memberFromQuads(
    member: Term,
    quads: Quad[],
    timestampPath: Term | undefined,
    isVersionOfPath: Term | undefined,
    created?: Date,
): Member {
    // Get timestamp
    let timestamp: string | Date | undefined;
    if (timestampPath) {
        const ts = quads.find(
            (x) =>
                x.subject.equals(member) && x.predicate.equals(timestampPath),
        )?.object.value;
        if (ts) {
            try {
                timestamp = new Date(ts);
            } catch (ex: unknown) {
                timestamp = ts;
            }
        }
    }

    // Get isVersionof
    let isVersionOf: string | undefined;
    if (isVersionOfPath) {
        isVersionOf = quads.find(
            (x) =>
                x.subject.equals(member) && x.predicate.equals(isVersionOfPath),
        )?.object.value;
    }

    // Get type
    const type: Term | undefined = quads.find(
        (x) => x.subject.equals(member) && x.predicate.value === RDF.type,
    )?.object;
    return { quads, id: member, isVersionOf, timestamp, type, created };
}

/**
 * Version materialization function that sets the declared ldes:versionOfPath property value
 * as the member's subject IRI
 */
export function maybeVersionMaterialize(
    member: Member,
    materialize: boolean,
    ldesInfo: LDESInfo,
): Member {
    if (materialize && ldesInfo.versionOfPath) {
        // Create RDF store with member quads
        const memberStore = RdfStore.createDefault();
        member.quads.forEach((q) => memberStore.addQuad(q));
        // Get materialized subject IRI
        const newSubject = getObjects(
            memberStore,
            member.id,
            ldesInfo.versionOfPath,
        )[0];
        if (newSubject) {
            // Remove version property
            memberStore.removeQuad(
                quad(
                    <Quad_Subject>member.id,
                    <Quad_Predicate>ldesInfo.versionOfPath,
                    newSubject,
                    defaultGraph(),
                ),
            );
            // Updated all quads with materialized subject
            for (const q of memberStore.getQuads(member.id)) {
                const newQ = quad(
                    <Quad_Subject>newSubject,
                    q.predicate,
                    q.object,
                    q.graph,
                );
                memberStore.removeQuad(q);
                memberStore.addQuad(newQ);
            }
            // Update member object
            member.id = newSubject;
            member.quads = memberStore.getQuads();
        } else {
            console.error(
                `No version property found in Member (${member.id}) as specified by ldes:isVersionOfPath ${ldesInfo.versionOfPath}`,
            );
        }
    }

    return member;
}

export class Manager {
    public queued: number = 0;

    private closed = false;
    private resolve?: () => void;
    private ldesId: Term | null;

    private state: Set<string>;
    private extractor: CBDShapeExtractor;
    private shapeId?: Term;

    private timestampPath?: Term;
    private isVersionOfPath?: Term;

    private logger = getLoggerFor(this);

    constructor(ldesId: Term | null, state: Set<string>, info: LDESInfo) {
        this.ldesId = ldesId;
        this.state = state;
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
    extractMembers<S>(
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

        this.logger.debug(`Extracting ${members.length} members`);

        const promises: Promise<Member | undefined | void>[] = [];

        for (const member of members) {
            if (!this.state.has(member.value)) {
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

        Promise.all(promises).then((members) => {
            this.logger.debug("All members extracted");
            if (!this.closed) {
                notifier.done(
                    { id: namedNode(page.url), created: pageCreated, updated: pageUpdated },
                    state,
                );
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
        this.logger.debug("this.resolve()");
    }

    length(): number {
        return this.state.size;
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
        if (this.state.has(member.value)) return;

        try {
            const quads: Quad[] = await this.extractMemberQuads(member, data);
            const created = getObjects(data, member, DC.terms.custom("created"), namedNode(LDES.custom("IngestionMetadata")))[0]?.value;

            if (quads.length > 0) {
                this.state.add(member.value);
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
