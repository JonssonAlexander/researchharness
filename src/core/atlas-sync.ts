import { z } from "zod";
import { AtlasError, atlasConceptId, type AtlasSnapshot } from "./atlas.ts";
import { RELATION_TYPES, normalizeRelation, type RelationInput } from "./atlas-relations.ts";
const text = z.string().trim().min(1).max(4000), key = z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/);
export const syncFindings = z.object({
    identities: z.array(z.object({ key, existingId: atlasConceptId.nullable(), rationale: text, uncertainty: z.string().max(2000) }).strict()).max(40),
    concepts: z.array(z.object({ key, title: z.string().trim().min(1).max(160), existingId: atlasConceptId.nullable(), notes: text }).strict()).max(20),
    connections: z.array(z.object({ key, source: z.string().max(80), target: z.string().max(80), label: z.string().trim().min(1).max(160), relationType: z.enum(RELATION_TYPES).nullable(), conditions: z.string().trim().max(2000), rationale: text,
        status: z.enum(["association", "proof-missing", "ai-proof-sketch"]), proof: z.string().max(6000), uncertainty: z.string().max(2000) }).strict()).max(20),
    observations: z.array(z.object({ conceptId: atlasConceptId, evidence: text, assistance: z.string().max(2000) }).strict()).max(20),
}).strict().superRefine((f, ctx) => { for (const name of ["identities", "concepts", "connections"] as const)
    if (new Set(f[name].map(c => c.key)).size !== f[name].length)
        ctx.addIssue({ code: "custom", message: "Use unique suggestion keys." }); for (const c of f.connections)
    if (c.source === c.target || c.status === "ai-proof-sketch" && !c.proof.trim() || c.status !== "ai-proof-sketch" && c.proof.trim())
        ctx.addIssue({ code: "custom", message: "A proof sketch needs its argument and distinct endpoints; other statuses cannot contain a proof." }); });
