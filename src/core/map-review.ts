import {draftMapConnections,type MapConnection} from "./map-connections.ts";
import {z} from "zod";
import {AtlasError,atlasConceptId,type AtlasSnapshot} from "./atlas.ts";
import {mapDraft,DRAFT_ORIGINS,projectMapDraft,type MapDraft} from "./map-draft.ts";
import type {MapProposal} from "./map-proposals.ts";
import {normalizeRelation,type RelationInput} from "./atlas-relations.ts";

export function mapReviewReasons(n:MapDraft["concepts"][number]):string[] {
	const reasons=new Set<string>();
	if([n,...n.notes].some(i=>i.uncertainty.trim()))reasons.add("Unresolved notation or meaning");
	if(n.notes.every(i=>i.text.trim().length<40||/^(visible text\.?|none\.?)$/i.test(i.rationale.trim())))reasons.add("Explanation needs depth");
	if([n,...n.notes].some(i=>i.origin!=="source"))reasons.add("Model reconstruction or explanation remains unverified");
	return [...reasons];
}
export const mapReviewInput=z.object({proposalId:z.string().regex(/^mp_[0-9a-f-]{36}$/),expectedRevision:z.number().int().nonnegative(),draft:mapDraft}).strict();
export interface MapReview {schemaVersion:1;proposalId:string;revision:number;draft:MapDraft;digest:string;integration?:{id:string;committedAt:string}}
export const integrationChoices=z.object({
	identities:z.record(z.string(),z.union([z.literal("new"),atlasConceptId,z.null()])),
	subjectId:z.string().regex(/^as_[0-9a-f-]{36}$/).nullable(),
	connections:z.array(z.string()).max(60),
	mapConnections:z.array(z.string()).max(60).optional(),
}).strict();
export type IntegrationChoices=z.infer<typeof integrationChoices>;
export interface MapIntegration {
	schemaVersion:1|2;id:string;proposalId:string;reviewRevision:number;digest:string;baseRevision:number;
	choices:IntegrationChoices;concepts:{key:string;id:string;title:string;existing:boolean;markdown:string;x:number;y:number;reasons:string[]}[];
	mapConnections?:MapConnection[];repairOf?:string;skippedConnections?:string[];
	relations:RelationInput[];reusedRelations:string[];sourceRevision:string;sourceHash:string;mapId:string;
	status:"prepared"|"committed";committedAt?:string;
}
export interface MapReviewStore {
	read(proposalId:string):MapReview;
	save(input:z.infer<typeof mapReviewInput>):MapReview;
	prepare(proposalId:string,expectedRevision:number,choices:IntegrationChoices,expectedBase?:number):MapIntegration;
	prepareConnections(proposalId:string,expectedBase:number):MapIntegration;
	commit(id:string,digest:string):MapIntegration;
}
export function identityCandidates(title:string,atlas:AtlasSnapshot) {
	const normalize=(s:string)=>s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu," ").trim();
	const needle=normalize(title);
	return atlas.concepts.filter(c=>[c.title,...c.aliases].some(t=>{const v=normalize(t);return v===needle||needle.length>3&&v.length>3&&(v.includes(needle)||needle.includes(v));}));
}
/** No identity inference: every kept node has an explicit create/reuse choice. */
export function planMapIntegration(p:MapProposal,review:MapReview,atlas:AtlasSnapshot,choices:IntegrationChoices,id:string,mint:(key:string)=>string):Omit<MapIntegration,"digest"> {
	if(!p.draft||!p.digest||p.status!=="prepared")throw new AtlasError("Only prepared map drafts can be integrated.");
	const draft=mapDraft.parse(review.draft),keys=new Set(draft.concepts.map(n=>n.key)),picked=new Set(choices.connections),ordinary=new Set(choices.mapConnections??[]);
	if(Object.keys(choices.identities).some(k=>!keys.has(k))||draft.concepts.some(n=>!(n.key in choices.identities)))throw new AtlasError("Choose an identity for every concept.");
	if(ordinary.size!==(choices.mapConnections?.length??0)||[...ordinary].some(k=>!draft.connections.some(e=>e.key===k)))throw new AtlasError("Invalid mind-map connection selection.");
	if(picked.size!==choices.connections.length||choices.connections.some(k=>!draft.connections.some(e=>e.key===k)))throw new AtlasError("Invalid connection selection.");
	if(choices.subjectId&&!atlas.subjects.some(s=>s.id===choices.subjectId))throw new AtlasError("Subject no longer exists.",409);
	const map=atlas.mindmaps?.find(m=>!m.archived&&m.currentRevision===p.sourceRevision);
	if(!map||!map.captures.some(c=>c.id===p.sourceRevision&&c.hash===p.sourceHash))throw new AtlasError("The map was rewritten or archived. Review its current revision.",409);
	const names=new Set<string>(),used=new Set<string>(),layout=projectMapDraft(draft,p.imageLayout),minX=Math.min(0,...layout.nodes.map(n=>n.x)),minY=Math.min(0,...layout.nodes.map(n=>n.y));
	const anchor=atlas.subjects.find(s=>s.id===choices.subjectId),offsetX=Math.max(anchor?.x??0,...atlas.concepts.filter(c=>!choices.subjectId||c.preferredSubjectId===choices.subjectId).map(c=>c.x))+300;
	const concepts=draft.concepts.flatMap(n=>{
		const choice=choices.identities[n.key];if(choice===null)return [];
		const known=atlas.concepts.find(c=>c.id===choice);
		if(choice!=="new"&&!known)throw new AtlasError("A matched concept no longer exists.",409);
		if(choice==="new"&&identityCandidates(n.title,atlas).some(c=>[c.title,...c.aliases].some(t=>t.trim().toLowerCase()===n.title.trim().toLowerCase())))throw new AtlasError(`Resolve the existing identity for ${n.title}; do not create an exact-name duplicate.`);
		const title=(known?.title??n.title).trim().toLowerCase();if(names.has(title))throw new AtlasError("Duplicate draft names need merging or distinct qualified names before integration.");names.add(title);
		const target=known?.id??mint(n.key);
		if(used.has(target))throw new AtlasError("Two draft nodes map to one identity. Merge them in the draft first.");used.add(target);
		const support=(v:typeof n|typeof n.notes[number])=>`Origin: ${DRAFT_ORIGINS[v.origin].label}\n\nReasoning: ${v.rationale||"Not supplied"}\n\nAssumptions: ${v.assumptions||"Not stated"}\n\nUnresolved: ${v.uncertainty||"None reported; not a verification"}`;
		const body=`### ${n.title}\n\n${support(n)}\n\n${n.notes.map(note=>`${note.text}\n\n${support(note)}`).join("\n\n")}\n\nSource revision: ${p.sourceRevision}\nDraft: ${p.id}\nEvidence: ${JSON.stringify([n.evidence,...n.notes.map(x=>x.evidence)])}\n`;
		return [{key:n.key,id:target,title:known?.title??n.title,existing:!!known,markdown:body,x:known?.x??layout.nodes.find(c=>c.id===n.key)!.x-minX+offsetX,y:known?.y??layout.nodes.find(c=>c.id===n.key)!.y-minY+(anchor?.y??0),reasons:mapReviewReasons(n)}];
	});
	if(new Set([...map.captures.find(c=>c.id===p.sourceRevision)!.conceptIds,...concepts.map(n=>n.id)]).size>200)throw new AtlasError("This source revision cannot link more than 200 concepts.");
	if(!concepts.length)throw new AtlasError("Keep at least one concept.");
	const mapping=new Map(concepts.map(c=>[c.key,c.id]));
	if(draft.connections.some(e=>ordinary.has(e.key)&&(!mapping.has(e.source)||!mapping.has(e.target))))throw new AtlasError("A selected map connection depends on an excluded concept.");
	const mapConnections=draftMapConnections(p,draft,mapping,[...ordinary],mint);
	const relations:RelationInput[]=[],reusedRelations:string[]=[];
	for(const edge of draft.connections.filter(e=>picked.has(e.key))) {
		const source=concepts.find(n=>n.key===edge.source),target=concepts.find(n=>n.key===edge.target);
		if(!source||!target)throw new AtlasError("A selected connection depends on an excluded concept.");
		if(!edge.relationType||edge.direction==="unclear")throw new AtlasError("Choose a type and direction before integrating a connection. Otherwise exclude it.");
		for(const [from,to] of edge.direction==="both"?[[source.id,target.id],[target.id,source.id]]:[[source.id,target.id]]) {
			const relation=normalizeRelation({kind:"relation",id:mint(edge.key+from),expectedRevision:0,sourceId:from!,targetId:to!,relationType:edge.relationType,conditions:edge.assumptions.trim(),claimStatus:"external-assertion",reviewStatus:"accepted",evidence:[{citation:`Reviewed source depiction ${p.sourceRevision}; ${p.id}`,locator:JSON.stringify({key:edge.key,label:edge.label,origin:edge.origin,rationale:edge.rationale,uncertainty:edge.uncertainty,evidence:edge.evidence}).slice(0,1000)}]});
			const old=atlas.relations.find(r=>r.sourceId===relation.sourceId&&r.targetId===relation.targetId&&r.relationType===relation.relationType&&r.conditions===relation.conditions);
			if(old){if(old.reviewStatus!=="accepted")throw new AtlasError("An equivalent disputed or pending relation needs separate review.",409);reusedRelations.push(old.id);}
			else if(!relations.some(r=>r.sourceId===relation.sourceId&&r.targetId===relation.targetId&&r.relationType===relation.relationType&&r.conditions===relation.conditions))relations.push(relation);
		}
	}
	return {schemaVersion:2,id,mapConnections,proposalId:p.id,reviewRevision:review.revision,baseRevision:atlas.layoutRevision??0,choices,concepts,relations,reusedRelations,sourceRevision:p.sourceRevision,sourceHash:p.sourceHash,mapId:map.id,status:"prepared"};
}

