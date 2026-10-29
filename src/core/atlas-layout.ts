import {visibleMapConnections} from "./map-connections.ts";
import { createGraphSimulation, type LayoutNode } from "./layout.ts";
import { AtlasError, type AtlasSnapshot } from "./atlas.ts";

export const ATLAS_LAYOUT_LIMIT = 150;
const FLOOR = 0.003;

/** Warm-start the upstream force engine. Only explicitly touched subjects move;
 * cross-subject endpoints are fixed boundary conditions, never proof premises. */
export function createAtlasLayout(
	snapshot: AtlasSnapshot,
	subjectId: string | null,
	additionalSubjects: readonly (string | null)[] = [],
) {
	const subjectIds = new Set([subjectId, ...additionalSubjects]);
	if (snapshot.subjects.some(s => subjectIds.has(s.id) && s.locked))
		throw new Error("Unlock this subject before arranging it.");
	const members = snapshot.concepts.filter(c => subjectIds.has(c.preferredSubjectId));
	if (members.length > ATLAS_LAYOUT_LIMIT)
		throw new Error("Local arrangement supports up to 150 concepts at a time.");
	const active = new Set(members.map(c => c.id));
	const edges = snapshot.relations
		.filter(r => r.reviewStatus === "accepted" && (active.has(r.sourceId) || active.has(r.targetId)))
		.map(r => ({from: r.sourceId, to: r.targetId}));
	const pairs=new Set(edges.map(e=>[e.from,e.to].sort().join(":")));
	for(const c of visibleMapConnections(snapshot)){
		const pair=[c.sourceId,c.targetId].sort().join(":");
		if((active.has(c.sourceId)||active.has(c.targetId))&&!pairs.has(pair)){edges.push({from:c.sourceId,to:c.targetId});pairs.add(pair);}
	}
	// Repulsion only needs the local region and directly connected boundary nodes.
	const included = new Set([...active, ...edges.flatMap(e => [e.from, e.to])]);
	if (included.size > 500 || edges.length > 2000) throw new Error("Too many boundary links for local arrangement.");
	const nodes: (LayoutNode & { x: number; y: number })[] = snapshot.concepts
		.filter(c => included.has(c.id))
		.map(c => ({ id: c.id, x: c.x, y: c.y, ...(!active.has(c.id) ? { fx: c.x, fy: c.y } : {}) }));
	const anchors = new Map(nodes.map(n => [n.id, {x: n.x, y: n.y}]));
	const homes = new Map(members.map(c => [c.id, snapshot.subjects.find(s => s.id === c.preferredSubjectId)]));
	const sim = createGraphSimulation(nodes, edges, {
		gravity: {x: 0, y: 0, strength: 0}, chargeStrength: -600,
		linkStrength: 0.2, linkDistance: 110, velocityDecay: 0.4, alphaDecay: 0.035,
	});
	sim.force("atlasAnchors", alpha => {
		for (const n of nodes) {
			if (!active.has(n.id)) continue;
			const a = anchors.get(n.id)!;
			const subject = homes.get(n.id);
			// Spatial memory is a spring, not an unconditional pin. A weak subject
			// spring limits drift while the upstream link/charge forces make space.
			n.vx = (n.vx ?? 0) + ((a.x - n.x) * 0.035 + ((subject?.x ?? a.x) - n.x) * 0.012) * alpha;
			n.vy = (n.vy ?? 0) + ((a.y - n.y) * 0.035 + ((subject?.y ?? a.y) - n.y) * 0.012) * alpha;
		}
	});
	sim.alpha(0.3);
	let held: string | null = null;
	return {
		nodes, active, subjectIds,
		move(id: string, x: number, y: number) {
			const n = nodes.find(n => n.id === id);
			if (!n || !active.has(id)) return;
			held = id;
			n.x = n.fx = x;
			n.y = n.fy = y;
			anchors.set(id, {x, y});
			sim.alphaTarget(0.3);
		},
		release() {
			const n = nodes.find(n => n.id === held);
			if (n) {
				n.fx = null;
				n.fy = null;
			}
			held = null;
			sim.alphaTarget(0);
		},
		step() {
			sim.tick();
			return held !== null || sim.alpha() >= FLOOR;
		},
		positions() { return nodes.filter(n => active.has(n.id)).map(({id,x,y}) => ({id,x,y})); },
	};
}

/** Rigid translation of the visible subject's preferred members, including hidden ones. */
export function translateAtlasSubject(snapshot: AtlasSnapshot, id: string, dx: number, dy: number) {
	const subject = snapshot.subjects.find(s => s.id === id);
	if (!subject || subject.locked) throw new AtlasError("Subject is missing or locked.", 409);
	const members = snapshot.concepts.filter(c => c.preferredSubjectId === id);
	if (members.length > 2000) throw new AtlasError("Subject movement supports up to 2,000 concepts.");
	const translate = (point: {x: number; y: number}) => {
		const x = point.x + dx, y = point.y + dy;
		if (![dx, dy, x, y].every(v => Number.isFinite(v) && Math.abs(v) <= 1000000))
			throw new AtlasError("Move would exceed the graph's coordinate limits.");
		return {x, y};
	};
	return {anchor: translate(subject), positions: members.map(c => ({id: c.id, ...translate(c)}))};
}
