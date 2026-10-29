import {mapConnection} from "../core/map-connections.ts";
import {createMapReviewStore} from "./map-review.ts";
import { createMapProposalStore } from "./map-proposals.ts";
import { createMindmapStore, readMindmaps } from "./mindmaps.ts";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
	AtlasError,
	atlasCommandSchema,
	atlasConceptId,
	atlasViewInput,
	assertSubjectParent,
	type AtlasCommand,
	type AtlasConcept,
	type AtlasSnapshot,
	type AtlasStore,
	type AtlasSubject,
} from "../core/atlas.ts";

import { translateAtlasSubject } from "../core/atlas-layout.ts";
import { atlasRelationSchema, normalizeRelation, type AtlasRelation } from "../core/atlas-relations.ts";

const SCHEMA = `
CREATE TABLE subjects (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, color TEXT NOT NULL,
 parentId TEXT REFERENCES subjects(id), revision INTEGER NOT NULL CHECK(revision > 0),
 x REAL NOT NULL, y REAL NOT NULL
) STRICT;
CREATE TABLE concepts (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, aliases TEXT NOT NULL CHECK(json_valid(aliases)),
 preferredSubjectId TEXT, revision INTEGER NOT NULL CHECK(revision > 0), x REAL NOT NULL, y REAL NOT NULL,
 FOREIGN KEY(id, preferredSubjectId) REFERENCES concept_subjects(conceptId, subjectId) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE concept_subjects (
 conceptId TEXT REFERENCES concepts(id), subjectId TEXT REFERENCES subjects(id),
 PRIMARY KEY(conceptId, subjectId)
) STRICT;
CREATE TABLE concept_propositions (
 conceptId TEXT REFERENCES concepts(id), propositionId TEXT NOT NULL,
 PRIMARY KEY(conceptId, propositionId)
) STRICT;
PRAGMA user_version = 1;`;

