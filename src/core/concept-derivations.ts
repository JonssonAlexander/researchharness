import {forceCollide} from "d3-force";
import {createGraphSimulation,inferenceDepths,type LayoutNode} from "./layout.ts";
import {AtlasError,type AtlasConcept} from "./atlas.ts";
import type {GraphNode,GraphChain,GraphEdge} from "./contracts/graph.ts";

export const DERIVATION_LIMIT={propositions:150,arguments:80};
export interface DerivationTarget {rootId:string;targetId:string;chainId?:string;}
/** Backward closure of recorded arguments. Never include only part of a joint premise set. */
export function conceptDerivation(nodes:GraphNode[],chains:GraphChain[],roots:string[]){
 const known=new Map(nodes.map(n=>[n.id,n])),selected=new Set(roots.filter(id=>known.has(id)).slice(0,DERIVATION_LIMIT.propositions));
 const queue=[...selected],included:GraphChain[]=[],seen=new Set<string>();let truncated=roots.filter(id=>known.has(id)).length>selected.size;
 const byConclusion=new Map<string,GraphChain[]>();
 for(const chain of chains){if(!chain.premises.length||!known.has(chain.conclusion)||chain.premises.some(id=>!known.has(id)))continue;const group=byConclusion.get(chain.conclusion)??[];group.push(chain);byConclusion.set(chain.conclusion,group);}
 for(let i=0;i<queue.length;i++)for(const chain of (byConclusion.get(queue[i]!)??[]).sort((a,b)=>a.id.localeCompare(b.id))){
  if(seen.has(chain.id))continue;seen.add(chain.id);
  const extra=chain.premises.filter(id=>!selected.has(id));
  if(included.length>=DERIVATION_LIMIT.arguments||selected.size+new Set(extra).size>DERIVATION_LIMIT.propositions){truncated=true;continue;}
  included.push(chain);for(const id of extra)if(!selected.has(id)){selected.add(id);queue.push(id);}
 }
 return {propositions:nodes.filter(n=>selected.has(n.id)),chains:included,truncated,missing:roots.filter(id=>!known.has(id))};
}
/** Presentation only; mirrors upstream's single-arrow / joint-premise junction grammar. */
export function derivationDiagram(scope:ReturnType<typeof conceptDerivation>,options:{compact?:boolean}={}):{nodes:GraphNode[];edges:GraphEdge[];folded?:{chainId:string;premiseIds:string[]}[]}{
 const nodes=[...scope.propositions],edges:GraphEdge[]=[],folded:{chainId:string;premiseIds:string[]}[]=[];
 const outgoing=new Map<string,string[]>();
 for(const c of scope.chains)for(const p of c.premises)outgoing.set(p,[...outgoing.get(p)??[],c.conclusion]);
 const cache=new Map<string,Set<string>>();
 function descendants(id:string){if(cache.has(id))return cache.get(id)!;const seen=new Set<string>(),queue=[id];for(let i=0;i<queue.length;i++)for(const next of outgoing.get(queue[i]!)??[])if(!seen.has(next)){seen.add(next);queue.push(next);}cache.set(id,seen);return seen;}
 for(const chain of scope.chains){
  // Display folding only: the full joint premise set stays in scope/the ledger.
  // A premise carried through an earlier step need not draw another long chord.
  const hidden=options.compact?chain.premises.filter(p=>chain.premises.some(other=>other!==p&&descendants(p).has(other)&&!descendants(other).has(p))):[];
  const premises=chain.premises.filter(p=>!hidden.includes(p));
  if(hidden.length)folded.push({chainId:chain.id,premiseIds:hidden});
  if(chain.premises.length===1){edges.push({from:premises[0]!,to:chain.conclusion});continue;}
  nodes.push({id:chain.id,name:"⟹",statement:"Joint premises",aliases:[],provenance:chain.provenance,createdAt:chain.createdAt});
  edges.push(...premises.map(from=>({from,to:chain.id})),{from:chain.id,to:chain.conclusion});
 }
 return {nodes,edges,folded};
}
/** A learning target must be reachable from this concept's explicitly linked claim. */
export function resolveDerivationTarget(concepts:AtlasConcept[],nodes:GraphNode[],chains:GraphChain[],target:DerivationTarget){
 if(concepts.length!==1||!concepts[0]!.propositionIds.includes(target.rootId))throw new AtlasError("Choose a claim linked to this concept.",409);
 const scope=conceptDerivation(nodes,chains,[target.rootId]);
 if(!scope.propositions.some(n=>n.id===target.targetId))throw new AtlasError("This derivation changed. Reopen it before learning.",409);
 const arguments_=scope.chains.filter(c=>c.conclusion===target.targetId&&(!target.chainId||c.id===target.chainId));
 if(target.chainId&&!arguments_.length)throw new AtlasError("This argument is no longer in the selected derivation.",409);
 const ids=new Set([target.targetId,...arguments_.flatMap(c=>c.premises)]);
 return {propositions:scope.propositions.filter(n=>ids.has(n.id)),chains:arguments_};
}

