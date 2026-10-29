import assert from "node:assert/strict";
import test from "node:test";
import {mapDraft,toggleDraftConnection} from "../src/core/map-draft.ts";
import {draftFixture} from "./fixtures/map-draft.ts";

test("pair toggle removes existing connections in either direction and creates an untyped review link",()=>{
	const original=structuredClone(draftFixture);
	const removed=toggleDraftConnection(original,"draft_b","draft_a","edge_unused");
	assert.equal(removed.connections.length,0);assert.deepEqual(original,draftFixture);
	const added=toggleDraftConnection(removed,"draft_a","draft_b","edge_new");
	assert.equal(added.connections.length,1);
	assert.deepEqual([added.connections[0]!.source,added.connections[0]!.target,added.connections[0]!.direction,added.connections[0]!.relationType],["draft_a","draft_b","unclear",null]);
	assert.equal(added.connections[0]!.origin,"explanation");mapDraft.parse(added);
	assert.equal(toggleDraftConnection(added,"draft_b","draft_a","edge_unused").connections.length,0);
	assert.equal(toggleDraftConnection(original,"draft_a","draft_a","edge_unused"),original);
	assert.equal(toggleDraftConnection(original,"draft_a","draft_missing","edge_unused"),original);
});
