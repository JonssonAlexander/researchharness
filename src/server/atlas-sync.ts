import {getGraph} from "../core/graph.ts";
import {resolveDerivationTarget} from "../core/concept-derivations.ts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AtlasError, type AtlasStore, type AtlasSnapshot } from "../core/atlas.ts";
import { syncChoices, syncFindings, learningContext, validateSyncFindings, type SyncReview, type LearningContext } from "../core/atlas-sync.ts";
import { newGraphContextMessage, chainsForSelection, formatChainLine, sessionMarkdown, accumulateJobUsage, piUsageToStep, type ChatRecord, type JobUsage } from "../core/index.ts";
import { resolveRoleSpec, resolveConversationSpec, resolveSlot } from "../core/settings-resolution.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { reviewAtlasKnowledge } from "../agent/subagents/atlas-sync.ts";
import { readSourceBody } from "./mindmaps.ts";
import { emit } from "../core/events.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { stores } from "./stores.ts";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const token = z.string().regex(/^sr_[0-9a-f-]{36}$/);
const command = z.discriminatedUnion("action", [
    z.object({ action: z.literal("generate"), id: token, kind: z.enum(["map", "lesson"]), sourceId: z.string().max(100), subjectId: z.string().nullable(), expectedModel: z.string().max(240), consent: z.literal(true), reprocess: z.boolean().optional() }).strict(),
    z.object({ action: z.literal("commit"), id: token, digest: z.string().regex(/^[a-f0-9]{64}$/), choices: syncChoices, approve: z.literal(true) }).strict(),
]);
/** Bounded context, explicit identities first, then text candidates and immediate neighbours. */
export function syncContext(atlas: AtlasSnapshot, source: string, ids: string[]): AtlasSnapshot {
    const terms = new Set(source.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []), picked = new Set(ids);
    const neighbours = new Set(atlas.relations.filter(r => picked.has(r.sourceId) || picked.has(r.targetId)).flatMap(r => [r.sourceId, r.targetId]));
    const score = (c: AtlasSnapshot["concepts"][number]) => (picked.has(c.id) ? 10000 : 0) + (neighbours.has(c.id) ? 1000 : 0) + ([...c.title.toLowerCase().matchAll(/[\p{L}\p{N}]{4,}/gu)].filter(t => terms.has(t[0])).length * 10);
    let budget = 60000;
    const concepts = [...atlas.concepts].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).slice(0, 80).map(c => { const markdown = (c.markdown ?? "").slice(0, Math.min(1600, Math.max(0, budget))); budget -= markdown.length; return { ...c, markdown }; }), known = new Set(concepts.map(c => c.id));
    return { concepts, subjects: atlas.subjects.filter(s => concepts.some(c => c.subjectIds.includes(s.id))), relations: atlas.relations.filter(r => known.has(r.sourceId) && known.has(r.targetId)).slice(0, 160), layoutRevision: atlas.layoutRevision };
}
function engineFor(kind: "map" | "lesson", chat?: ChatRecord | null) { const settings = stores.settingsStore.readSettings(), spec = kind === "lesson" ? resolveConversationSpec(chat?.settings, resolveSlot(settings?.models?.strong)) : resolveRoleSpec("auditor", settings); if (!spec)
    throw new AtlasError("Configure the synchronization model in Settings → Models.", 503); return piEngineForSpec(spec, false); }