/** Fixed rows reserve label space; inference junctions remain explicit. Cycles
 * fall back to separate rows rather than iterating a depth calculation forever. */
export function layoutDerivation(diagram:ReturnType<typeof derivationDiagram>){
 const ids=new Set(diagram.nodes.map(n=>n.id)),incoming=new Map(diagram.nodes.map(n=>[n.id,0])),out=new Map<string,string[]>(),rank=new Map<string,number>();
 for(const e of diagram.edges){if(!ids.has(e.from)||!ids.has(e.to))continue;incoming.set(e.to,incoming.get(e.to)!+1);out.set(e.from,[...out.get(e.from)??[],e.to]);}
 const queue=diagram.nodes.filter(n=>!incoming.get(n.id)).map(n=>n.id);
 for(let i=0;i<queue.length;i++){const id=queue[i]!,depth=rank.get(id)??0;rank.set(id,depth);for(const to of out.get(id)??[]){rank.set(to,Math.max(rank.get(to)??0,depth+1));incoming.set(to,incoming.get(to)!-1);if(!incoming.get(to))queue.push(to);}}
 let last=Math.max(0,...rank.values());for(const n of diagram.nodes)if(incoming.get(n.id))rank.set(n.id,++last);
 const rows=new Map<number,string[]>();for(const n of diagram.nodes){const depth=rank.get(n.id)??0;rows.set(depth,[...rows.get(depth)??[],n.id]);}
 return new Map([...rows].flatMap(([depth,row])=>row.map((id,i)=>[id,{x:(i-(row.length-1)/2)*190,y:depth*130}] as const)));
}

/** One read-only space over canonical identities, prioritizing the entry concept's
 * complete backward slice. Additional arguments are retained whole or omitted. */
export function sharedDerivationMap(nodes:GraphNode[],chains:GraphChain[],roots:string[]){
 const base=conceptDerivation(nodes,chains,roots),known=new Map(nodes.map(n=>[n.id,n]));
 const ids=new Set(base.propositions.map(n=>n.id)),included=[...base.chains],seen=new Set(included.map(c=>c.id));
 let truncated=base.truncated;
 const valid=chains.filter(c=>c.premises.length&&known.has(c.conclusion)&&c.premises.every(id=>known.has(id))).sort((a,b)=>a.id.localeCompare(b.id));
 // Visit adjoining arguments first, so shared foundations reveal nearby results
 // before unrelated components consume the bounded view.
 const remaining=new Set(valid.filter(c=>!seen.has(c.id)));
 while(remaining.size){
  if(included.length>=DERIVATION_LIMIT.arguments){truncated=true;break;}
  const chain=[...remaining].find(c=>[c.conclusion,...c.premises].some(id=>ids.has(id)))??remaining.values().next().value!;
  remaining.delete(chain);
  const extra=[...new Set([chain.conclusion,...chain.premises])].filter(id=>!ids.has(id));
  if(included.length>=DERIVATION_LIMIT.arguments||ids.size+extra.length>DERIVATION_LIMIT.propositions){truncated=true;continue;}
  included.push(chain);for(const id of extra)ids.add(id);
 }
 for(const n of nodes)if(!ids.has(n.id)){if(ids.size<DERIVATION_LIMIT.propositions)ids.add(n.id);else truncated=true;}
 return {propositions:nodes.filter(n=>ids.has(n.id)),chains:included.sort((a,b)=>a.id.localeCompare(b.id)),truncated,missing:base.missing};
}

/** Result-centred flower: inference runs inward; prerequisites occupy outer
 * rings. Shared claims have one position between the petals that use them. */
