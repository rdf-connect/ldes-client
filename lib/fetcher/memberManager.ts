import { CBDShapeExtractor } from "extract-cbd-shape";
import { DC, LDES, TREE } from "@treecg/types";
import { RdfStore } from "rdf-stores";
import { DataFactory } from "rdf-data-factory";
import { getObjects, memberFromQuads, getLoggerFor } from "../utils";
import { Condition } from "../condition";

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
    latestVersions?: Map<string, number>;
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

    private condition: Condition;

    constructor(
        ldesUri: Term | null,
        info: LDESInfo,
        loose = false,
        condition: Condition,
    ) {
        this.ldesUri = ldesUri;
        this.extractor = info.extractor;
        this.timestampPath = info.timestampPath;
        this.isVersionOfPath = info.versionOfPath;
        this.shapeId = info.shape;
        this.loose = loose;
        this.condition = condition;

        if (!this.ldesUri) {
            this.logger.debug(
                `new local dump member extractor`
            );
        } else {
            this.logger.debug(
                `new member extractor for ${this.ldesUri.value}:`);
        }
        this.logger.debug(`${JSON.stringify({
            extractor: info.extractor.constructor.name,
            shape: info.shape,
            timestampPath: info.timestampPath,
            isVersionOfPath: info.versionOfPath,
        })}`);
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

        this.logger.debug(`Extracting ${members.length} members for ${page.url}`);

        const promises: Promise<Member | undefined | void>[] = [];

        for (const member of members) {
            if (!state.emitted.has(member.value)) {
                const promise = this.extractMember(member, page.data, members)
                    .then((member) => {
                        if (member) {
                            if (!this.closed) {
                                // Check if member matches condition
                                if (!this.condition.matchMember(member)) {
                                    this.logger.debug(`Member <${member.id.value}> does not match condition`);
                                    return;
                                }
                                // Check if member version is to be emitted 
                                if (this.memberIsOld(member, state.latestVersions)) {
                                    this.logger.debug(`Member <${member.id.value}> is older than latest version`);
                                    return;
                                }
                                // Emit this member
                                this.condition.memberEmitted(member);
                                this.logger.debug(`Member <${member.id.value}> will be emitted`);
                                notifier.extracted(member, state);
                            }
                        }
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
                page.memberCount = members.length;
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

    private async extractMember(
        member: Term,
        data: RdfStore,
        otherMembers: Term[] = [],
    ): Promise<Member | undefined> {
        try {
            const quads: Quad[] = await this.extractMemberQuads(member, data, otherMembers);
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

    private memberIsOld(member: Member, versionState?: Map<string, number>) {
        if (!versionState || !member.isVersionOf) {
            return false;
        }
        this.logger.debug(`Checking if member <${member.id.value}> is old`);
        // We are emitting latest versions only
        const newVersion = (<Date>(member.timestamp)).getTime();
        if (versionState.has(member.isVersionOf)) {
            // Check if this is an older version
            const latestVersion = versionState.get(member.isVersionOf);
            if (latestVersion && newVersion > latestVersion) {
                this.logger.debug(`Found a newer version of <${member.isVersionOf}>`);
                // We found a newer version, update the state
                versionState.set(member.isVersionOf, newVersion);
            } else {
                this.logger.debug(`Found an older version of <${member.isVersionOf}>, skipping it`);
                // This is an older version, return true to skip it
                return true;
            }
        } else {
            // First time seeing this member
            this.logger.debug(`First time seeing a version of <${member.isVersionOf}>`);
            versionState.set(member.isVersionOf, newVersion);
        }
        return false;
    }
}
