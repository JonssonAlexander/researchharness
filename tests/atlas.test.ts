import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { atlasCommandSchema, projectAtlas, type ConceptInput, type SubjectInput } from "../src/core/atlas.ts";
import { createAtlasStore } from "../src/store/atlas.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-test-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
const { createAtlasService, atlasResponse, saveAtlasResponse } = await import("../src/server/atlas.ts");
const { stores } = await import("../src/server/stores.ts");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const subject = (title = "Probability"): SubjectInput => ({
	kind: "subject",
	id: `as_${randomUUID()}`,
	expectedRevision: 0,
	title,
	color: "#65a3dc",
	parentId: null,
});
const concept = (subjects: string[] = []): ConceptInput => ({
	kind: "concept",
	id: `ac_${randomUUID()}`,
	expectedRevision: 0,
	title: "Brownian motion",
	aliases: ["Wiener process"],
	subjectIds: subjects,
	preferredSubjectId: subjects[0] ?? null,
	propositionIds: ["n_fixture"],
});
function fixture() {
	const file = path.join(root, randomUUID(), "atlas.sqlite");
	const store = createAtlasStore(file);
	const known = new Set(["n_fixture"]);
	return { file, store, known, service: createAtlasService(store, () => known) };
}

test("one stable concept belongs to two subjects, links existing mathematics and survives a new store instance", () => {
	const { file, service } = fixture();
	const a = subject(),
		b = subject("Analysis");
	service.save(a);
	service.save(b);
	const c = concept([a.id, b.id]);
	service.save(c);
	const saved = createAtlasStore(file).read();
	assert.equal(saved.concepts.length, 1);
	assert.equal(saved.concepts[0]!.id, c.id);
	assert.deepEqual(new Set(saved.concepts[0]!.subjectIds), new Set([a.id, b.id]));
	assert.equal(saved.concepts[0]!.preferredSubjectId, a.id);
	assert.deepEqual(saved.concepts[0]!.propositionIds, ["n_fixture"]);
	const projection = projectAtlas(saved);
	assert.equal(projection.nodes.length, 1);
	assert.equal(projection.nodes[0]!.color, a.color);
	assert.deepEqual(
		projection.clusters.flatMap((c) => c.members),
		[c.id],
	);
});

test("rename preserves identity and layout; changing a preferred subject only repositions that concept", () => {
	const { service } = fixture();
	const a = subject(),
		b = subject("Analysis");
	service.save(a);
	service.save(b);
	const c = concept([a.id, b.id]),
		other = concept([b.id]);
	service.save(c);
	service.save(other);
	const before = service.read();
	service.save({ ...c, title: "Wiener process", expectedRevision: 1 });
	service.save({ ...a, title: "Stochastics", expectedRevision: 1 });
	const renamed = service.read();
	assert.deepEqual(
		renamed.concepts.map(({ id, x, y }) => ({ id, x, y })),
		before.concepts.map(({ id, x, y }) => ({ id, x, y })),
	);
	service.save({ ...c, preferredSubjectId: b.id, expectedRevision: 2 });
	const moved = service.read();
	assert.deepEqual(
		moved.concepts.find((v) => v.id === other.id),
		before.concepts.find((v) => v.id === other.id),
	);
	assert.notEqual(
		moved.concepts.find((v) => v.id === c.id)!.x,
		before.concepts.find((v) => v.id === c.id)!.x,
	);
});

test("stale edits and duplicate create retries cannot overwrite a newer revision or duplicate an identity", () => {
	const { service } = fixture();
	const c = concept();
	service.save(c);
	assert.throws(() => service.save(c), /changed/);
	service.save({ ...c, title: "Updated", expectedRevision: 1 });
	assert.throws(() => service.save({ ...c, title: "Stale", expectedRevision: 1 }), /changed/);
	assert.equal(service.read().concepts.length, 1);
	assert.equal(service.read().concepts[0]!.title, "Updated");
});

