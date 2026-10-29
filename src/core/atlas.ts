import type { MapProposalStore } from "./map-proposals.ts";
import type { Mindmap, MindmapStore } from "./mindmaps.ts";
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
const coordinate = z.number().finite().min(-1000000).max(1000000);
const conceptPosition = z
	.object({
		kind: z.literal("concept-position"),
		id: atlasConceptId,
		expectedRevision: revision.min(1),
		x: coordinate,
		y: coordinate,
	})
	.strict();
const subjectPosition = z
	.object({
		kind: z.literal("subject-position"),
		id: atlasSubjectId,
		expectedRevision: revision.min(1),
		x: coordinate,
		y: coordinate,
	})
	.strict();
const layout = z
	.object({
		kind: z.literal("layout"),
		expectedRevision: revision,
		positions: z.array(z.object({ id: atlasConceptId, x: coordinate, y: coordinate }).strict()).min(1).max(150),
	})
	.strict()
	.refine(c => new Set(c.positions.map(p => p.id)).size === c.positions.length, "Duplicate positions");
const subjectMove = z.object({
	kind: z.literal("subject-move"), id: atlasSubjectId, expectedRevision: revision,
	dx: coordinate, dy: coordinate,
}).strict();
const subjectLock = z
	.object({
		kind: z.literal("subject-lock"),
		id: atlasSubjectId,
		expectedRevision: revision.min(1),
		locked: z.boolean(),
	})
	.strict();
export const atlasViewInput = z.object({
	kind: z.literal("view"), id: id("av"), expectedRevision: revision,
	title, query: z.string().max(200),
	/** World point at viewport centre, plus zoom; portable across window sizes. */
	camera: z.object({x: coordinate, y: coordinate, k: z.number().finite().min(0.02).max(40)}).strict(),
}).strict();
const viewDelete = z.object({
	kind: z.literal("view-delete"), id: id("av"), expectedRevision: revision.min(1),
}).strict();
const conceptDelete = z
	.object({ kind: z.literal("concept-delete"), id: atlasConceptId, expectedRevision: revision.min(1) })
	.strict();
const relationDelete = z
	.object({
		kind: z.literal("relation-delete"),
		id: z.string().regex(/^ar_[0-9a-f-]{36}$/),
		expectedRevision: revision.min(1),
	})
	.strict();
const subjectDelete = z
	.object({
		kind: z.literal("subject-delete"),
		id: atlasSubjectId,
		expectedRevision: revision.min(1),
	})
	.strict();
export const atlasCommandSchema = z.union([
	concept,
	subject,
	subjectDelete,
	atlasRelationSchema,
	conceptDelete,
	relationDelete,
	conceptPosition,
	layout,
	subjectLock,
	subjectMove,
	atlasViewInput,
	viewDelete,
	subjectPosition,
]);
export type AtlasCommand = z.infer<typeof atlasCommandSchema>;
export type ConceptInput = Extract<AtlasCommand, { kind: "concept" }>;
export type SubjectInput = Extract<AtlasCommand, { kind: "subject" }>;
export interface AtlasConcept extends Omit<ConceptInput, "kind" | "expectedRevision"> {
	revision: number;
	x: number;
	y: number;
}
export interface AtlasSubject extends Omit<SubjectInput, "kind" | "expectedRevision"> {
	locked?: boolean;
	revision: number;
	x: number;
	y: number;
}
export interface AtlasView extends Omit<z.infer<typeof atlasViewInput>, "kind" | "expectedRevision"> {
	revision: number;
}
export interface AtlasSnapshot {
	mindmaps?: Mindmap[];
	views?: AtlasView[];
	/** Global optimistic version for an atomic layout commit. */
	layoutRevision?: number;
	relations: AtlasRelation[];
	concepts: AtlasConcept[];
	subjects: AtlasSubject[];
}
export interface AtlasStore {
	proposals: MapProposalStore;
	mindmaps: MindmapStore;
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
	const subjectById = new Map(subjects.map((s) => [s.id, s]));
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
			fixed: !!subjectById.get(c.preferredSubjectId ?? "")?.locked,
			draggable: !subjectById.get(c.preferredSubjectId ?? "")?.locked,
			color: subjectById.get(c.preferredSubjectId ?? "")?.color ?? "#9ca3af",
		})),
		clusters: subjects.map((s) => ({
			id: s.id,
			label: s.title,
			color: s.color,
			members: members.get(s.id) ?? [],
		})),
	};
}
