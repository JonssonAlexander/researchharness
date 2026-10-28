import { z } from "zod";

export const RELATION_TYPES = [
	"prerequisite",
	"generalization",
	"analogy",
	"counterexample",
	"application",
	"hypothesis",
] as const;
export const CLAIM_STATUSES = [
	"hypothesis",
	"external-assertion",
	"numerical-observation",
	"proof-sketch",
	"checked-argument",
] as const;
export const REVIEW_STATUSES = ["proposed", "accepted", "disputed", "retracted"] as const;
const conceptId = z.string().regex(/^ac_[0-9a-f-]{36}$/);
export const atlasRelationSchema = z
	.object({
		kind: z.literal("relation"),
		id: z.string().regex(/^ar_[0-9a-f-]{36}$/),
		expectedRevision: z.number().int().nonnegative(),
		sourceId: conceptId,
		targetId: conceptId,
		relationType: z.enum(RELATION_TYPES),
		conditions: z.string().trim().max(4000),
		claimStatus: z.enum(CLAIM_STATUSES),
		reviewStatus: z.enum(REVIEW_STATUSES),
		evidence: z
			.array(
				z
					.object({
						citation: z.string().trim().min(1).max(2000),
						locator: z.string().trim().max(1000),
					})
					.strict(),
			)
			.max(20),
	})
	.strict()
	.refine((r) => r.sourceId !== r.targetId, "Choose two distinct concepts")
	.refine(
		(r) => r.reviewStatus !== "accepted" || r.evidence.length > 0,
		"An accepted link needs a source citation",
	);
export type RelationInput = z.infer<typeof atlasRelationSchema>;
export interface AtlasRelation extends Omit<RelationInput, "kind" | "expectedRevision"> {
	revision: number;
	createdAt: string;
	updatedAt: string;
	contentHash: string;
}
/** Analogy alone is symmetric. All other types retain the owner's direction. */
export function normalizeRelation(input: RelationInput): RelationInput {
	return input.relationType === "analogy" && input.sourceId > input.targetId
		? { ...input, sourceId: input.targetId, targetId: input.sourceId }
		: input;
}