test("invalid membership updates roll back the complete record and its links", () => {
	const { service } = fixture();
	const a = subject();
	service.save(a);
	const c = concept([a.id]);
	service.save(c);
	const before = service.read();
	const missing = subject().id;
	assert.throws(
		() =>
			service.save({
				...c,
				expectedRevision: 1,
				title: "Lost",
				subjectIds: [missing],
				preferredSubjectId: missing,
			}),
		/no longer exists/,
	);
	assert.deepEqual(service.read(), before);
	assert(!atlasCommandSchema.safeParse({ ...c, subjectIds: [a.id, a.id] }).success);
	assert(!atlasCommandSchema.safeParse({ ...c, preferredSubjectId: missing }).success);
});

test("the subject hierarchy refuses cycles and unknown parents, leaving previous metadata intact", () => {
	const { service } = fixture();
	const a = subject(),
		b = { ...subject("Child"), parentId: a.id };
	service.save(a);
	service.save(b);
	const before = service.read();
	assert.throws(() => service.save({ ...a, parentId: b.id, expectedRevision: 1 }), /cycle/);
	assert.throws(() => service.save({ ...subject(), parentId: subject().id }), /no longer exists/);
	assert.deepEqual(service.read(), before);
});

test("unknown or deleted canonical propositions are refused on save and never silently removed on read", () => {
	const { service, known } = fixture();
	const c = concept();
	service.save(c);
	known.clear();
	assert.throws(() => service.save({ ...c, expectedRevision: 1 }), /no longer exists/);
	assert.deepEqual(service.read().concepts[0]!.propositionIds, ["n_fixture"]);
});

test("future and unrecognized databases are refused without rewriting their contents", () => {
	for (const version of [0, 5]) {
		const { file, store } = fixture();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const db = new DatabaseSync(file);
		db.exec(`CREATE TABLE private_record(value TEXT); PRAGMA user_version=${version}`);
		db.close();
		const before = fs.readFileSync(file);
		assert.throws(() => store.read(), /Unrecognized|newer app/);
		assert.deepEqual(fs.readFileSync(file), before);
	}
});

test("corrupt extension records fail visibly instead of dropping knowledge", () => {
	const { file, service, store } = fixture();
	service.save(concept());
	const db = new DatabaseSync(file);
	db.prepare("UPDATE concepts SET title = ''").run();
	db.close();
	assert.throws(() => store.read());
});

test("broken foreign keys and externally introduced hierarchy cycles fail on read", () => {
	for (const brokenReference of [false, true]) {
		const { file, service, store } = fixture();
		const a = subject(),
			b = subject("Analysis");
		service.save(a);
		service.save(b);
		const db = new DatabaseSync(file);
		db.exec("PRAGMA foreign_keys=OFF");
		db.prepare("UPDATE subjects SET parentId=? WHERE id=?").run(b.id, a.id);
		if (brokenReference) db.prepare("DELETE FROM subjects WHERE id=?").run(b.id);
		else db.prepare("UPDATE subjects SET parentId=? WHERE id=?").run(a.id, b.id);
		db.close();
		assert.throws(() => store.read());
	}
});

test("SQLite backup restores the same identities, memberships and positions in a fresh directory", async () => {
	const { file, service } = fixture();
	const a = subject();
	service.save(a);
	service.save(concept([a.id]));
	const restored = path.join(root, randomUUID(), "atlas.sqlite");
	fs.mkdirSync(path.dirname(restored));
	const db = new DatabaseSync(file);
	try {
		await backup(db, restored);
	} finally {
		db.close();
	}
	assert.deepEqual(createAtlasStore(restored).read(), service.read());
});