export function createAtlasSyncService(store: AtlasStore, getChat: (id: string) => ChatRecord | null, engine: (kind: "map" | "lesson", chat?: ChatRecord | null) => PiEngine = engineFor, review = reviewAtlasKnowledge, busy: (id: string) => boolean = isTurnRunning) {
    function source(kind: "map" | "lesson", id: string) {
        if (kind === "map") {
            const r = store.reviews.read(id);
            if (r.integration)
                throw new AtlasError("This map is already integrated. Its approved identities are preserved.", 409);
            return { source: r.draft, hash: r.digest, revision: r.revision, ids: r.draft.concepts.flatMap(c => c.existingId ? [c.existingId] : []), draftKeys: r.draft.concepts.map(c => c.key) };
        }
        const chat = getChat(id), context = store.sync.context(id);
        if (!chat || !context)
            throw new AtlasError("Start this session from an Atlas concept first.", 404);
        if (busy(id))
            throw new AtlasError("Wait for the current turn to finish before reviewing the session.", 409);
        const transcript = sessionMarkdown(chat.messages, { anchors: true });
        if (!chat.messages.some(m => m.role === "assistant") || !transcript.trim())
            throw new AtlasError("Complete some reasoning before reviewing this session.");
        if (transcript.length > 80000)
            throw new AtlasError("This session exceeds the 80,000-character review limit. Start a focused follow-up session.", 413);
        return { source: { context, transcript }, hash: hash(chat.messages), revision: 0, ids: context.conceptIds, chat };
    }
    return {
        model: (kind: "map" | "lesson", sourceId: string) => { const e = engine(kind, kind === "lesson" ? getChat(sourceId) : null); return `${e.model.provider}:${e.model.id}`; },
        async generate(raw: unknown, signal: AbortSignal) {
            const c = command.parse(raw);
            if (c.action !== "generate")
                throw new AtlasError("Invalid request.");
            const prior = store.sync.read(c.id);
            if (prior) {
                if (prior.kind !== c.kind || prior.sourceId !== c.sourceId)
                    throw new AtlasError("Review token belongs to another source.", 409);
                return prior;
            }
            const s = source(c.kind, c.sourceId), atlas = store.read();
            if (c.subjectId && !atlas.subjects.some(t => t.id === c.subjectId))
                throw new AtlasError("Subject no longer exists.", 409);
            for (const old of store.sync.list(c.kind, c.sourceId).filter(r => r.status === "running" && Date.now() - Date.parse(r.createdAt) > 360000))
                store.sync.update({ ...old, status: "failed", error: "Review was interrupted or expired. Recorded usage may be incomplete; rerun explicitly." });
            const existing = store.sync.list(c.kind, c.sourceId).find(r => r.sourceHash === s.hash && (r.status === "committed" || (!c.reprocess && r.model === c.expectedModel && r.subjectId === c.subjectId && r.status === "prepared" && r.baseRevision === (atlas.layoutRevision ?? 0))));
            if (existing)
                return existing;
            if (store.sync.list(c.kind, c.sourceId).filter(r => r.status === "running").length)
                throw new AtlasError("A review is already running. Reload its status before retrying.", 409);
            const e = engine(c.kind, s.chat), model = `${e.model.provider}:${e.model.id}`;
            if (model !== c.expectedModel)
                throw new AtlasError("The selected model changed. Reopen review.", 409);
            const sourceText = JSON.stringify(s.source);
            if (sourceText.length > 160000)
                throw new AtlasError("This draft exceeds the synchronization review limit. Shorten its notes before reviewing.", 413);
            const context = syncContext(atlas, sourceText, s.ids);
            let r: SyncReview = { schemaVersion: 1, id: c.id, kind: c.kind, sourceId: c.sourceId, sourceHash: s.hash, sourceText, reviewRevision: s.revision, baseRevision: atlas.layoutRevision ?? 0, subjectId: c.subjectId, model, createdAt: new Date().toISOString(), status: "running", findings: null, error: null, digest: "" };
            store.sync.begin(r);
            try {
                const bounded = AbortSignal.any([signal, AbortSignal.timeout(300000)]), findings = syncFindings.parse(await review(e, { kind: c.kind, source: s.source, atlas: context, draftKeys: s.draftKeys }, bounded, u => { r = { ...r, usage: accumulateJobUsage(r.usage as JobUsage | undefined, model, piUsageToStep(u)) }; store.sync.update(r); }));
                bounded.throwIfAborted();
                const problem = validateSyncFindings(findings, context, s.draftKeys);
                if (problem)
                    throw new AtlasError(problem);
                r = { ...r, status: "prepared", findings };
            }
            catch (error) {
                r = { ...r, status: signal.aborted ? "cancelled" : "failed", error: error instanceof AtlasError ? error.message : "Review failed or timed out. Saved sources are unchanged; recorded usage may be incomplete." };
            }
            store.sync.update(r);
            emit("atlas-changed", {});
            return store.sync.read(r.id)!;
        },
        commit(raw: unknown) { const c = command.parse(raw); if (c.action !== "commit")
            throw new AtlasError("Invalid request."); const r = store.sync.read(c.id); if (!r || r.kind !== "lesson")
            throw new AtlasError("A lesson review is required."); const current = source("lesson", r.sourceId); const result = store.sync.commitLesson(c.id, c.digest, c.choices, current.hash); emit("atlas-changed", {}); return result; },
    };
}
export function validateAtlasLearningContext(raw: unknown): LearningContext { const c = learningContext.parse(raw), atlas = stores.atlasStore.read(); if (c.conceptIds.some(id => !atlas.concepts.some(n => n.id === id)))
    throw new AtlasError("A selected concept was removed.", 409); if (c.relationId && !atlas.relations.some(r => r.id === c.relationId && c.conceptIds.includes(r.sourceId) && c.conceptIds.includes(r.targetId)))
    throw new AtlasError("Choose both endpoints of the learning target.");
    if(c.derivation){const graph=getGraph(stores.graphStore);resolveDerivationTarget(atlas.concepts.filter(n=>c.conceptIds.includes(n.id)),graph.nodes,graph.chains,c.derivation);}
    return c; }