/** Short synchronous transactions; no process-global DB handle or native addon. */
export function createAtlasStore(file: string): AtlasStore {
	function database<T>(run: (db: DatabaseSync) => T): T {
		fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
		if (fs.existsSync(file) && !fs.lstatSync(file).isFile())
			throw new AtlasError("Atlas database must be a regular file.");
		if (!fs.existsSync(file)) fs.closeSync(fs.openSync(file, "wx", 0o600));
		const db = new DatabaseSync(file, { timeout: 1000 });
		try {
			const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
			if (version > 10)
				throw new AtlasError("This Atlas database needs a newer app. Upgrade before opening it.", 409);
			if (version === 0) {
				const tables = db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
				if (tables.length) throw new AtlasError("Unrecognized Atlas database; no changes were made.", 409);
				db.exec("BEGIN IMMEDIATE");
				try {
					db.exec(SCHEMA);
					db.exec("COMMIT");
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
			}
			db.exec("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;");
			if (version < 2) {
				// Preserve a recoverable v1 baseline before changing an existing database.
				if (version === 1) db.prepare("VACUUM INTO ?").run(`${file}.v1-${randomUUID()}.bak`);
				db.exec("BEGIN IMMEDIATE");
				try {
					db.exec(`ALTER TABLE concepts ADD COLUMN markdownPath TEXT;
CREATE TABLE subject_archive (id TEXT PRIMARY KEY, record TEXT NOT NULL, removedAt TEXT NOT NULL) STRICT;
PRAGMA user_version = 2;`);
					db.exec("COMMIT");
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
			}
			if (version < 3) {
				if (version === 2) db.prepare("VACUUM INTO ?").run(`${file}.v2-${randomUUID()}.bak`);
				db.exec("BEGIN IMMEDIATE");
				try {
					db.exec(`CREATE TABLE relations (
 id TEXT PRIMARY KEY, sourceId TEXT NOT NULL REFERENCES concepts(id), targetId TEXT NOT NULL REFERENCES concepts(id),
 relationType TEXT NOT NULL, conditions TEXT NOT NULL, claimStatus TEXT NOT NULL, reviewStatus TEXT NOT NULL,
 evidence TEXT NOT NULL CHECK(json_valid(evidence)), revision INTEGER NOT NULL CHECK(revision > 0),
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, contentHash TEXT NOT NULL,
 CHECK(sourceId != targetId), UNIQUE(sourceId, targetId, relationType, conditions)
) STRICT;
CREATE TABLE relation_revisions (
 id TEXT NOT NULL REFERENCES relations(id), revision INTEGER NOT NULL, record TEXT NOT NULL CHECK(json_valid(record)),
 PRIMARY KEY(id, revision)
) STRICT;
PRAGMA user_version = 3;`);
					db.exec("COMMIT");
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
			}
			if (version < 4) {
				if (version === 3) db.prepare("VACUUM INTO ?").run(`${file}.v3-${randomUUID()}.bak`);
				db.exec("BEGIN IMMEDIATE");
				try {
					db.exec(`CREATE TABLE atlas_archive (
 kind TEXT NOT NULL, id TEXT NOT NULL, record TEXT NOT NULL CHECK(json_valid(record)), removedAt TEXT NOT NULL,
 PRIMARY KEY(kind, id)
) STRICT; PRAGMA user_version = 4;`);
					db.exec("COMMIT");
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
			}
			if (version < 5) {
				if (version === 4) db.prepare("VACUUM INTO ?").run(`${file}.v4-${randomUUID()}.bak`);
				db.exec("BEGIN IMMEDIATE");
				try {
					db.exec(`ALTER TABLE subjects ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1));
CREATE TABLE atlas_layout_version (revision INTEGER NOT NULL) STRICT;
INSERT INTO atlas_layout_version VALUES (0);
PRAGMA user_version = 5;`);
					db.exec("COMMIT");
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
			}
			if (version < 6) {
				if (version === 5) db.prepare("VACUUM INTO ?").run(`${file}.v5-${randomUUID()}.bak`);
				db.exec("BEGIN IMMEDIATE");
				try {
					db.exec(`CREATE TABLE atlas_views (
 id TEXT PRIMARY KEY, title TEXT NOT NULL COLLATE NOCASE UNIQUE, revision INTEGER NOT NULL,
 camera TEXT NOT NULL CHECK(json_valid(camera)), query TEXT NOT NULL
) STRICT; PRAGMA user_version = 6;`);
					db.exec("COMMIT");
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
			}
			if (version < 7) {
				if (version === 6) db.prepare("VACUUM INTO ?").run(`${file}.v6-${randomUUID()}.bak`);
				db.exec("BEGIN IMMEDIATE");
				try {
					db.exec(`CREATE TABLE mindmaps (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL,
 currentRevision TEXT NOT NULL, archived INTEGER NOT NULL CHECK(archived IN (0,1))
) STRICT;
CREATE TABLE mindmap_captures (
 id TEXT PRIMARY KEY, mapId TEXT NOT NULL REFERENCES mindmaps(id),
 record TEXT NOT NULL CHECK(json_valid(record)), receipt TEXT NOT NULL
) STRICT; PRAGMA user_version = 7;`);
					db.exec("COMMIT");
				} catch (error) { db.exec("ROLLBACK"); throw error; }
			}
			if (version < 8) {
				if (version === 7) db.prepare("VACUUM INTO ?").run(`${file}.v7-${randomUUID()}.bak`);
				db.exec("BEGIN IMMEDIATE");
				try {
					db.exec(`CREATE TABLE map_proposals (
 id TEXT PRIMARY KEY, sourceRevision TEXT NOT NULL REFERENCES mindmap_captures(id), status TEXT NOT NULL,
 owner TEXT NOT NULL, record TEXT NOT NULL CHECK(json_valid(record))
) STRICT;
CREATE UNIQUE INDEX one_proposal_run ON map_proposals(sourceRevision) WHERE status='running';
PRAGMA user_version=8;`);
					db.exec("COMMIT");
				} catch(error) {db.exec("ROLLBACK");throw error;}
			}
			if(version<9){
				if(version===8)db.prepare("VACUUM INTO ?").run(`${file}.v8-${randomUUID()}.bak`);
				db.exec(`BEGIN IMMEDIATE;
CREATE TABLE map_reviews (proposalId TEXT NOT NULL REFERENCES map_proposals(id), revision INTEGER NOT NULL, record TEXT NOT NULL CHECK(json_valid(record)), PRIMARY KEY(proposalId,revision)) STRICT;
CREATE TABLE map_integrations (id TEXT PRIMARY KEY, proposalId TEXT NOT NULL REFERENCES map_proposals(id), status TEXT NOT NULL CHECK(status IN ('prepared','committed')), record TEXT NOT NULL CHECK(json_valid(record))) STRICT;
CREATE UNIQUE INDEX one_map_commit ON map_integrations(proposalId) WHERE status='committed';
CREATE TABLE map_concept_reviews (integrationId TEXT NOT NULL REFERENCES map_integrations(id), conceptId TEXT NOT NULL, sourceRevision TEXT NOT NULL REFERENCES mindmap_captures(id), reasons TEXT NOT NULL CHECK(json_valid(reasons)), PRIMARY KEY(integrationId,conceptId)) STRICT;
PRAGMA user_version=9; COMMIT;`);
			}
			if(version<10){
				if(version===9)db.prepare("VACUUM INTO ?").run(`${file}.v9-${randomUUID()}.bak`);
				db.exec(`BEGIN IMMEDIATE;
DROP INDEX one_map_commit;
CREATE UNIQUE INDEX one_map_commit ON map_integrations(proposalId) WHERE status='committed' AND json_extract(record,'$.repairOf') IS NULL;
CREATE TABLE map_connections (
 id TEXT PRIMARY KEY, proposalId TEXT NOT NULL REFERENCES map_proposals(id), connectionKey TEXT NOT NULL,
 sourceRevision TEXT NOT NULL REFERENCES mindmap_captures(id), sourceId TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
 targetId TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE, record TEXT NOT NULL CHECK(json_valid(record)), contentHash TEXT NOT NULL,
 UNIQUE(proposalId,connectionKey), CHECK(sourceId!=targetId)
) STRICT;
PRAGMA user_version=10; COMMIT;`);
			}
			return run(db);
		} finally {
			db.close();
		}
	}
	function notePath(id: string, hash: string): string {
		atlasConceptId.parse(id);
		if (!/^[a-f0-9]{64}$/.test(hash)) throw new AtlasError("Invalid note reference.", 500);
		const directory = path.join(path.dirname(file), "concepts");
		if (fs.existsSync(directory) && !fs.lstatSync(directory).isDirectory())
			throw new AtlasError("Notes must be a regular directory.", 500);
		return path.join(directory, `${id}-${hash}.md`);
	}
	const digest = (text: string) => createHash("sha256").update(text).digest("hex");
	function readNote(id: string, hash: string | null): string {
		if (!hash) return "";
		const target = notePath(id, hash);
		if (!fs.lstatSync(target).isFile()) throw new AtlasError("Note must be a regular file.", 500);
		const text = fs.readFileSync(target, "utf8");
		if (digest(text) !== hash)
			throw new AtlasError("Note changed outside Atlas. Restore its saved revision before editing.", 409);
		return text;
	}
	function writeNote(id: string, text: string): string | null {
		if (!text) return null;
		const hash = digest(text),
			target = notePath(id, hash);
		fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
		if (fs.existsSync(target)) readNote(id, hash);
		else {
			const temp=path.join(path.dirname(target), `${randomUUID()}.tmp`);
			const fd = fs.openSync(temp, "wx", 0o600);
			try {
				fs.writeFileSync(fd, text);
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
			try {try{fs.linkSync(temp,target);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;readNote(id,hash);}}
			finally{fs.unlinkSync(temp);}
			if (process.platform !== "win32") {
				const dir = fs.openSync(path.dirname(target), "r");
				try {
					fs.fsyncSync(dir);
				} finally {
					fs.closeSync(dir);
				}
			}
		}
		return hash;
	}
	function snapshot(db: DatabaseSync): AtlasSnapshot {
		if (db.prepare("PRAGMA foreign_key_check").all().length)
			throw new AtlasError("Broken Atlas references.", 500);
		const subjects = db.prepare("SELECT * FROM subjects ORDER BY rowid").all().map(({locked, ...row}) => {
			if (locked !== 0 && locked !== 1) throw new AtlasError("Invalid layout lock.", 500);
			return {...row, locked: locked === 1} as unknown as AtlasSubject;
		});
		const concepts = db
			.prepare("SELECT * FROM concepts ORDER BY rowid")
			.all()
			.map((row) => {
				const subjectIds = db
					.prepare("SELECT subjectId FROM concept_subjects WHERE conceptId = ? ORDER BY subjectId")
					.all(row.id!)
					.map((s) => String(s.subjectId));
				const propositionIds = db
					.prepare(
						"SELECT propositionId FROM concept_propositions WHERE conceptId = ? ORDER BY propositionId",
					)
					.all(row.id!)
					.map((p) => String(p.propositionId));
				const { markdownPath, ...record } = row;
				return {
					...record,
					markdown: readNote(String(row.id), markdownPath as string | null),
					aliases: JSON.parse(String(row.aliases)),
					subjectIds,
					propositionIds,
				} as unknown as AtlasConcept;
			});
		// Validate persisted rows rather than silently accepting malformed extension data.
		for (const [kind, rows] of [
			["subject", subjects],
			["concept", concepts],
		] as const)
			for (const row of rows) {
				const { revision, x, y, locked: _locked, ...input } = row as typeof row & { locked?: boolean };
				void _locked;
				if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isFinite(x) || !Number.isFinite(y))
					throw new AtlasError("Invalid Atlas record.", 500);
				atlasCommandSchema.parse({ ...input, kind, expectedRevision: revision });
			}
		for (const subject of subjects) assertSubjectParent(subjects, subject.id, subject.parentId);
		const relations = db
			.prepare("SELECT * FROM relations ORDER BY rowid")
			.all()
			.map((row) => {
				const { revision, createdAt, updatedAt, contentHash, ...input } = row;
				const command = atlasRelationSchema.parse({
					...input,
					evidence: JSON.parse(String(row.evidence)),
					kind: "relation",
					expectedRevision: revision,
				});
				const normalized = normalizeRelation(command);
				if (
					normalized.sourceId !== command.sourceId ||
					!Number.isSafeInteger(revision) ||
					Number(revision) < 1 ||
					!Number.isFinite(Date.parse(String(createdAt))) ||
					!Number.isFinite(Date.parse(String(updatedAt))) ||
					digest(JSON.stringify(command)) !== contentHash
				)
					throw new AtlasError("Invalid Atlas relation record.", 500);
				const { kind: _kind, expectedRevision: _expected, ...fields } = command;
				return { ...fields, revision, createdAt, updatedAt, contentHash } as AtlasRelation;
			});
		const versions = db.prepare("SELECT revision FROM atlas_layout_version").all();
		const layoutRevision = Number(versions[0]?.revision);
		if (versions.length !== 1 || !Number.isSafeInteger(layoutRevision) || layoutRevision < 0)
			throw new AtlasError("Invalid Atlas layout version.", 500);
		const views = db.prepare("SELECT * FROM atlas_views ORDER BY rowid").all().map(row => {
			const {revision: savedRevision, ...input} = row;
			if (!Number.isSafeInteger(savedRevision) || Number(savedRevision) < 1)
				throw new AtlasError("Invalid saved view revision.", 500);
			const parsed = atlasViewInput.parse({...input, camera: JSON.parse(String(row.camera)), kind: "view", expectedRevision: savedRevision});
			const {kind: _kind, expectedRevision, ...fields} = parsed;
			return {...fields, revision: expectedRevision};
		});
		const conceptReviews:Record<string,string[]>={};
		for(const row of db.prepare("SELECT conceptId,reasons FROM map_concept_reviews").all())
			conceptReviews[String(row.conceptId)]=[...new Set([...(conceptReviews[String(row.conceptId)]??[]),...JSON.parse(String(row.reasons))])];
		const mindmaps=readMindmaps(db),mapConnections=db.prepare("SELECT * FROM map_connections ORDER BY rowid").all().map(row=>{
			const raw=JSON.parse(String(row.record));if(raw.schemaVersion!==1)throw new AtlasError("These mind-map connections need a newer app.",409);
			const c=mapConnection.parse(raw);
			if(c.id!==row.id||c.proposalId!==row.proposalId||c.connectionKey!==row.connectionKey||c.sourceRevision!==row.sourceRevision||c.sourceId!==row.sourceId||c.targetId!==row.targetId||digest(JSON.stringify(c))!==row.contentHash||!mindmaps.some(m=>m.captures.some(r=>r.id===c.sourceRevision&&r.hash===c.sourceHash)))throw new AtlasError("Broken mind-map connection provenance.",409);
			return c;
		});
		return { subjects, concepts, relations, layoutRevision, views, mindmaps, conceptReviews,mapConnections };
	}
	const mindmaps = createMindmapStore(database, path.dirname(file));
	const proposals=createMapProposalStore(database,mindmaps);
	return {
		mindmaps,
		proposals,
		reviews:createMapReviewStore(database,proposals,snapshot,writeNote,revision=>{mindmaps.asset(revision,"original");}),
		read: () => database(snapshot),
		save: (input: AtlasCommand) =>
			database((db) => {
				const command = atlasCommandSchema.parse(input);
				db.exec("BEGIN IMMEDIATE");
				try {
					const current = snapshot(db);
					if (command.kind === "view" || command.kind === "view-delete") {
						const previous = current.views?.find(v => v.id === command.id);
						if ((previous?.revision ?? 0) !== command.expectedRevision)
							throw new AtlasError("This view changed. Reload before saving.", 409);
						if (command.kind === "view-delete") {
							db.prepare("INSERT INTO atlas_archive VALUES ('view', ?, ?, ?)").run(command.id, JSON.stringify(previous), new Date().toISOString());
							db.prepare("DELETE FROM atlas_views WHERE id=?").run(command.id);
						} else {
							if (db.prepare("SELECT id FROM atlas_archive WHERE kind='view' AND id=?").get(command.id))
								throw new AtlasError("This view was removed. Save a new view.", 409);
							if (!previous && (current.views?.length ?? 0) >= 100)
								throw new AtlasError("Keep at most 100 saved views. Remove one before saving another.");
							if (current.views?.some(v => v.id !== command.id && v.title.toLowerCase() === command.title.toLowerCase()))
								throw new AtlasError("A view with this name already exists.", 409);
							db.prepare(`INSERT INTO atlas_views VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, revision=excluded.revision, camera=excluded.camera, query=excluded.query`)
								.run(command.id, command.title, command.expectedRevision+1, JSON.stringify(command.camera), command.query);
						}
						db.exec("COMMIT");
						return;
					}
					if (command.kind === "subject-move") {
						if (command.expectedRevision !== current.layoutRevision)
							throw new AtlasError("Atlas changed while moving. Reload before saving.", 409);
						const moved = translateAtlasSubject(current, command.id, command.dx, command.dy);
						for (const p of moved.positions)
							db.prepare("UPDATE concepts SET x=?, y=?, revision=revision+1 WHERE id=?").run(p.x, p.y, p.id);
						db.prepare("UPDATE subjects SET x=?, y=?, revision=revision+1 WHERE id=?").run(moved.anchor.x, moved.anchor.y, command.id);
						db.exec("UPDATE atlas_layout_version SET revision=revision+1; COMMIT");
						return;
					}
					if (command.kind === "layout") {
						if (command.expectedRevision !== current.layoutRevision)
							throw new AtlasError("Atlas changed while arranging. Reload before saving.", 409);
						for (const position of command.positions) {
							const concept = current.concepts.find(c => c.id === position.id);
							if (!concept || current.subjects.find(s => s.id === concept.preferredSubjectId)?.locked)
								throw new AtlasError("Concept is missing or its subject is locked.", 409);
							db.prepare("UPDATE concepts SET x=?, y=?, revision=revision+1 WHERE id=?").run(position.x, position.y, position.id);
						}
						db.exec("UPDATE atlas_layout_version SET revision=revision+1; COMMIT");
						return;
					}
					const rows =
						command.kind === "relation" || command.kind === "relation-delete"
							? current.relations
							: command.kind === "concept" ||
								  command.kind === "concept-delete" ||
								  command.kind === "concept-position"
								? current.concepts
								: current.subjects;
					const previous = rows.find((r) => r.id === command.id);
					if ((previous?.revision ?? 0) !== command.expectedRevision)
						throw new AtlasError("This item changed. Reload it before saving.", 409);
					if (command.kind === "subject-lock") {
						db.prepare("UPDATE subjects SET locked=?, revision=revision+1 WHERE id=?").run(command.locked ? 1 : 0, command.id);
					} else if (command.kind === "concept-position" || command.kind === "subject-position") {
						if (!previous) throw new AtlasError("Item no longer exists.", 409);
						if (command.kind === "concept-position" && current.subjects.find(s => s.id === (previous as AtlasConcept).preferredSubjectId)?.locked)
							throw new AtlasError("Unlock this subject before moving its concepts.", 409);
						const table = command.kind === "concept-position" ? "concepts" : "subjects";
						db.prepare(`UPDATE ${table} SET x=?, y=?, revision=revision+1 WHERE id=?`).run(
							command.x,
							command.y,
							command.id,
						);
					} else if (command.kind === "concept-delete" || command.kind === "relation-delete") {
						if (!previous) throw new AtlasError("Item no longer exists.", 409);
						const kind = command.kind === "concept-delete" ? "concept" : "relation";
						if (
							kind === "concept" &&
							current.relations.some((r) => r.sourceId === command.id || r.targetId === command.id)
						)
							throw new AtlasError("Delete this concept's links first. Propositions will be kept.", 409);
						const history =
							kind === "relation"
								? db
										.prepare("SELECT record FROM relation_revisions WHERE id=? ORDER BY revision")
										.all(command.id)
										.map((r) => JSON.parse(String(r.record)))
								: (current.mapConnections??[]).filter(c=>c.sourceId===command.id||c.targetId===command.id);
						db.prepare("INSERT INTO atlas_archive VALUES (?, ?, ?, ?)").run(
							kind,
							command.id,
							JSON.stringify({ item: previous, history }),
							new Date().toISOString(),
						);
						if (kind === "relation") {
							db.prepare("DELETE FROM relation_revisions WHERE id=?").run(command.id);
							db.prepare("DELETE FROM relations WHERE id=?").run(command.id);
						} else {
							db.prepare("DELETE FROM concept_subjects WHERE conceptId=?").run(command.id);
							db.prepare("DELETE FROM concept_propositions WHERE conceptId=?").run(command.id);
							db.prepare("DELETE FROM concepts WHERE id=?").run(command.id);
						}
					} else if (command.kind === "relation") {
						if (db.prepare("SELECT id FROM atlas_archive WHERE kind='relation' AND id=?").get(command.id))
							throw new AtlasError("This link was removed. Create a new link.", 409);
						const relation = normalizeRelation(command);
						if (
							![relation.sourceId, relation.targetId].every((id) => current.concepts.some((c) => c.id === id))
						)
							throw new AtlasError("A linked concept no longer exists.", 409);
						if (
							current.relations.some(
								(r) =>
									r.id !== relation.id &&
									r.sourceId === relation.sourceId &&
									r.targetId === relation.targetId &&
									r.relationType === relation.relationType &&
									r.conditions === relation.conditions,
							)
						)
							throw new AtlasError("This link already exists. Edit the existing link.", 409);
						const revision = command.expectedRevision + 1,
							now = new Date().toISOString();
						const contentHash = digest(JSON.stringify({ ...relation, expectedRevision: revision }));
						const createdAt = previous && "createdAt" in previous ? previous.createdAt : now;
						db.prepare(
							`INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET sourceId=excluded.sourceId, targetId=excluded.targetId, relationType=excluded.relationType,
conditions=excluded.conditions, claimStatus=excluded.claimStatus, reviewStatus=excluded.reviewStatus, evidence=excluded.evidence,
revision=excluded.revision, updatedAt=excluded.updatedAt, contentHash=excluded.contentHash`,
						).run(
							relation.id,
							relation.sourceId,
							relation.targetId,
							relation.relationType,
							relation.conditions,
							relation.claimStatus,
							relation.reviewStatus,
							JSON.stringify(relation.evidence),
							revision,
							createdAt,
							now,
							contentHash,
						);
						db.prepare("INSERT INTO relation_revisions VALUES (?, ?, ?)").run(
							relation.id,
							revision,
							JSON.stringify({
								...relation,
								expectedRevision: revision,
								createdAt,
								updatedAt: now,
								contentHash,
							}),
						);
					} else if (command.kind === "subject-delete") {
						if (!previous) throw new AtlasError("Subject no longer exists.", 409);
						if (
							current.concepts.some((c) => c.subjectIds.includes(command.id)) ||
							current.subjects.some((s) => s.parentId === command.id)
						)
							throw new AtlasError(
								"Move this subject's concepts and child subjects before deleting it.",
								409,
							);
						db.prepare("INSERT INTO subject_archive VALUES (?, ?, ?)").run(
							command.id,
							JSON.stringify(previous),
							new Date().toISOString(),
						);
						db.prepare("DELETE FROM subjects WHERE id = ?").run(command.id);
					} else if (command.kind === "subject") {
						if (db.prepare("SELECT id FROM subject_archive WHERE id = ?").get(command.id))
							throw new AtlasError("This subject was removed. Create a new subject instead.", 409);
						assertSubjectParent(current.subjects, command.id, command.parentId);
						const index = current.subjects.length;
						db.prepare(
							`INSERT INTO subjects(id,title,color,parentId,revision,x,y) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, color=excluded.color, parentId=excluded.parentId, revision=excluded.revision`,
						).run(
							command.id,
							command.title,
							command.color,
							command.parentId,
							command.expectedRevision + 1,
							previous && "x" in previous ? previous.x : (index % 2) * 520,
							previous && "y" in previous ? previous.y : Math.floor(index / 2) * 420,
						);
					} else {
						if (db.prepare("SELECT id FROM atlas_archive WHERE kind='concept' AND id=?").get(command.id))
							throw new AtlasError("This concept was removed. Create a new concept.", 409);
						if (command.subjectIds.some((id) => !current.subjects.some((s) => s.id === id)))
							throw new AtlasError("A selected subject no longer exists.");
						const anchor = current.subjects.find((s) => s.id === command.preferredSubjectId);
						const index = current.concepts.filter(
							(c) => c.preferredSubjectId === command.preferredSubjectId,
						).length;
						const seedX = (anchor?.x ?? -600) + ((index % 3) - 1) * 140;
						const seedY = (anchor?.y ?? 0) + Math.floor(index / 3) * 120;
						const keepPosition =
							previous &&
							"preferredSubjectId" in previous &&
							previous.preferredSubjectId === command.preferredSubjectId;
						db.prepare(
							`INSERT INTO concepts VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, aliases=excluded.aliases, preferredSubjectId=excluded.preferredSubjectId, revision=excluded.revision, x=excluded.x, y=excluded.y, markdownPath=excluded.markdownPath`,
						).run(
							command.id,
							command.title,
							JSON.stringify(command.aliases),
							command.preferredSubjectId,
							command.expectedRevision + 1,
							keepPosition ? previous.x : seedX,
							keepPosition ? previous.y : seedY,
							writeNote(
								command.id,
								command.markdown ?? (previous && "markdown" in previous ? (previous.markdown ?? "") : ""),
							),
						);
						for (const [table, column, ids] of [
							["concept_subjects", "subjectId", command.subjectIds],
							["concept_propositions", "propositionId", command.propositionIds],
						] as const) {
							db.prepare(`DELETE FROM ${table} WHERE conceptId = ?`).run(command.id);
							const insert = db.prepare(`INSERT INTO ${table}(conceptId, ${column}) VALUES (?, ?)`);
							for (const id of ids) insert.run(command.id, id);
						}
					}
					db.exec("UPDATE atlas_layout_version SET revision=revision+1; COMMIT");
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
			}),
	};
}
