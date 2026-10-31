import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AtlasError } from "../core/atlas.ts";
import { mindmapInput, mindmapCapture, mindmapId, mindmapRevisionId, MINDMAP_LIMITS,
	type Mindmap, type MindmapStore } from "../core/mindmaps.ts";

type Database = <T>(run: (db: DatabaseSync) => T) => T;
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function parseCapture(record: string) {
	const input = JSON.parse(record);
	if (input.schemaVersion > 1) throw new AtlasError("This source revision needs a newer app.", 409);
	return mindmapCapture.parse(input);
}
export function readMindmaps(db: DatabaseSync): Mindmap[] {
	return db.prepare("SELECT * FROM mindmaps ORDER BY rowid").all().map(row => {
		mindmapId.parse(row.id);
		if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || ![0,1].includes(Number(row.archived)) ||
			typeof row.title !== "string" || !row.title.trim() || row.title.length > 160)
			throw new AtlasError("Invalid mind map record.", 500);
		const captures = db.prepare("SELECT id,mapId,record FROM mindmap_captures WHERE mapId=? ORDER BY rowid").all(row.id!)
			.map(r => {
				const capture = parseCapture(String(r.record));
				if (capture.id !== r.id || capture.mapId !== r.mapId) throw new AtlasError("Broken source identity.", 500);
				return capture;
			});
		if (!captures.some(c => c.id === row.currentRevision) || captures.some(c => c.mapId !== row.id))
			throw new AtlasError("Broken mind map revision references.", 500);
		return {id: String(row.id), title: row.title, revision: Number(row.revision), archived: row.archived === 1,
			subjectId: row.subjectId ? String(row.subjectId) : null, currentRevision: String(row.currentRevision), captures};
	});
}

/** Immutable files land before SQL references. Interrupted writes can leave only
 * unreferenced blobs; retry verifies/reuses them and never overwrites an original. */
export function createMindmapStore(database: Database, dataRoot: string): MindmapStore & {retainImage(bytes:Uint8Array):string;image(hash:string):Uint8Array} {
	function directory(kind: "original" | "preview") {
		let target = dataRoot;
		for (const segment of ["mindmaps", kind === "original" ? "revisions" : "previews"]) {
			const parent = target;
			target = path.join(target, segment);
			fs.mkdirSync(target, {recursive: true, mode: 0o700});
			if (!fs.lstatSync(target).isDirectory()) throw new AtlasError("Mind map storage must be a regular directory.", 500);
			const fd = fs.openSync(parent, "r");
			try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
		}
		return target;
	}
	function readBlob(kind: "original" | "preview", hash: string) {
		if (!/^[a-f0-9]{64}$/.test(hash)) throw new AtlasError("Invalid source hash.", 500);
		const file = path.join(directory(kind), `${hash}.${kind === "original" ? "rnote" : "png"}`);
		const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
		try {
			const stat = fs.fstatSync(fd);
			if (!stat.isFile() || stat.size > MINDMAP_LIMITS[kind]) throw new AtlasError("Invalid saved source.", 500);
			const bytes = fs.readFileSync(fd);
			if (digest(bytes) !== hash) throw new AtlasError("Saved source changed outside Atlas. Restore it from backup.", 409);
			return bytes;
		} finally { fs.closeSync(fd); }
	}
	function writeBlob(kind: "original" | "preview", input: Uint8Array) {
		if (!input.length || input.length > MINDMAP_LIMITS[kind]) throw new AtlasError("Source file exceeds its size limit.", 413);
		const bytes = Buffer.from(input), hash = digest(bytes), dir = directory(kind);
		const target = path.join(dir, `${hash}.${kind === "original" ? "rnote" : "png"}`);
		if (fs.existsSync(target)) { readBlob(kind, hash); return hash; }
		const temp = path.join(dir, `${randomUUID()}.tmp`);
		const fd = fs.openSync(temp, "wx", 0o600);
		try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
		try {
			try { fs.linkSync(temp, target); } catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				readBlob(kind, hash);
			}
		} finally { fs.unlinkSync(temp); }
		const handle = fs.openSync(dir, "r");
		try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
		return hash;
	}
	return {
		retainImage: bytes => writeBlob("preview",bytes),
		image: hash => readBlob("preview",hash),
		capture(raw, original, preview, info) {
			const input = mindmapInput.parse(raw);
			if ((info.previewKind === "manual-png") !== input.manualPreviewAcknowledged)
				throw new AtlasError("Manual preview needs an explicit source confirmation.");
			const hash = digest(original), previewHash = preview ? digest(preview) : null;
			const receipt = digest(JSON.stringify([input, hash, input.manualPreviewAcknowledged ? previewHash : null]));
			const record = mindmapCapture.parse({schemaVersion: 1, id: input.captureId, mapId: input.id, hash, previewHash,
				filename: input.filename, capturedAt: new Date().toISOString(), conceptIds: input.conceptIds, ...info});
			database(db => {
				db.exec("BEGIN IMMEDIATE");
				try {
					const existing = db.prepare("SELECT receipt FROM mindmap_captures WHERE id=?").get(input.captureId);
					if (existing) {
						if (existing.receipt !== receipt) throw new AtlasError("Import token was used for a different file or selection. Start a new import.", 409);
						db.exec("COMMIT"); return;
					}
					const previous = db.prepare("SELECT * FROM mindmaps WHERE id=?").get(input.id);
					if ((previous?.revision ?? 0) !== input.expectedRevision || previous?.archived)
						throw new AtlasError("This map changed or was archived. Reload before importing a revision.", 409);
					for (const id of input.conceptIds)
						if (!db.prepare("SELECT id FROM concepts WHERE id=?").get(id)) throw new AtlasError("A linked concept was removed. Choose its replacement before importing.", 409);
					writeBlob("original", original);
					if (preview) writeBlob("preview", preview);
					db.prepare(`INSERT INTO mindmaps(id,title,revision,currentRevision,archived) VALUES (?, ?, ?, ?, 0)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, revision=excluded.revision, currentRevision=excluded.currentRevision`)
						.run(input.id, input.title, input.expectedRevision+1, input.captureId);
					db.prepare("INSERT INTO mindmap_captures VALUES (?, ?, ?, ?)").run(input.captureId, input.id, JSON.stringify(record), receipt);
					db.exec("COMMIT");
				} catch (error) { db.exec("ROLLBACK"); throw error; }
			});
		},
		setArchived(id, expectedRevision, archived) {
			mindmapId.parse(id);
			database(db => {
				const result = db.prepare("UPDATE mindmaps SET archived=?, revision=revision+1 WHERE id=? AND revision=?")
					.run(archived ? 1 : 0, id, expectedRevision);
				if (!result.changes) throw new AtlasError("This map changed. Reload before continuing.", 409);
			});
		},
		asset(id, kind) {
			mindmapRevisionId.parse(id);
			return database(db => {
				const row = db.prepare("SELECT record FROM mindmap_captures WHERE id=?").get(id);
				if (!row) throw new AtlasError("Source revision not found.", 404);
				const capture = parseCapture(String(row.record));
				if (capture.id !== id) throw new AtlasError("Broken source identity.", 500);
				const hash = kind === "original" ? capture.hash : capture.previewHash;
				if (!hash) throw new AtlasError("No preview is attached to this revision.", 404);
				return {bytes: readBlob(kind, hash), filename: kind === "original" ? capture.filename : "preview.png"};
			});
		},
	};
}