test("the HTTP boundary preserves canonical ledger bytes and rejects oversized/invalid writes", async () => {
	stores.graphStore.appendNode({
		id: "n_fixture",
		name: "Fixture theorem",
		statement: "Fixture only.",
		aliases: [],
		provenance: [],
		createdAt: "2026-10-28T00:00:00Z",
	});
	const ledger = path.join(root, "graph", "nodes.jsonl");
	const original = fs.readFileSync(ledger);
	const post = (value: unknown, type = "application/json") =>
		saveAtlasResponse(
			new Request("http://localhost/api/atlas", {
				method: "POST",
				headers: { "content-type": type },
				body: JSON.stringify(value),
			}),
		);
	const c = concept();
	assert.equal((await post(c)).status, 200);
	assert.equal((await post(c)).status, 409);
	assert.equal((await post({ ...concept(), propositionIds: ["n_missing"] })).status, 409);
	assert.equal((await post({ ...concept(), title: "x".repeat(65536) })).status, 413);
	assert.equal((await post(c, "text/plain")).status, 415);
	assert.equal((await post({ ...concept(), kind: "theorem" })).status, 400);
	assert.deepEqual(fs.readFileSync(ledger), original);
	const snapshot = await atlasResponse().json();
	assert.equal(snapshot.concepts.length, 1);
});

test("subject removal blocks dependencies and stale edits, preserves concepts and archives the subject", () => {
	const { service, file } = fixture();
	const a = subject(),
		child = { ...subject("Child"), parentId: a.id };
	service.save(a);
	service.save(child);
	const c = concept([a.id]);
	service.save(c);
	const remove = { kind: "subject-delete", id: a.id, expectedRevision: 1 };
	assert.throws(() => service.save(remove), /Move/);
	service.save({ ...c, subjectIds: [], preferredSubjectId: null, expectedRevision: 1 });
	assert.throws(() => service.save(remove), /Move/);
	service.save({ ...child, parentId: null, expectedRevision: 1 });
	service.save({ ...a, title: "Renamed", expectedRevision: 1 });
	assert.throws(() => service.save(remove), /changed/);
	const before = service.read().concepts;
	service.save({ ...remove, expectedRevision: 2 });
	assert.deepEqual(service.read().concepts, before);
	assert.equal(
		service.read().subjects.some((s) => s.id === a.id),
		false,
	);
	assert.throws(() => service.save(a), /removed/);
	const db = new DatabaseSync(file);
	const archive = db.prepare("SELECT record, removedAt FROM subject_archive WHERE id = ?").get(a.id)!;
	assert.equal(JSON.parse(String(archive.record)).title, "Renamed");
	assert(Number.isFinite(Date.parse(String(archive.removedAt))));
	db.close();
});

test("Markdown survives restart, keeps old files, blocks stale saves and detects external edits", () => {
	const { service, file } = fixture();
	const c = { ...concept(), markdown: "# Brownian motion\n\n$[B]_t=t$" };
	service.save(c);
	assert.equal(createAtlasStore(file).read().concepts[0]!.markdown, c.markdown);
	service.save({ ...c, markdown: "Revised", expectedRevision: 1 });
	assert.throws(() => service.save({ ...c, expectedRevision: 1 }), /changed/);
	const directory = path.join(path.dirname(file), "concepts");
	assert.equal(fs.readdirSync(directory).length, 2);
	assert(
		fs.readdirSync(directory).some((f) => fs.readFileSync(path.join(directory, f), "utf8") === c.markdown),
	);
	const current = fs
		.readdirSync(directory)
		.find((f) => fs.readFileSync(path.join(directory, f), "utf8") === "Revised")!;
	fs.writeFileSync(path.join(directory, current), "External work");
	assert.throws(() => service.save({ ...c, expectedRevision: 2 }), /outside Atlas/);
	assert.equal(fs.readFileSync(path.join(directory, current), "utf8"), "External work");
});