export function layoutSharedDerivations(diagram:ReturnType<typeof derivationDiagram>){
 const byId=new Map(diagram.nodes.map(n=>[n.id,n])),incoming=new Map(diagram.nodes.map(n=>[n.id,[] as string[]])),outgoing=new Map(diagram.nodes.map(n=>[n.id,[] as string[]]));
 for(const e of diagram.edges)if(byId.has(e.from)&&byId.has(e.to)){incoming.get(e.to)!.push(e.from);outgoing.get(e.from)!.push(e.to);}
 const junction=(id:string)=>id.startsWith("arg_"),connected=diagram.nodes.filter(n=>incoming.get(n.id)!.length||outgoing.get(n.id)!.length),orphans=diagram.nodes.filter(n=>!incoming.get(n.id)!.length&&!outgoing.get(n.id)!.length);
 const depth=inferenceDepths(diagram.nodes,diagram.edges.map(e=>({from:e.to,to:e.from})));
 const roots=connected.filter(n=>!junction(n.id)&&!outgoing.get(n.id)!.length).map(n=>n.id);
 const owners=new Map(diagram.nodes.map(n=>[n.id,[] as number[]]));
 function trace(root:string,index:number){const seen=new Set([root]),queue=[root];for(let i=0;i<queue.length;i++)for(const id of incoming.get(queue[i]!)??[])if(!seen.has(id)){seen.add(id);queue.push(id);}for(const id of seen)owners.get(id)!.push(index);}
 roots.forEach(trace);
 // Cyclic components without a terminal result remain visible; choose a visual
 // anchor only, never invent a mathematical conclusion or break the cycle.
 for(const n of connected)if(!owners.get(n.id)!.length){roots.push(n.id);trace(n.id,roots.length-1);}
 const primary=new Map(connected.map(n=>[n.id,owners.get(n.id)![0]!]));
 const weights=roots.map((_,index)=>Math.max(2,connected.filter(n=>primary.get(n.id)===index&&!junction(n.id)).length));
 const total=weights.reduce((a,b)=>a+b,0)||1,angles:number[]=[],spans:number[]=[];let angle=-Math.PI/2;
 const gap=Math.min(.12,Math.PI/Math.max(1,roots.length));
 for(const weight of weights){const span=(2*Math.PI-gap*roots.length)*weight/total;angles.push(angle+span/2);spans.push(span);angle+=span+gap;}
 const inner=Math.max(130,roots.length*28),targets=new Map<string,{x:number;y:number;r:number}>();
 const lanes=new Map<string,string[]>();
 for(const n of connected){const key=`${depth.get(n.id)??0}/${primary.get(n.id)}`;lanes.set(key,[...lanes.get(key)??[],n.id]);}
 // Inner neighbours are positioned first; order each outer layer by the steps
 // it feeds, rather than arbitrary IDs that cause crossing diagonal fans.
 for(const [key,lane] of [...lanes].sort((a,b)=>Number(a[0].split("/")[0])-Number(b[0].split("/")[0])||a[0].localeCompare(b[0]))){
  const owner=primary.get(lane[0]!)!,centre=angles[owner]!,span=spans[owner]!*.84;
  const order=(id:string)=>{const ps=(outgoing.get(id)??[]).map(id=>targets.get(id)).filter(p=>!!p);return ps.length?ps.reduce((sum,p)=>sum+Math.atan2(Math.sin(Math.atan2(p.y,p.x)-centre),Math.cos(Math.atan2(p.y,p.x)-centre)),0)/ps.length:0;};
  lane.sort((a,b)=>order(a)-order(b)||a.localeCompare(b)).forEach((id,index)=>{
   const offset=lane.length>1?(index/(lane.length-1)-.5)*span:0,r=inner+Number(key.split("/")[0])*110,a=centre+offset;
   targets.set(id,{x:r*Math.cos(a),y:r*Math.sin(a),r});
  });
 }
 // Terminal claims sit on the inner ring, not in a row or at the edge of a blob.
 roots.forEach((id,i)=>targets.set(id,{x:inner*Math.cos(angles[i]!),y:inner*Math.sin(angles[i]!),r:inner}));
 const outer=Math.max(inner,...[...targets.values()].map(t=>t.r))+210;
 orphans.forEach((n,i)=>{const a=-Math.PI/2+2*Math.PI*i/Math.max(1,orphans.length),r=Math.max(outer,orphans.length*26);targets.set(n.id,{x:r*Math.cos(a),y:r*Math.sin(a),r});});
 const local:(LayoutNode&{x:number;y:number})[]=diagram.nodes.map(n=>({id:n.id,x:targets.get(n.id)!.x,y:targets.get(n.id)!.y}));
 const sim=createGraphSimulation(local,diagram.edges,{gravity:{x:0,y:0,strength:0},chargeStrength:-120,linkStrength:.04,linkDistance:130});
 sim.force("petals",alpha=>{for(const n of local){const t=targets.get(n.id)!;n.vx=(n.vx??0)+(t.x-n.x)*.65*alpha;n.vy=(n.vy??0)+(t.y-n.y)*.65*alpha;}});
 sim.force("labels",forceCollide<LayoutNode>(n=>junction(n.id)?6:64).iterations(3));
 for(let i=0;i<240;i++)sim.tick();sim.stop();
 const positions=new Map(local.map(n=>{
  const t=targets.get(n.id)!,owner=primary.get(n.id);let a=Math.atan2(n.y,n.x);
  if(owner!==undefined){const centre=angles[owner]!,offset=Math.atan2(Math.sin(a-centre),Math.cos(a-centre)),half=spans[owner]!*.43;a=centre+Math.max(-half,Math.min(half,offset));}
  return [n.id,{x:Math.cos(a)*t.r,y:Math.sin(a)*t.r}] as const;
 }));
 const colors=["#b18bd3","#70bba4","#d4ad6b","#65a3dc"];
 const clusters=roots.map((root,index)=>({id:`proof-petal:${root}`,label:null,members:connected.filter(n=>primary.get(n.id)===index).map(n=>n.id),color:colors[index%colors.length]!}));
 return {positions,clusters,sectors:roots.map((rootId,i)=>({rootId,start:angles[i]!-spans[i]!/2,end:angles[i]!+spans[i]!/2,nodeCount:weights[i]!}))};
}