/** Reuse the original approved mapping; repairs never create/rename concepts or promote claims. */
export function planMapConnectionRepair(p:MapProposal,review:MapReview,original:MapIntegration,atlas:AtlasSnapshot,id:string,mint:(key:string)=>string):Omit<MapIntegration,"digest"> {
	if(original.status!=="committed"||original.repairOf||original.proposalId!==p.id||original.reviewRevision!==review.revision||original.sourceRevision!==p.sourceRevision||original.sourceHash!==p.sourceHash)
		throw new AtlasError("Repair needs the unchanged original integration.",409);
	if(!atlas.mindmaps?.some(m=>!m.archived&&m.currentRevision===p.sourceRevision&&m.captures.some(c=>c.id===p.sourceRevision&&c.hash===p.sourceHash)))
		throw new AtlasError("This map was rewritten or archived. Review the current revision instead.",409);
	const ids=new Set(atlas.concepts.map(n=>n.id)),mapping=new Map(original.concepts.filter(n=>ids.has(n.id)).map(n=>[n.key,n.id]));
	const present=new Set(atlas.mapConnections?.filter(c=>c.proposalId===p.id).map(c=>c.connectionKey));
	const skipped=review.draft.connections.filter(e=>!mapping.has(e.source)||!mapping.has(e.target)).map(e=>e.key);
	const keys=review.draft.connections.filter(e=>!skipped.includes(e.key)&&!present.has(e.key)).map(e=>e.key);
	return {schemaVersion:2,id,proposalId:p.id,reviewRevision:review.revision,baseRevision:atlas.layoutRevision??0,repairOf:original.id,
		choices:{identities:Object.fromEntries(mapping),subjectId:null,connections:[],mapConnections:keys},concepts:[],relations:[],reusedRelations:[],
		mapConnections:draftMapConnections(p,review.draft,mapping,keys,mint),skippedConnections:skipped,
		sourceRevision:p.sourceRevision,sourceHash:p.sourceHash,mapId:original.mapId,status:"prepared"};
}