test("v1 migration keeps rows, creates a restorable baseline and refuses unsafe note paths", () => {
	const { service, file } = fixture();
	const c = concept();
	service.save(c);
	const db = new DatabaseSync(file);
	db.exec(
		"ALTER TABLE concepts DROP COLUMN markdownPath; DROP TABLE subject_archive; DROP TABLE relation_revisions; DROP TABLE relations; DROP TABLE atlas_archive; PRAGMA user_version=1",
	);
	db.close();
	const saved = createAtlasStore(file).read();
	assert.equal(saved.concepts[0]!.id, c.id);
	assert.equal(saved.concepts[0]!.markdown, "");
	const backups = fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith(".bak"));
	assert.equal(backups.length, 1);
	const old = new DatabaseSync(path.join(path.dirname(file), backups[0]!));
	assert.equal(old.prepare("PRAGMA user_version").get()!.user_version, 1);
	old.close();
	const changed = new DatabaseSync(file);
	changed.prepare("UPDATE concepts SET markdownPath = ?").run("../../secret");
	changed.close();
	assert.throws(() => createAtlasStore(file).read(), /Invalid note/);
});

test("failed v1 migration rolls back schema and full-root restore keeps Markdown", async () => {
	const { service, file } = fixture();
	service.save({ ...concept(), markdown: "Retain this work" });
	const restored = path.join(root, randomUUID());
	fs.mkdirSync(restored);
	const source = new DatabaseSync(file);
	await backup(source, path.join(restored, "atlas.sqlite"));
	source.close();
	fs.cpSync(path.join(path.dirname(file), "concepts"), path.join(restored, "concepts"), { recursive: true });
	assert.deepEqual(createAtlasStore(path.join(restored, "atlas.sqlite")).read(), service.read());
	const db = new DatabaseSync(file);
	db.exec("ALTER TABLE concepts DROP COLUMN markdownPath; PRAGMA user_version=1");
	db.close();
	assert.throws(() => createAtlasStore(file).read(), /already exists/);
	const unchanged = new DatabaseSync(file);
	assert.equal(unchanged.prepare("PRAGMA user_version").get()!.user_version, 1);
	assert(
		!unchanged
			.prepare("PRAGMA table_info(concepts)")
			.all()
			.some((row) => row.name === "markdownPath"),
	);
	unchanged.close();
});

test("typed concept links keep direction, source, claim status, history and canonical ledger bytes", () => {
	const { service, file } = fixture();
	const a = concept(),
		b = concept();
	service.save(a);
	service.save(b);
	const input = {
		kind: "relation",
		id: `ar_${randomUUID()}`,
		expectedRevision: 0,
		sourceId: a.id,
		targetId: b.id,
		relationType: "prerequisite",
		conditions: "For continuous paths",
		claimStatus: "external-assertion",
		reviewStatus: "accepted",
		evidence: [{ citation: "Author, Book", locator: "§2" }],
	};
	const before = service.read().concepts;
	const ledger = path.join(root, "graph", "nodes.jsonl");
	const bytes = fs.readFileSync(ledger);
	service.save(input);
	const relation = service.read().relations[0]!;
	assert.equal(relation.sourceId, a.id);
	assert.equal(relation.targetId, b.id);
	assert.equal(relation.claimStatus, "external-assertion");
	assert.equal(relation.evidence[0]!.locator, "§2");
	assert.equal(projectAtlas(service.read()).semanticEdges.length, 1);
	assert.deepEqual(createAtlasStore(file).read().relations[0], relation);
	assert.throws(() => service.save(input), /changed/);
	assert.throws(() => service.save({ ...input, id: `ar_${randomUUID()}` }), /already exists/);
	service.save({ ...input, sourceId: b.id, targetId: a.id, id: `ar_${randomUUID()}` });
	service.save({ ...input, expectedRevision: 1, reviewStatus: "retracted" });
	assert.equal(projectAtlas(service.read()).semanticEdges.length, 1);
	assert.deepEqual(service.read().concepts, before);
	assert.deepEqual(fs.readFileSync(ledger), bytes);
	const db = new DatabaseSync(file);
	const history = db
		.prepare("SELECT record FROM relation_revisions WHERE id = ? ORDER BY revision")
		.all(input.id);
	assert.deepEqual(
		history.map((r) => JSON.parse(String(r.record)).reviewStatus),
		["accepted", "retracted"],
	);
	assert.equal(service.read().relations[0]!.createdAt, relation.createdAt);
	db.close();
});

