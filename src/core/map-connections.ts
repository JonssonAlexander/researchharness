import {z} from "zod";
import {mapEvidence} from "./map-images.ts";
import type {AtlasSnapshot} from "./atlas.ts";
import type {MapDraft} from "./map-draft.ts";
import type {MapProposal} from "./map-proposals.ts";

/** Reviewed diagram association; never a mathematical relation or proof edge. */
export const mapConnection=z.object({
	schemaVersion:z.literal(1),id:z.string().regex(/^mc_[0-9a-f-]{36}$/),
	proposalId:z.string().regex(/^mp_[0-9a-f-]{36}$/),connectionKey:z.string().regex(/^edge_[a-zA-Z0-9_-]{1,40}$/),
	sourceRevision:z.string().regex(/^mr_[0-9a-f-]{36}$/),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),
	sourceId:z.string().regex(/^ac_[0-9a-f-]{36}$/),targetId:z.string().regex(/^ac_[0-9a-f-]{36}$/),
	label:z.string().max(160),direction:z.enum(["forward","both","unclear"]),origin:z.enum(["source","reconstruction","explanation"]),
	evidence:z.array(mapEvidence).max(4),rationale:z.string().max(2000),assumptions:z.string().max(2000),uncertainty:z.string().max(2000),
}).strict().refine(c=>c.sourceId!==c.targetId,"Map connections need distinct endpoints");
export type MapConnection=z.infer<typeof mapConnection>;
export function draftMapConnections(p:MapProposal,draft:MapDraft,mapping:Map<string,string>,keys:string[],mint:(key:string)=>string):MapConnection[] {
	return draft.connections.filter(e=>keys.includes(e.key)).map(e=>mapConnection.parse({
		schemaVersion:1,id:mint(`map_${e.key}`),proposalId:p.id,connectionKey:e.key,sourceRevision:p.sourceRevision,sourceHash:p.sourceHash,
		sourceId:mapping.get(e.source),targetId:mapping.get(e.target),label:e.label,direction:e.direction,origin:e.origin,
		evidence:e.evidence,rationale:e.rationale,assumptions:e.assumptions,uncertainty:e.uncertainty,
	}));
}
/** Historical evidence stays stored; only active current maps appear on the home canvas. */
export function visibleMapConnections(atlas:AtlasSnapshot):MapConnection[] {
	const ids=new Set(atlas.concepts.map(n=>n.id));
	const sources=new Map(atlas.mindmaps?.filter(m=>!m.archived).flatMap(m=>m.captures.filter(c=>c.id===m.currentRevision).map(c=>[c.id,c.hash] as const)));
	return (atlas.mapConnections??[]).filter(c=>ids.has(c.sourceId)&&ids.has(c.targetId)&&sources.get(c.sourceRevision)===c.sourceHash);
}