export function attachAtlasLearningContext(chatId: string, c: LearningContext) {
    const atlas = stores.atlasStore.read(), concepts = atlas.concepts.filter(n => c.conceptIds.includes(n.id)), ids = new Set(concepts.flatMap(n => n.propositionIds));
    const graph=getGraph(stores.graphStore),nodes=graph.nodes;
    const target=c.derivation?resolveDerivationTarget(concepts,nodes,graph.chains,c.derivation):null;
    const picked=target?.propositions??nodes.filter(n=>ids.has(n.id));
    const names=Object.fromEntries(nodes.map(n=>[n.id,n]));
    const chains=target?target.chains.map(chain=>`${chain.premises.map(id=>names[id]!.name).join(" ∧ ")} ⇒ ${names[chain.conclusion]!.name} [${chain.id}; all premises jointly required]`):chainsForSelection(picked,graph.chains).map(chain=>formatChainLine(chain,names));
    const marker = newGraphContextMessage(picked.map(n => ({ id: n.id, name: n.name, statement: n.statement })), chains);
    if(c.derivation)marker.content+=`\n\nSelected derivation: root ${c.derivation.rootId}; target ${c.derivation.targetId}${c.derivation.chainId?`; argument ${c.derivation.chainId}`:""}. Recorded arguments are source assertions, not proof certificates. Establish precise assumptions and ask me to reconstruct the selected step. No recorded argument does not mean no proof exists.`;
    const links = atlas.relations.filter(r => c.conceptIds.includes(r.sourceId) && c.conceptIds.includes(r.targetId)).map(r => `${r.id}: ${r.sourceId} — ${r.relationType} — ${r.targetId}; conditions: ${r.conditions}; status: ${r.claimStatus}. This association is not a proof chain.`);
    marker.content = `[Atlas learning context; goal: ${c.goal}. Ask for independent reasoning; retain hints and assumptions. Concept IDs ac_ are context only, never formal proposition targets. Mathematical updates require explicit Atlas review.]\n${marker.content}\n\nAtlas concepts:\n${concepts.map(n => `[${n.id}] ${n.title}: ${(n.markdown ?? "").slice(0, 3000)}`).join("\n\n")}\n\nTyped associations:\n${links.join("\n")}`;
    stores.atlasStore.sync.attach(chatId, c);
    stores.chatStore.saveMessages(chatId, [...stores.chatStore.getChat(chatId)!.messages, marker]);
}
export async function atlasSyncResponse(request: Request): Promise<Response> {
    try {
        const service = createAtlasSyncService(stores.atlasStore, stores.chatStore.getChat);
        if (request.method === "GET") {
            const q = new URL(request.url).searchParams, kind = q.get("kind") === "lesson" ? "lesson" : "map", sourceId = q.get("sourceId") ?? "";
            return Response.json(q.has("config") ? { model: service.model(kind, sourceId) } : q.has("id") ? stores.atlasStore.sync.read(token.parse(q.get("id"))) : { context: kind === "lesson" ? stores.atlasStore.sync.context(sourceId) : null, reviews: stores.atlasStore.sync.list(kind, sourceId) }, { headers: { "Cache-Control": "no-store" } });
        }
        if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
            throw new AtlasError("Expected JSON.", 415);
        const c = command.parse(JSON.parse((await readSourceBody(request, 16000)).toString("utf8")));
        return Response.json(c.action === "generate" ? await service.generate(c, request.signal) : service.commit(c));
    }
    catch (e) {
        return Response.json({ error: e instanceof AtlasError ? e.message : "Synchronization review is unavailable." }, { status: e instanceof AtlasError ? e.status : 400 });
    }
}
