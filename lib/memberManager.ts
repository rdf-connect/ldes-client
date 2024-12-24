import { Quad, Term } from "@rdfjs/types";
import { Fragment, Member } from "./page";
import { FetchedPage } from "./pageFetcher";
import { CBDShapeExtractor } from "extract-cbd-shape";
import { DC, LDES, TREE } from "@treecg/types";
import { LDESInfo } from "./client";
import { getObjects, memberFromQuads, Notifier } from "./utils";
import { RdfStore } from "rdf-stores";
import { getLoggerFor } from "./utils/logUtil";
import { DataFactory } from "n3";

const { namedNode } = DataFactory;

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

export class Manager {
    public queued: number = 0;

    private closed = false;
    private resolve?: () => void;
    private ldesId: Term;

    private state: Set<string>;
    private extractor: CBDShapeExtractor;
    private shapeId?: Term;

    private timestampPath?: Term;
    private isVersionOfPath?: Term;

    private logger = getLoggerFor(this);

    constructor(ldesId: Term, state: Set<string>, info: LDESInfo) {
        this.ldesId = ldesId;
        this.state = state;
        this.extractor = info.extractor;
        this.timestampPath = info.timestampPath;
        this.isVersionOfPath = info.isVersionOfPath;
        this.shapeId = info.shape;

        this.logger.debug(
            `new ${ldesId.value} ${JSON.stringify({
                extractor: info.extractor.constructor.name,
                shape: info.shape,
                timestampPath: info.timestampPath,
                isVersionOfPath: info.isVersionOfPath,
            })}`,
        );
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
                    {id: namedNode(page.url), created: pageCreated, updated: pageUpdated},
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
