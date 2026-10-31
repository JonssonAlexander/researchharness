import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AtlasError, type AtlasSnapshot } from "../core/atlas.ts";
import { learningContext, syncChoices, syncFindings, planLessonIntegration, type AtlasSyncStore, type SyncReview, type LearningContext, type LessonPlan } from "../core/atlas-sync.ts";
export const syncHash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function syncId(token: string, key: string, prefix = "ac") { const h = syncHash([token, key]); return `${prefix}_${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; }
type Database = <T>(run: (db: DatabaseSync) => T) => T;
export function writeLessonPlan(db: DatabaseSync, plan: LessonPlan, current: AtlasSnapshot, record: SyncReview, writeNote: (id: string, text: string) => string | null) {
    const home = current.subjects.find(s => s.id === record.subjectId);
    for (const [i, n] of plan.concepts.entries()) {
        const old = current.concepts.find(c => c.id === n.id), marker = `<!-- atlas-session:${record.sourceId}:${record.sourceHash} -->`;
        if (old?.markdown?.includes(marker))
            throw new AtlasError("This session revision already has notes here. Review the existing notes instead.", 409);
        const text = `${old?.markdown ?? ""}\n\n${marker}\n${n.markdown}\n\nSession: ${record.sourceId}\nReview: ${record.id}\n`;
        if (text.length > 16000)
            throw new AtlasError(`Notes for ${n.title} exceed the limit. Shorten them before integrating.`);
        const note = writeNote(n.id, text);
        if (old)
            db.prepare("UPDATE concepts SET markdownPath=?,revision=revision+1 WHERE id=?").run(note, n.id);
        else {
            db.prepare("INSERT INTO concepts VALUES (?,?,?, ?,1,?,?,?)").run(n.id, n.title, "[]", home?.id ?? null, (home?.x ?? 0) + (i % 3) * 130, (home?.y ?? 0) + Math.floor(i / 3) * 130, note);
            if (home)
                db.prepare("INSERT INTO concept_subjects VALUES (?,?)").run(n.id, home.id);
        }
    }
    writeSyncLinks(db, plan);
}
export function writeSyncLinks(db: DatabaseSync, plan: Pick<LessonPlan, "relations" | "associations">) {
    for (const r of plan.relations) {
        const now = new Date().toISOString(), contentHash = syncHash({ ...r, expectedRevision: 1 });
        db.prepare("INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(r.id, r.sourceId, r.targetId, r.relationType, r.conditions, r.claimStatus, r.reviewStatus, JSON.stringify(r.evidence), 1, now, now, contentHash);
        db.prepare("INSERT INTO relation_revisions VALUES (?,?,?)").run(r.id, 1, JSON.stringify({ ...r, expectedRevision: 1, createdAt: now, updatedAt: now, contentHash }));
    }
    for (const a of plan.associations)
        db.prepare("INSERT INTO atlas_associations VALUES (?,?,?,?,?)").run(a.id, a.sourceId, a.targetId, JSON.stringify(a), syncHash(a));
}
export function readSyncRecord(db: DatabaseSync, id: string): SyncReview | null {
    const row = db.prepare("SELECT * FROM atlas_sync_reviews WHERE id=?").get(id);
    if (!row)
        return null;
    const r = JSON.parse(String(row.record)) as SyncReview;
    if (r.schemaVersion !== 1)
        throw new AtlasError("This sync review needs a newer app.", 409);
    const { digest, ...body } = r;
    if (r.id !== row.id || syncHash(r) !== row.contentHash || syncHash(body) !== digest)
        throw new AtlasError("Sync review changed outside Atlas.", 409);
    if (r.findings)
        syncFindings.parse(r.findings);
    return r;
}
export function createAtlasSyncStore(database: Database, snapshot: (db: DatabaseSync) => AtlasSnapshot, writeNote: (id: string, text: string) => string | null): AtlasSyncStore {
    function write(db: DatabaseSync, r: SyncReview) { const { digest: _digest, ...body } = r; void _digest; const record = { ...body, digest: syncHash(body) }; db.prepare("INSERT INTO atlas_sync_reviews VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,contentHash=excluded.contentHash").run(r.id, JSON.stringify(record), syncHash(record)); }
    return {
        read: id => database(db => readSyncRecord(db, id)),
        list: (kind, sourceId) => database(db => db.prepare("SELECT id FROM atlas_sync_reviews WHERE json_extract(record,'$.kind')=? AND json_extract(record,'$.sourceId')=? ORDER BY rowid DESC LIMIT 100").all(kind, sourceId).map(r => readSyncRecord(db, String(r.id))!)),
        begin: r => database(db => { if (readSyncRecord(db, r.id))
            return false; if (r.status !== "running")
            throw new AtlasError("Start a running review."); write(db, r); return true; }),
        update: r => database(db => { const old = readSyncRecord(db, r.id); if (!old || old.status !== "running" || old.kind !== r.kind || old.sourceId !== r.sourceId || old.sourceHash !== r.sourceHash || old.baseRevision !== r.baseRevision || old.reviewRevision !== r.reviewRevision)
            throw new AtlasError("Review no longer accepts updates.", 409); if (r.findings)
            syncFindings.parse(r.findings); if (r.status === "committed")
            throw new AtlasError("Approval is required.", 409); write(db, r); }),
        context: chatId => database(db => { const r = db.prepare("SELECT record,contentHash FROM atlas_learning_sessions WHERE chatId=?").get(chatId); if (!r)
            return null; const v = JSON.parse(String(r.record)); if (syncHash(v) !== r.contentHash)
            throw new AtlasError("Session context changed outside Atlas.", 409); return learningContext.parse(v); }),
        attach: (chatId, input) => database(db => { const v = learningContext.parse(input); if (db.prepare("SELECT chatId FROM atlas_learning_sessions WHERE chatId=?").get(chatId))
            throw new AtlasError("Session already has Atlas context.", 409); db.prepare("INSERT INTO atlas_learning_sessions VALUES (?,?,?)").run(chatId, JSON.stringify(v), syncHash(v)); }),
        commitLesson: (id, digest, input, sourceHash) => database(db => {
            db.exec("BEGIN IMMEDIATE");
            try {
                const r = readSyncRecord(db, id);
                if (!r)
                    throw new AtlasError("Lesson review missing.", 404);
                const choices = syncChoices.parse(input);
                if (r.status === "committed") {
                    if (r.approval?.digest !== digest || syncHash(r.approval.choices) !== syncHash(choices))
                        throw new AtlasError("Approval content differs.", 409);
                    db.exec("COMMIT");
                    return r;
                }
                if (r.digest !== digest || r.sourceHash !== sourceHash)
                    throw new AtlasError("Session or approval changed. Prepare a fresh review.", 409);
                if (db.prepare("SELECT id FROM atlas_sync_reviews WHERE id!=? AND json_extract(record,'$.kind')='lesson' AND json_extract(record,'$.sourceId')=? AND json_extract(record,'$.sourceHash')=? AND json_extract(record,'$.status')='committed'").get(id, r.sourceId, sourceHash))
                    throw new AtlasError("This session revision was already integrated.", 409);
                const current = snapshot(db), plan = planLessonIntegration(r, choices, current, key => syncId(id, key, key.startsWith("edge_") ? "ar" : "ac"));
                writeLessonPlan(db, plan, current, r, writeNote);
                const committed = { ...r, status: "committed" as const, approval: { digest, choices, committedAt: new Date().toISOString() } };
                write(db, committed);
                db.exec("UPDATE atlas_layout_version SET revision=revision+1; COMMIT");
                return readSyncRecord(db, id)!;
            }
            catch (e) {
                db.exec("ROLLBACK");
                throw e;
            }
        }),
    };
}