test("analogy is symmetric; types, conditions, self-links, missing refs and evidence are validated", () => {
	const { service } = fixture();
	const a = concept(),
		b = concept();
	service.save(a);
	service.save(b);
	const input = {
		kind: "relation",
		id: `ar_${randomUUID()}`,
		expectedRevision: 0,
		sourceId: a.id,
		targetId: b.id,
		relationType: "analogy",
		conditions: "",
		claimStatus: "hypothesis",
		reviewStatus: "proposed",
		evidence: [],
	};
	service.save(input);
	assert.equal(projectAtlas(service.read()).semanticEdges.length, 0);
	assert.throws(
		() => service.save({ ...input, sourceId: b.id, targetId: a.id, id: `ar_${randomUUID()}` }),
		/already exists/,
	);
	assert.throws(
		() => service.save({ ...input, expectedRevision: 1, reviewStatus: "accepted" }),
		/source citation/,
	);
	assert.throws(() => service.save({ ...input, sourceId: a.id, targetId: a.id }), /distinct/);
	assert.throws(
		() => service.save({ ...input, targetId: `ac_${randomUUID()}`, expectedRevision: 1 }),
		/no longer exists/,
	);
	assert.throws(() => service.save({ ...input, relationType: "proves" }), /Invalid/);
	for (const relationType of [
		"prerequisite",
		"generalization",
		"counterexample",
		"application",
		"hypothesis",
	])
		service.save({ ...input, id: `ar_${randomUUID()}`, relationType });
	service.save({ ...input, id: `ar_${randomUUID()}`, conditions: "Under a distinct assumption" });
	assert.equal(service.read().relations.length, 7);
});

test("v2 upgrade preserves notes and placements, backs up data and rolls back a failed upgrade", () => {
	const { service, file } = fixture();
	service.save({ ...concept(), markdown: "Keep me" });
	const before = service.read();
	const db = new DatabaseSync(file);
	db.exec(
		"DROP TABLE relation_revisions; DROP TABLE relations; DROP TABLE atlas_archive; PRAGMA user_version=2",
	);
	db.close();
	assert.deepEqual(createAtlasStore(file).read(), before);
	const old = fs.readdirSync(path.dirname(file)).find((f) => f.includes(".v2-") && f.endsWith(".bak"))!;
	const backupDb = new DatabaseSync(path.join(path.dirname(file), old));
	assert.equal(backupDb.prepare("PRAGMA user_version").get()!.user_version, 2);
	backupDb.close();
	const corrupt = new DatabaseSync(file);
	corrupt.exec("PRAGMA user_version=2");
	corrupt.close();
	assert.throws(() => createAtlasStore(file).read(), /already exists/);
	const unchanged = new DatabaseSync(file);
	assert.equal(unchanged.prepare("PRAGMA user_version").get()!.user_version, 2);
	unchanged.close();
});

test("relation records with broken hashes or references are rejected visibly", () => {
	for (const brokenRef of [false, true]) {
		const { service, file } = fixture();
		const a = concept(),
			b = concept();
		service.save(a);
		service.save(b);
		service.save({
			kind: "relation",
			id: `ar_${randomUUID()}`,
			expectedRevision: 0,
			sourceId: a.id,
			targetId: b.id,
			relationType: "application",
			conditions: "",
			claimStatus: "hypothesis",
			reviewStatus: "disputed",
			evidence: [],
		});
		const db = new DatabaseSync(file);
		db.exec("PRAGMA foreign_keys=OFF");
		db.exec(
			brokenRef ? "UPDATE relations SET targetId='ac_missing'" : "UPDATE relations SET conditions='tampered'",
		);
		db.close();
		assert.throws(() => service.read(), /Invalid|Broken/);
	}
});

