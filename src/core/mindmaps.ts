import { z } from "zod";
import { atlasConceptId } from "./atlas.ts";

export const mindmapId = z.string().regex(/^mm_[0-9a-f-]{36}$/);
export const mindmapRevisionId = z.string().regex(/^mr_[0-9a-f-]{36}$/);
export const mindmapInput = z.object({
	id: mindmapId, captureId: mindmapRevisionId,
	expectedRevision: z.number().int().nonnegative(),
	title: z.string().trim().min(1).max(160),
	filename: z.string().min(7).max(180).regex(/^[^/\\\x00-\x1f\x7f]+\.rnote$/i),
	conceptIds: z.array(atlasConceptId).max(200),
	manualPreviewAcknowledged: z.boolean().default(false),
}).strict().refine(v => new Set(v.conceptIds).size === v.conceptIds.length, "Duplicate concepts");
export type MindmapInput = z.infer<typeof mindmapInput>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const mindmapCapture = z.object({
	schemaVersion: z.literal(1),
	id: mindmapRevisionId, mapId: mindmapId, hash, previewHash: hash.nullable(),
	filename: z.string().max(180), capturedAt: z.iso.datetime(),
	conceptIds: z.array(atlasConceptId).max(200),
	validation: z.enum(["rnote-cli", "unverified"]),
	previewKind: z.enum(["rnote-thumbnail", "manual-png", "none"]),
	notice: z.string().max(300).nullable(),
}).strict().refine(v => (v.previewKind === "none") === (v.previewHash === null), "Invalid preview reference");
export type MindmapCapture = z.infer<typeof mindmapCapture>;
export type MindmapPreparation = Pick<MindmapCapture, "validation" | "previewKind" | "notice">;
export interface Mindmap {
	id: string; title: string; revision: number; archived: boolean;
	subjectId?: string | null; currentRevision: string; captures: MindmapCapture[];
}
export interface MindmapStore {
	capture(input: MindmapInput, original: Uint8Array, preview: Uint8Array | null, info: MindmapPreparation): void;
	setArchived(id: string, expectedRevision: number, archived: boolean): void;
	asset(revisionId: string, kind: "original" | "preview"): {bytes: Uint8Array; filename: string};
}
export const MINDMAP_LIMITS = {original: 32 * 1024 * 1024, preview: 10 * 1024 * 1024, request: 43 * 1024 * 1024};
