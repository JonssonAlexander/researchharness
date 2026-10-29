import {z} from "zod";
import {mapEvidence,type MapImageLayout} from "./map-images.ts";
import {atlasConceptId} from "./atlas.ts";
import {RELATION_TYPES} from "./atlas-relations.ts";
import {createGraphSimulation} from "./layout.ts";
import type {MapFindings,ProposalContext} from "./map-proposals.ts";

const key=z.string().regex(/^draft_[a-zA-Z0-9_-]{1,40}$/),text=z.string().max(4000);
const origin=z.enum(["source","reconstruction","explanation"]);
const supported={origin,evidence:z.array(mapEvidence).max(4),rationale:z.string().max(2000),assumptions:z.string().max(2000),uncertainty:z.string().max(2000)};
export const mapDraft=z.object({
	overview:text,
	concepts:z.array(z.object({key,title:z.string().trim().min(1).max(160),existingId:atlasConceptId.nullable(),
		sourceKeys:z.array(key).max(8),...supported,notes:z.array(z.object({...supported,text}).strict()).min(1).max(6)}).strict()).max(40),
	connections:z.array(z.object({key:z.string().regex(/^edge_[a-zA-Z0-9_-]{1,40}$/),source:key,target:key,
		direction:z.enum(["forward","both","unclear"]),relationType:z.enum(RELATION_TYPES).nullable(),label:z.string().max(160),...supported}).strict()).max(60),
	questions:z.array(z.string().min(1).max(2000)).max(20),
}).strict();
export type MapDraft=z.infer<typeof mapDraft>;
export type MapEvidence=z.infer<typeof mapEvidence>;
export const DRAFT_ORIGINS={source:{label:"From drawing",color:"#65a3dc"},reconstruction:{label:"Reconstructed",color:"#e6b35a"},explanation:{label:"Added explanation",color:"#b98ae8"}} as const;

/** Structural/grounding checks do not certify a mathematical claim or its source reading. */
export function validateMapDraft(draft:MapDraft,reading:MapFindings,context:ProposalContext[],images:number):string|null {
	const keys=new Set(draft.concepts.map(n=>n.key)),old=new Set(reading.concepts.map(n=>n.key)),used=new Set<string>();
	if(keys.size!==draft.concepts.length||new Set(draft.connections.map(e=>e.key)).size!==draft.connections.length)return "Use unique draft node and connection keys.";
	for(const n of draft.concepts) {
		if(n.sourceKeys.some(k=>!old.has(k))||new Set(n.sourceKeys).size!==n.sourceKeys.length)return "Source keys must refer to the retained first reading.";
		if(n.existingId){const known=context.find(c=>c.id===n.existingId),title=n.title.trim().toLowerCase();
			if(!known||used.has(n.existingId)||![known.title,...known.aliases].some(s=>s.trim().toLowerCase()===title))return "Existing identities require an exact known title or alias, used once.";
			used.add(n.existingId);
		}
	}
	for(const e of draft.connections)if(!keys.has(e.source)||!keys.has(e.target)||e.source===e.target)return "Connections require distinct existing draft endpoints.";
	for(const item of [...draft.concepts,...draft.concepts.flatMap(n=>n.notes),...draft.connections]) {
		if(item.evidence.some(e=>e.page>=images))return "Evidence image does not exist.";
		if(item.origin!=="explanation"&&!item.evidence.length)return "Source readings and reconstructions need visible image evidence.";
		if(item.origin!=="source"&&!item.rationale.trim())return "Reconstructions and explanations need a stated rationale.";
	}
	return null;
}

/** A private D3 layout: no canonical IDs, Atlas positions or persistence callbacks. */
export function projectMapDraft(draft:MapDraft,layout:MapImageLayout[]=[]) {
	const nodes=draft.concepts.map((n,i)=>{
		const e=n.evidence.find(e=>e.region),r=e?.region,l=e&&layout[e.page]?.region;
		return {id:n.key,label:n.title,color:DRAFT_ORIGINS[n.origin].color,draggable:true,
			x:r&&l?((l.x+(r.x+r.w/2)*l.w)-.5)*600:Math.cos(i*2.4)*35*Math.sqrt(i+1),
			y:r&&l?((l.y+(r.y+r.h/2)*l.h)-.5)*600:Math.sin(i*2.4)*35*Math.sqrt(i+1)};
	});
	const links=draft.connections.map(e=>({from:e.source,to:e.target}));
	const sim=createGraphSimulation(nodes,links,{linkDistance:105,chargeStrength:-450}).stop();
	for(let i=0;i<180;i++)sim.tick();sim.stop();
	return {nodes,edges:draft.connections.flatMap(e=>e.direction==="unclear"?[]:e.direction==="both"?[{from:e.source,to:e.target},{from:e.target,to:e.source}]:[{from:e.source,to:e.target}]),
		semanticEdges:draft.connections.filter(e=>e.direction==="unclear").map(e=>({from:e.source,to:e.target}))};
}