test("confirmed removal archives concepts, notes and link history without touching other knowledge", () => {
	const { service, file } = fixture();
	const a = concept(),
		b = concept();
	service.save({ ...a, markdown: "Keep my note" });
	service.save(b);
	const r = {
		kind: "relation",
		id: `ar_${randomUUID()}`,
		expectedRevision: 0,
		sourceId: a.id,
		targetId: b.id,
		relationType: "analogy",
		conditions: "",
		claimStatus: "hypothesis",
		reviewStatus: "proposed",
		evidence: [],
	};
	service.save(r);
	service.save({ ...r, expectedRevision: 1, reviewStatus: "retracted" });
	assert.throws(() => service.save({ kind: "concept-delete", id: a.id, expectedRevision: 1 }), /links first/);
	assert.throws(() => service.save({ kind: "relation-delete", id: r.id, expectedRevision: 1 }), /changed/);
	const other = service.read().concepts.find((c) => c.id === b.id);
	service.save({ kind: "relation-delete", id: r.id, expectedRevision: 2 });
	service.save({ kind: "concept-delete", id: a.id, expectedRevision: 1 });
	assert.deepEqual(service.read().concepts, [other]);
	assert.equal(service.read().relations.length, 0);
	assert.throws(() => service.save(a), /removed/);
	assert.throws(() => service.save(r), /removed/);
	const db = new DatabaseSync(file);
	const archived = db.prepare("SELECT kind, record FROM atlas_archive ORDER BY kind").all();
	assert.equal(JSON.parse(String(archived[0]!.record)).item.markdown, "Keep my note");
	assert.equal(JSON.parse(String(archived[1]!.record)).history.length, 2);
	db.close();
	assert(fs.readdirSync(path.join(path.dirname(file), "concepts")).length > 0);
});

test("demo load, clear, partial retry and reload preserve owner records and refuse shared dependencies", async () => {
	const { createAtlasDemo, removeAtlasDemo, isAtlasDemoId } = await import("../src/core/atlas-demo.ts");
	const { service } = fixture();
	const owner = concept();
	service.save(owner);
	const before = service.read();
	const commands = createAtlasDemo("123456abcdef");
	for (const c of commands) service.save(c);
	assert.equal(service.read().concepts.length, 10);
	assert.equal(service.read().subjects.length, 3);
	const demoConcept = service.read().concepts.find((c) => isAtlasDemoId(c.id))!;
	const ownLink = {
		kind: "relation",
		id: `ar_${randomUUID()}`,
		expectedRevision: 0,
		sourceId: owner.id,
		targetId: demoConcept.id,
		relationType: "analogy",
		conditions: "",
		claimStatus: "hypothesis",
		reviewStatus: "proposed",
		evidence: [],
	};
	service.save(ownLink);
	assert.throws(() => removeAtlasDemo(service.read()), /own work/);
	service.save({ kind: "relation-delete", id: ownLink.id, expectedRevision: 1 });
	const removals = removeAtlasDemo(service.read());
	service.save(removals[0]!);
	for (const command of removeAtlasDemo(service.read())) service.save(command);
	assert.deepEqual(service.read(), before);
	for (const c of createAtlasDemo("abcdef123456")) service.save(c);
	assert.equal(service.read().concepts.length, 10);
});

test("v3 archive migration backs up existing data and preserves rows", () => {
	const { service, file } = fixture();
	service.save(concept());
	const before = service.read();
	const db = new DatabaseSync(file);
	db.exec("DROP TABLE atlas_archive; PRAGMA user_version=3");
	db.close();
	assert.deepEqual(createAtlasStore(file).read(), before);
	const saved = fs.readdirSync(path.dirname(file)).find((f) => f.includes(".v3-") && f.endsWith(".bak"))!;
	const old = new DatabaseSync(path.join(path.dirname(file), saved));
	assert.equal(old.prepare("PRAGMA user_version").get()!.user_version, 3);
	old.close();
});