export type SyncFindings = z.infer<typeof syncFindings>;
export const learningContext = z.object({ conceptIds: z.array(atlasConceptId).min(1).max(20), relationId: z.string().regex(/^ar_[0-9a-f-]{36}$/).optional(), goal: z.enum(["explain", "derive", "proof", "practice"]), derivation:z.object({rootId:z.string().regex(/^n_[\w-]+$/),targetId:z.string().regex(/^n_[\w-]+$/),chainId:z.string().regex(/^arg_[\w-]+$/).optional()}).strict().optional() }).strict();
export type LearningContext = z.infer<typeof learningContext>;
export const syncChoices = z.object({ identities: z.record(key, z.union([atlasConceptId, z.literal("new"), z.null()])), connections: z.array(key).max(20), observations: z.array(z.number().int().min(0).max(19)).max(20).optional(), outcome: z.enum(["untested", "with-help", "independent"]) }).strict();
export type SyncChoices = z.infer<typeof syncChoices>;
export interface SyncReview {
    schemaVersion: 1;
    id: string;
    kind: "map" | "lesson";
    sourceId: string;
    sourceHash: string;
    sourceText?: string;
    reviewRevision: number;
    baseRevision: number;
    subjectId: string | null;
    model: string;
    createdAt: string;
    status: "running" | "prepared" | "failed" | "cancelled" | "committed";
    findings: SyncFindings | null;
    error: string | null;
    usage?: import("./contracts.ts").JobUsage;
    digest: string;
    approval?: {
        digest: string;
        choices: SyncChoices;
        committedAt: string;
    };
}
export const syncAssociation = z.object({ id: z.string().regex(/^ar_[0-9a-f-]{36}$/), sourceId: atlasConceptId, targetId: atlasConceptId, reviewId: z.string().regex(/^sr_[0-9a-f-]{36}$/), label: z.string().min(1).max(160), status: z.enum(["association", "proof-missing", "ai-proof-sketch"]) }).strict().refine(a => a.sourceId !== a.targetId, "Choose distinct endpoints");
export type SyncAssociation = z.infer<typeof syncAssociation>;
export interface LessonPlan {
    associations: SyncAssociation[];
    concepts: {
        id: string;
        title: string;
        markdown: string;
        existing: boolean;
    }[];
    relations: RelationInput[];
    reusedRelations: string[];
}
export interface AtlasSyncStore {
    read(id: string): SyncReview | null;
    list(kind: "map" | "lesson", sourceId: string): SyncReview[];
    begin(record: SyncReview): boolean;
    update(record: SyncReview): void;
    context(chatId: string): LearningContext | null;
    attach(chatId: string, context: LearningContext): void;
    commitLesson(id: string, digest: string, choices: SyncChoices, sourceHash: string): SyncReview;
}
/** Both AI passes are suggestions. Validation checks identity references, never mathematical truth. */
export function validateSyncFindings(f: SyncFindings, atlas: AtlasSnapshot, draftKeys?: string[]): string | null {
    const known = new Set(atlas.concepts.map(c => c.id)), local = new Set(draftKeys ?? f.concepts.map(c => c.key));
    if (draftKeys && (f.concepts.length || f.observations.length))
        return "Map auditing must not invent additional nodes or learning observations.";
    if (!draftKeys && f.concepts.some(c => known.has(c.key)))
        return "Local keys must differ from canonical concept IDs.";
    if (!draftKeys && f.identities.length)
        return "Lesson identities belong to its proposed concepts.";
    if (f.identities.some(c => !local.has(c.key) || c.existingId && !known.has(c.existingId)) || f.concepts.some(c => c.existingId && !known.has(c.existingId)))
        return "Identity candidates must exist in the supplied context.";
    if (f.connections.some(c => ![c.source, c.target].every(id => local.has(id) || known.has(id))))
        return "Connection endpoints must exist in the supplied context.";
    if (f.observations.some(o => !known.has(o.conceptId)))
        return "Observation target is missing.";
    return null;
}
export function connectionNotes(c: SyncFindings["connections"][number]): string {
    return `### ${c.label}\n\nAI suggestion · ${c.status} · not independently verified\n\n${c.rationale}\n\nConditions: ${c.conditions || "Not supplied"}\n\n${c.proof ? `AI-generated proof sketch:\n\n${c.proof}\n\n` : ""}Unresolved: ${c.uncertainty || "Mathematical review and personal study remain required."}`;
}
export function suggestedRelations(review: SyncReview, selected: string[], mapping: Map<string, string>, atlas: AtlasSnapshot, mint: (key: string) => string) {
    const f = review.findings!;
    if (new Set(selected).size !== selected.length || selected.some(k => !f.connections.some(c => c.key === k)))
        throw new AtlasError("Invalid suggestion selection.");
    const notes = new Map<string, string[]>(), associations: SyncAssociation[] = [], relations: RelationInput[] = [], reusedRelations: string[] = [];
    const known = new Set(atlas.concepts.map(c => c.id));
    for (const c of f.connections.filter(c => selected.includes(c.key))) {
        const sourceId = mapping.get(c.source) ?? (known.has(c.source) ? c.source : null), targetId = mapping.get(c.target) ?? (known.has(c.target) ? c.target : null);
        if (!sourceId || !targetId || sourceId === targetId)
            throw new AtlasError("A suggestion needs two distinct included identities.");
        for (const id of [sourceId, targetId])
            notes.set(id, [...(notes.get(id) ?? []), connectionNotes(c)]);
        if (!c.relationType) {
            if (!atlas.associations?.some(a => [a.sourceId, a.targetId].sort().join(":") === [sourceId, targetId].sort().join(":")))
                associations.push({ id: mint(`edge_assoc_${c.key}`), sourceId, targetId, reviewId: review.id, label: c.label, status: c.status });
            continue;
        }
        // Associations are stored separately; they cannot become typed implications.
        const r = normalizeRelation({ kind: "relation", id: mint(`edge_sync_${c.key}`), expectedRevision: 0, sourceId, targetId, relationType: c.relationType, conditions: c.conditions, claimStatus: c.status === "ai-proof-sketch" ? "proof-sketch" : "hypothesis", reviewStatus: "accepted", evidence: [{ citation: `AI suggestion ${review.id}; ${review.model}; ${c.status}. Approval is not verification.`, locator: JSON.stringify({ sourceId: review.sourceId, hash: review.sourceHash, key: c.key }) }] });
        const old = atlas.relations.find(o => o.sourceId === r.sourceId && o.targetId === r.targetId && o.relationType === r.relationType && o.conditions === r.conditions);
        if (old) {
            if (old.reviewStatus !== "accepted")
                throw new AtlasError("A matching disputed or proposed relation needs separate review.", 409);
            reusedRelations.push(old.id);
        }
        else if (!relations.some(o => o.sourceId === r.sourceId && o.targetId === r.targetId && o.relationType === r.relationType && o.conditions === r.conditions))
            relations.push(r);
    }
    return { relations, reusedRelations, notes, associations };
}
export function planLessonIntegration(review: SyncReview, choices: SyncChoices, atlas: AtlasSnapshot, mint: (key: string) => string): LessonPlan {
    if (review.kind !== "lesson" || review.status !== "prepared" || !review.findings)
        throw new AtlasError("Prepare a lesson review first.", 409);
    if (review.baseRevision !== (atlas.layoutRevision ?? 0))
        throw new AtlasError("Atlas changed. Prepare a fresh lesson review.", 409);
    const problem = validateSyncFindings(review.findings, atlas);
    if (problem)
        throw new AtlasError(problem);
    const f = review.findings;
    if(choices.observations&&(new Set(choices.observations).size!==choices.observations.length||choices.observations.some(i=>!f.observations[i])))throw new AtlasError("Invalid learning evidence selection.");
    if (Object.keys(choices.identities).length !== f.concepts.length || f.concepts.some(c => !(c.key in choices.identities)))
        throw new AtlasError("Choose each concept identity.");
    if (f.concepts.some(c => choices.identities[c.key] === "new") && !atlas.subjects.some(s => s.id === review.subjectId))
        throw new AtlasError("Choose a subject before adding new lesson concepts.");
    const used = new Set<string>(), names = new Set<string>();
    const concepts = f.concepts.flatMap(c => {
        const choice = choices.identities[c.key];
        if (choice === null)
            return [];
        const old = atlas.concepts.find(n => n.id === choice);
        if (choice !== "new" && !old)
            throw new AtlasError("Selected identity was removed.", 409);
        if (choice === "new" && atlas.concepts.some(n => [n.title, ...n.aliases].some(t => t.trim().toLowerCase() === c.title.toLowerCase())))
            throw new AtlasError(`Reuse the existing identity for ${c.title}.`);
        const id = old?.id ?? mint(`concept_${c.key}`), name = (old?.title ?? c.title).toLowerCase();
        if (used.has(id) || names.has(name))
            throw new AtlasError("Combine duplicate proposed concepts before integrating.");
        used.add(id);
        names.add(name);
        return [{ key: c.key, id, title: old?.title ?? c.title, existing: !!old, markdown: `### ${c.title}\n\nAI session synthesis · not independently verified\n\n${c.notes}` }];
    });
    const bridge = suggestedRelations(review, choices.connections, new Map(concepts.map(c => [c.key, c.id])), atlas, mint);
    for (const [id, notes] of bridge.notes) {
        let c = concepts.find(c => c.id === id);
        if (!c) {
            const n = atlas.concepts.find(n => n.id === id)!;
            c = { key: id, id, title: n.title, existing: true, markdown: "" };
            concepts.push(c);
        }
        c.markdown += `\n\n${notes.join("\n\n")}`;
    }
    return { concepts, associations: bridge.associations, relations: bridge.relations, reusedRelations: bridge.reusedRelations };
}
