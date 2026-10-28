import type { AtlasSnapshot } from "./atlas.ts";
import type { AtlasRelation } from "./atlas-relations.ts";

export interface AtlasPathStep {
	fromId: string;
	toId: string;
	relation: AtlasRelation;
}
export interface AtlasPathFocus {
	conceptIds: string[];
	relationIds: string[];
}
export type AtlasPathResult =
	| { status: "found"; steps: AtlasPathStep[] }
	| { status: "invalid" | "no-path" | "limited" };
export const ATLAS_QUERY_LIMITS = { depth: 6, visits: 2000, relations: 10000 } as const;

/** Typed associations do not compose into a logical implication or a proof. */
export function findAtlasPath(snapshot: AtlasSnapshot, sourceId: string, targetId: string): AtlasPathResult {
	const ids = new Set(snapshot.concepts.map((c) => c.id));
	if (sourceId === targetId || !ids.has(sourceId) || !ids.has(targetId)) return { status: "invalid" };
	if (snapshot.relations.length > ATLAS_QUERY_LIMITS.relations) return { status: "limited" };
	const adjacency = new Map<string, AtlasPathStep[]>();
	const add = (fromId: string, toId: string, relation: AtlasRelation) => {
		const steps = adjacency.get(fromId) ?? [];
		steps.push({ fromId, toId, relation });
		adjacency.set(fromId, steps);
	};
	for (const relation of snapshot.relations) {
		if (
			relation.reviewStatus !== "accepted" ||
			!relation.evidence.some((e) => e.citation.trim()) ||
			!ids.has(relation.sourceId) ||
			!ids.has(relation.targetId)
		)
			continue;
		add(relation.sourceId, relation.targetId, relation);
		if (relation.relationType === "analogy") add(relation.targetId, relation.sourceId, relation);
	}
	for (const steps of adjacency.values()) steps.sort((a, b) => a.relation.id.localeCompare(b.relation.id));
	const queue = [{ id: sourceId, depth: 0 }];
	const seen = new Set([sourceId]);
	const previous = new Map<string, AtlasPathStep>();
	let limited = false;
	for (let cursor = 0; cursor < queue.length; cursor++) {
		const current = queue[cursor]!;
		for (const step of adjacency.get(current.id) ?? []) {
			if (seen.has(step.toId)) continue;
			if (current.depth >= ATLAS_QUERY_LIMITS.depth) {
				limited = true;
				continue;
			}
			if (seen.size >= ATLAS_QUERY_LIMITS.visits) return { status: "limited" };
			seen.add(step.toId);
			previous.set(step.toId, step);
			if (step.toId === targetId) {
				const path: AtlasPathStep[] = [];
				let id = targetId;
				while (id !== sourceId) {
					const hop = previous.get(id)!;
					path.push(hop);
					id = hop.fromId;
				}
				return { status: "found", steps: path.reverse() };
			}
			queue.push({ id: step.toId, depth: current.depth + 1 });
		}
	}
	return { status: limited ? "limited" : "no-path" };
}
