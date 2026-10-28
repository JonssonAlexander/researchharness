import { z } from "zod";
import { atlasRelationSchema, type AtlasRelation } from "./atlas-relations.ts";

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{36}$`));
const title = z.string().trim().min(1).max(160);
const revision = z.number().int().nonnegative();
export const atlasConceptId = id("ac");
export const atlasSubjectId = id("as");
const concept = z
	.object({
		kind: z.literal("concept"),
		id: atlasConceptId,
		expectedRevision: revision,
		title,
		aliases: z.array(title).max(50),
		markdown: z.string().max(16000).optional(),
		subjectIds: z.array(atlasSubjectId).max(50),
		preferredSubjectId: atlasSubjectId.nullable(),
		propositionIds: z.array(z.string().regex(/^n_[\w-]+$/)).max(200),
	})
	.strict()
	.refine(
		(c) =>
			new Set(c.subjectIds).size === c.subjectIds.length &&
			new Set(c.propositionIds).size === c.propositionIds.length,
		"Duplicate links",
	)
	.refine(
		(c) =>
			c.preferredSubjectId === null ? c.subjectIds.length === 0 : c.subjectIds.includes(c.preferredSubjectId),
		"Choose a preferred subject from the memberships",
	);
const subject = z
	.object({
		kind: z.literal("subject"),
		id: atlasSubjectId,
		expectedRevision: revision,
		title,
		color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
		parentId: atlasSubjectId.nullable(),
	})
	.strict();
const subjectDelete = z
	.object({
		kind: z.literal("subject-delete"),
		id: atlasSubjectId,
		expectedRevision: revision.min(1),
	})
	.strict();
export const atlasCommandSchema = z.union([concept, subject, subjectDelete, atlasRelationSchema]);
export type AtlasCommand = z.infer<typeof atlasCommandSchema>;
export type ConceptInput = Extract<AtlasCommand, { kind: "concept" }>;
export type SubjectInput = Extract<AtlasCommand, { kind: "subject" }>;
export interface AtlasConcept extends Omit<ConceptInput, "kind" | "expectedRevision"> {
	revision: number;
	x: number;
	y: number;
}
export interface AtlasSubject extends Omit<SubjectInput, "kind" | "expectedRevision"> {
	revision: number;
	x: number;
	y: number;
}
export interface AtlasSnapshot {
	relations: AtlasRelation[];
	concepts: AtlasConcept[];
	subjects: AtlasSubject[];
}
export interface AtlasStore {
	read(): AtlasSnapshot;
	save(command: AtlasCommand): void;
}
export class AtlasError extends Error {
	constructor(
		message: string,
		public status = 400,
	) {
		super(message);
	}
}

/** A subject hierarchy is administrative metadata, not mathematical implication. */
export function assertSubjectParent(subjects: AtlasSubject[], id: string, parent: string | null): void {
	const seen = new Set([id]);
	while (parent !== null) {
		if (seen.has(parent)) throw new AtlasError("Subjects cannot contain a cycle.");
		seen.add(parent);
		const subject = subjects.find((s) => s.id === parent);
		if (!subject) throw new AtlasError("The parent subject no longer exists.");
		parent = subject.parentId;
	}
}

/** Membership is many-to-many; the main canvas depicts each concept once. */
export function projectAtlas({ concepts, subjects, relations }: AtlasSnapshot) {
	const colors = new Map(subjects.map((s) => [s.id, s.color]));
	const members = new Map<string, string[]>();
	for (const c of concepts)
		if (c.preferredSubjectId) {
			const ids = members.get(c.preferredSubjectId) ?? [];
			ids.push(c.id);
			members.set(c.preferredSubjectId, ids);
		}
	return {
		semanticEdges: relations
			.filter((r) => r.reviewStatus === "accepted")
			.map((r) => ({ id: r.id, from: r.sourceId, to: r.targetId })),
		nodes: concepts.map((c) => ({
			id: c.id,
			label: c.title,
			x: c.x,
			y: c.y,
			fixed: true,
			color: colors.get(c.preferredSubjectId ?? "") ?? "#9ca3af",
		})),
		clusters: subjects.map((s) => ({
			id: s.id,
			label: s.title,
			color: s.color,
			members: members.get(s.id) ?? [],
		})),
	};
}
