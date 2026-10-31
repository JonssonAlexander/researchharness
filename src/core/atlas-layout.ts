import {drawingConnections} from "./atlas-drawing.ts";
import {forceCollide} from "d3-force";
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
	for(const c of drawingConnections(snapshot)){
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
	const sim = createGraphSimulation(nodes, edges.filter(e => active.has(e.from) && active.has(e.to)), {
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

export type AtlasArrangement="organic"|"radial"|"connected";
/** Organize subjects independently; a bridge is not a cluster membership. */
export function arrangeAtlas(snapshot:AtlasSnapshot,ids:string[],mode:AtlasArrangement){
 const selected=new Set(ids),groups=new Map<string|null,string[]>();
 for(const c of snapshot.concepts)if(selected.has(c.id)&&!snapshot.subjects.find(s=>s.id===c.preferredSubjectId)?.locked){const group=groups.get(c.preferredSubjectId)??[];group.push(c.id);groups.set(c.preferredSubjectId,group);}
 if([...groups.values()].reduce((sum,g)=>sum+g.length,0)>ATLAS_LAYOUT_LIMIT)throw new AtlasError("Arrange up to 150 concepts at a time. Select a map or smaller subject.");
 if(mode!=="organic"||groups.size<2)return arrangeAtlasRegion(snapshot,ids,mode);
 const members=snapshot.concepts.filter(c=>selected.has(c.id)&&groups.has(c.preferredSubjectId));
 const cx=members.reduce((sum,c)=>sum+c.x,0)/members.length,cy=members.reduce((sum,c)=>sum+c.y,0)/members.length;
 const regions=[...groups.values()].map(group=>{
  const positions=arrangeAtlasRegion(snapshot,group,mode);
  return {positions,cx:positions.reduce((sum,p)=>sum+p.x,0)/positions.length};
 }).sort((a,b)=>a.cx-b.cx||a.positions[0]!.id.localeCompare(b.positions[0]!.id));
 let cursor=0;
 const result=regions.flatMap(({positions})=>{
  const minX=Math.min(...positions.map(p=>p.x)),maxX=Math.max(...positions.map(p=>p.x)),midY=(Math.min(...positions.map(p=>p.y))+Math.max(...positions.map(p=>p.y)))/2;
  const placed=positions.map(p=>({id:p.id,x:p.x-minX+cursor,y:p.y-midY+cy}));
  cursor+=maxX-minX+180;
  return placed;
 });
 const midX=(Math.min(...result.map(p=>p.x))+Math.max(...result.map(p=>p.x)))/2;
 for(const p of result)p.x+=cx-midX;
 if(result.some(p=>![p.x,p.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=1000000)))throw new AtlasError("Arrangement would exceed the graph limits.");
 return result;
}
/** View proposal only. Locked and unrelated nodes are boundary conditions, never moved. */
function arrangeAtlasRegion(snapshot:AtlasSnapshot,ids:string[],mode:AtlasArrangement){
 const selected=new Set(ids),members=snapshot.concepts.filter(c=>selected.has(c.id)&&!snapshot.subjects.find(s=>s.id===c.preferredSubjectId)?.locked).sort((a,b)=>a.id.localeCompare(b.id));
 if(!members.length)throw new AtlasError("No unlocked concepts in this selection.");
 if(members.length>ATLAS_LAYOUT_LIMIT)throw new AtlasError("Arrange up to 150 concepts at a time. Select a map or smaller subject.");
 const active=new Set(members.map(c=>c.id)),pairs=new Set<string>(),edges:{from:string;to:string}[]=[];
 for(const e of [...snapshot.relations.filter(r=>r.reviewStatus==="accepted"),...drawingConnections(snapshot)]){const key=[e.sourceId,e.targetId].sort().join(":");if(active.has(e.sourceId)&&active.has(e.targetId)&&!pairs.has(key)){pairs.add(key);edges.push({from:e.sourceId,to:e.targetId});}}
 const adjacent=new Map(members.map(c=>[c.id,new Set<string>()]));
 for(const e of edges){adjacent.get(e.from)!.add(e.to);adjacent.get(e.to)!.add(e.from);}
 const byDegree=(a:string,b:string)=>adjacent.get(b)!.size-adjacent.get(a)!.size||a.localeCompare(b);
 const remaining=new Set(members.map(c=>c.id)),groups:string[][]=[];
 while(remaining.size){const root=[...remaining].sort(byDegree)[0]!,group=[root];remaining.delete(root);
  for(let i=0;i<group.length;i++)for(const id of [...adjacent.get(group[i]!)!].sort(byDegree))if(remaining.delete(id))group.push(id);
  groups.push(group);
 }
 const cx=members.reduce((n,c)=>n+c.x,0)/members.length,cy=members.reduce((n,c)=>n+c.y,0)/members.length;
 let cursor=0;
 const positions:{id:string;x:number;y:number}[]=[];
 for(const group of groups){
  const root=group[0]!,children=new Map(group.map(id=>[id,[] as string[]])),seen=new Set([root]),order=[root];
  for(let i=0;i<order.length;i++)for(const id of [...adjacent.get(order[i]!)!].sort(byDegree))if(!seen.has(id)){seen.add(id);children.get(order[i]!)!.push(id);order.push(id);}
  const weight=new Map<string,number>();
  for(const id of [...order].reverse())weight.set(id,Math.max(1,children.get(id)!.reduce((n,k)=>n+weight.get(k)!,0)));
  const nodes:(LayoutNode&{x:number;y:number})[]=[];
  function branch(id:string,depth:number,start:number,span:number){
   const angle=start+span/2,r=depth*170;
   nodes.push({id,x:r*Math.cos(angle),y:r*Math.sin(angle)});
   const total=children.get(id)!.reduce((n,k)=>n+weight.get(k)!,0);let at=start;
   for(const child of children.get(id)!){const width=span*weight.get(child)!/total;branch(child,depth+1,at,width);at+=width;}
  }
  branch(root,0,-Math.PI/2,Math.PI*2);
  if(mode!=="radial"){
   const groupIds=new Set(group),links=edges.filter(e=>groupIds.has(e.from)&&groupIds.has(e.to));
   const sim=createGraphSimulation(nodes,links,{gravity:{x:0,y:0,strength:.08},linkDistance:110,chargeStrength:-650}).stop();
   sim.force("labelSpacing",forceCollide(60).iterations(2));
   if(mode==="connected"){
    const hub=nodes.find(n=>n.id===root)!;hub.fx=hub.fy=hub.x=hub.y=0;
    const maximum=adjacent.get(root)!.size;
    sim.force("hubRings",alpha=>{for(const n of nodes){if(n.id===root)continue;const radius=180+(maximum-adjacent.get(n.id)!.size)*100,length=Math.hypot(n.x,n.y)||1,pull=(radius-length)*.2*alpha;n.vx=(n.vx??0)+n.x/length*pull;n.vy=(n.vy??0)+n.y/length*pull;}});
   }
   for(let i=0;i<240;i++)sim.tick();sim.stop();
  }
  const minX=Math.min(...nodes.map(n=>n.x)),maxX=Math.max(...nodes.map(n=>n.x));
  for(const n of nodes)positions.push({id:n.id,x:n.x-minX+cursor,y:n.y});
  cursor+=maxX-minX+260;
 }
 const midX=(Math.min(...positions.map(n=>n.x))+Math.max(...positions.map(n=>n.x)))/2,midY=(Math.min(...positions.map(n=>n.y))+Math.max(...positions.map(n=>n.y)))/2;
 for(const n of positions){n.x+=cx-midX;n.y+=cy-midY;}
 if(positions.some(n=>![n.x,n.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=1000000)))throw new AtlasError("Arrangement would exceed the graph limits.");
 // D3 mutates simulation nodes with index/velocity/fixed fields. Never send them
 // through the strict layout API: only these three position fields are writable.
 return positions.map(({id,x,y})=>({id,x,y}));
}
