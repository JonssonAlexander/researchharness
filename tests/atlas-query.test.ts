import assert from "node:assert/strict";
import test from "node:test";
import { findAtlasPath, ATLAS_QUERY_LIMITS } from "../src/core/atlas-query.ts";
import type { AtlasSnapshot } from "../src/core/atlas.ts";
import type { AtlasRelation } from "../src/core/atlas-relations.ts";

const concept = (id: string) => ({
	id,
	title: id,
	aliases: [],
	subjectIds: [],
	preferredSubjectId: null,
	propositionIds: [],
	revision: 1,
	x: 0,
	y: 0,
});
const link = (
	id: string,
	sourceId: string,
	targetId: string,
	change: Partial<AtlasRelation> = {},
): AtlasRelation => ({
	id,
	sourceId,
	targetId,
	relationType: "prerequisite",
	conditions: "Continuous paths only",
	claimStatus: "external-assertion",
	reviewStatus: "accepted",
	evidence: [{ citation: "Reference", locator: "§2" }],
	revision: 1,
	createdAt: "2026-10-28T00:00:00Z",
	updatedAt: "2026-10-28T00:00:00Z",
	contentHash: "fixture",
	...change,
});
const snapshot = (relations: AtlasRelation[], ids = ["a", "b", "c", "d"]): AtlasSnapshot => ({
	concepts: ids.map(concept),
	subjects: [],
	relations,
});

test("shortest path is deterministic and returns original source, condition and status records without writes", () => {
	const direct = link("z", "a", "d"),
		first = link("a", "a", "b"),
		second = link("b", "b", "d");
	const data = snapshot([second, first, direct]);
	const original = JSON.stringify(data);
	const found = findAtlasPath(data, "a", "d");
	assert.equal(found.status, "found");
	if (found.status !== "found") return;
	assert.deepEqual(
		found.steps.map((s) => s.relation.id),
		["z"],
	);
	assert.equal(found.steps[0]!.relation, direct);
	assert.equal(JSON.stringify(data), original);
	const tie = snapshot([link("b", "a", "c"), second, first, link("c", "c", "d")]);
	const result = findAtlasPath(tie, "a", "d");
	assert(result.status === "found");
	assert.deepEqual(
		result.steps.map((s) => s.relation.id),
		["a", "b"],
	);
	tie.relations.reverse();
	assert.deepEqual(findAtlasPath(tie, "a", "d"), result);
});

test("only analogy runs both ways; other directed types keep their exact direction", () => {
	for (const relationType of [
		"prerequisite",
		"generalization",
		"application",
		"counterexample",
		"hypothesis",
	] as const) {
		const data = snapshot([link("r", "a", "b", { relationType })]);
		assert.equal(findAtlasPath(data, "a", "b").status, "found");
		assert.equal(findAtlasPath(data, "b", "a").status, "no-path");
	}
	const data = snapshot([link("r", "a", "b", { relationType: "analogy" })]);
	const result = findAtlasPath(data, "b", "a");
	assert(result.status === "found");
	assert.equal(result.steps[0]!.fromId, "b");
	assert.equal(result.steps[0]!.relation.sourceId, "a");
});

test("mixed paths retain each claim status; proposed, disputed, retracted and uncited links are excluded", () => {
	const data = snapshot([
		link("a", "a", "b", { relationType: "analogy", claimStatus: "hypothesis" }),
		link("b", "b", "c", { claimStatus: "numerical-observation" }),
	]);
	const result = findAtlasPath(data, "a", "c");
	assert(result.status === "found");
	assert.deepEqual(
		result.steps.map((s) => s.relation.claimStatus),
		["hypothesis", "numerical-observation"],
	);
	for (const reviewStatus of ["proposed", "disputed", "retracted"] as const)
		assert.equal(
			findAtlasPath(snapshot([link("r", "a", "b", { reviewStatus })]), "a", "b").status,
			"no-path",
		);
	assert.equal(findAtlasPath(snapshot([link("r", "a", "b", { evidence: [] })]), "a", "b").status, "no-path");
	assert.equal(
		findAtlasPath(snapshot([link("r", "a", "b", { evidence: [{ citation: "  ", locator: "" }] })]), "a", "b")
			.status,
		"no-path",
	);
});

test("cycles and dangling endpoints cannot fabricate a path; missing or equal selections are invalid", () => {
	const data = snapshot([
		link("a", "a", "b"),
		link("b", "b", "a"),
		link("c", "b", "missing"),
		link("d", "missing", "d"),
	]);
	assert.equal(findAtlasPath(data, "a", "d").status, "no-path");
	assert.equal(findAtlasPath(data, "a", "a").status, "invalid");
	assert.equal(findAtlasPath(data, "a", "missing").status, "invalid");
});

test("depth and size bounds return a visible limit, never a false no-path conclusion", () => {
	const ids = Array.from({ length: 8 }, (_, i) => String(i));
	const data = snapshot(
		ids.slice(1).map((id, i) => link(String(i), String(i), id)),
		ids,
	);
	assert.equal(findAtlasPath(data, "0", "6").status, "found");
	assert.equal(findAtlasPath(data, "0", "7").status, "limited");
	const wideIds = ["start", ...Array.from({ length: ATLAS_QUERY_LIMITS.visits }, (_, i) => `x${i}`), "end"];
	const wide = snapshot(
		wideIds.slice(1, -1).map((id) => link(id, "start", id)),
		wideIds,
	);
	assert.equal(findAtlasPath(wide, "start", "end").status, "limited");
	const large = snapshot(
		Array.from({ length: ATLAS_QUERY_LIMITS.relations + 1 }, (_, i) => link(String(i), "a", "b")),
	);
	assert.equal(findAtlasPath(large, "a", "b").status, "limited");
});
