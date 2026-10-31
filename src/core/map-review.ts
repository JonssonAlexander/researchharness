import {suggestedRelations,type SyncReview,type SyncAssociation} from "./atlas-sync.ts";
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
export interface MapReview {schemaVersion:1;proposalId:string;revision:number;draft:MapDraft;digest:string;priorIdentities?:Record<string,string>;priorSubjectId?:string|null;pendingIntegration?:MapIntegration;connectionRepair?:MapIntegration;integration?:{id:string;committedAt:string;reconciled?:boolean}}
export const integrationChoices=z.object({
	identities:z.record(z.string(),z.union([z.literal("new"),atlasConceptId,z.null()])),
	subjectId:z.string().regex(/^as_[0-9a-f-]{36}$/).nullable(),
	auditId:z.string().regex(/^sr_[0-9a-f-]{36}$/).optional(),suggestions:z.array(z.string().max(60)).max(20).optional(),
	newSubject:z.object({title:z.string().trim().min(1).max(160),color:z.string().regex(/^#[0-9a-fA-F]{6}$/)}).strict().optional(),
	connections:z.array(z.string()).max(60),
	mapConnections:z.array(z.string()).max(60).optional(),
	reconcile:z.boolean().optional(),
}).strict();
export type IntegrationChoices=z.infer<typeof integrationChoices>;
export interface MapIntegration {
	schemaVersion:1|2|3|4|5;id:string;proposalId:string;reviewRevision:number;digest:string;baseRevision:number;
	choices:IntegrationChoices;concepts:{key:string;id:string;title:string;existing:boolean;markdown:string;x:number;y:number;reasons:string[]}[];
	associations?:SyncAssociation[];auditDigest?:string;
	updateOf?:string[];noteChanges?:{id:string;action:"added"|"updated"|"unchanged";previous:string|null}[];reusedMapConnections?:string[];
	lineChanges?:{kind:"added"|"changed"|"removed";previous?:MapConnection;next?:MapConnection}[];
	retiredMapConnections?:MapConnection[];removedMapConcepts?:{id:string;title:string}[];
	subject?:{id:string;title:string;color:string;existing:boolean};
	mapConnections?:MapConnection[];relinkedConcepts?:{key:string;id:string}[];repairOf?:string;skippedConnections?:string[];
	relations:RelationInput[];reusedRelations:string[];sourceRevision:string;sourceHash:string;mapId:string;
	status:"prepared"|"committed";committedAt?:string;
}

/** Carry forward owner-approved identities from this map only; conflicting matches remain undecided. */
export function priorMapIdentities(draft:MapDraft,atlas:AtlasSnapshot,history:MapIntegration[]):Record<string,string> {
	const result:Record<string,string>={},normalize=(s:string)=>s.trim().toLowerCase();
	for(const n of draft.concepts){
		const candidates=new Set(history.flatMap(h=>h.concepts.filter(c=>normalize(c.title)===normalize(n.title)).map(c=>c.id)));
		for(const h of history)for(const c of h.relinkedConcepts??[]){const known=atlas.concepts.find(n=>n.id===c.id);if(known&&[known.title,...known.aliases].some(t=>normalize(t)===normalize(n.title)))candidates.add(c.id);}
		const live=[...candidates].filter(id=>atlas.concepts.some(c=>c.id===id));if(live.length===1)result[n.key]=live[0]!;
	}
	const duplicates=new Set(Object.values(result).filter(id=>Object.values(result).filter(v=>v===id).length>1));
	for(const [key,id] of Object.entries(result))if(duplicates.has(id))delete result[key];
	return result;
}

/** Additive update: keep owner notes/history and mathematical claims; deduplicate existing depictions. */
export function planMapUpdate(plan:Omit<MapIntegration,"digest">,atlas:AtlasSnapshot,history:MapIntegration[]):Omit<MapIntegration,"digest"> {
	const previous=history.filter(h=>h.mapId===plan.mapId&&h.status==="committed"&&!h.repairOf);
	if(!previous.length)return plan;
	const semantic=(s:string)=>s.replace(/^(?:Source revision:|Draft:|Evidence:).*$/gm,"").trim();
	const noteChanges=plan.concepts.map(n=>{
		const old=previous.flatMap(h=>h.concepts).findLast(c=>c.id===n.id);
		return {id:n.id,action:old?(semantic(old.markdown)===semantic(n.markdown)?"unchanged" as const:"updated" as const):"added" as const,previous:old?.markdown??null};
	});
	const existing=(atlas.mapConnections??[]).filter(c=>atlas.mindmaps?.find(m=>m.id===plan.mapId)?.captures.some(r=>r.id===c.sourceRevision));
	const reusedMapConnections:string[]=[];
	const mapConnections=plan.mapConnections?.filter(c=>{
		const old=existing.find(e=>e.sourceId===c.sourceId&&e.targetId===c.targetId&&e.direction===c.direction&&e.label===c.label&&e.sourceRevision===c.sourceRevision);
		if(old){reusedMapConnections.push(old.id);return false;}return true;
	});
	const {status,...content}=plan;
	const update:Omit<MapIntegration,"digest">={...content,schemaVersion:4,updateOf:previous.map(h=>h.id),noteChanges,mapConnections,reusedMapConnections,status};
	// Old v4 previews keep their exact additive meaning; reconciliation is explicitly selected.
	if(plan.choices.reconcile===undefined)return update;
	const remaining=new Map(existing.map(c=>[c.id,c])),lines:MapConnection[]=[],reused:string[]=[],lineChanges:NonNullable<MapIntegration["lineChanges"]>=[];
	const pair=(c:MapConnection)=>[c.sourceId,c.targetId].sort().join(":");
	for(const next of plan.mapConnections??[]){
		const candidates=[...remaining.values()].filter(c=>pair(c)===pair(next));
		const old=candidates.find(c=>c.sourceRevision===next.sourceRevision&&c.sourceId===next.sourceId&&c.targetId===next.targetId&&c.direction===next.direction&&c.label===next.label&&c.assumptions===next.assumptions)??candidates[0];
		if(old)remaining.delete(old.id);
		if(old&&old.sourceRevision===next.sourceRevision&&old.sourceId===next.sourceId&&old.targetId===next.targetId&&old.direction===next.direction&&old.label===next.label&&old.assumptions===next.assumptions){reused.push(old.id);continue;}
		lines.push(next);lineChanges.push({kind:old?"changed":"added",...(old?{previous:old}:{}),next});
	}
	for(const old of remaining.values())lineChanges.push({kind:"removed",previous:old});
	const kept=new Set(plan.concepts.map(n=>n.id)),linked=new Set(atlas.mindmaps?.find(m=>m.id===plan.mapId)?.captures.find(c=>c.id===plan.sourceRevision)?.conceptIds??[]);
	const last=previous.at(-1)!;
	const removedMapConcepts=[...new Set(last.concepts.filter(c=>c.key.startsWith("draft_")).map(c=>c.id))].filter(id=>(linked.has(id)||last.sourceRevision!==plan.sourceRevision)&&!kept.has(id)).flatMap(id=>{const n=atlas.concepts.find(c=>c.id===id);return n?[{id,title:n.title}]:[];});
	const retired=plan.choices.reconcile?lineChanges.flatMap(c=>c.previous?[c.previous]:[]):[];
	return {...content,schemaVersion:5,updateOf:previous.map(h=>h.id),noteChanges,
		mapConnections:lines,reusedMapConnections:reused,
		lineChanges,retiredMapConnections:retired,removedMapConcepts:plan.choices.reconcile?removedMapConcepts:[],status};
}
export interface MapReviewStore {
	read(proposalId:string):MapReview;
	save(input:z.infer<typeof mapReviewInput>):MapReview;
	prepare(proposalId:string,expectedRevision:number,choices:IntegrationChoices,expectedBase?:number):MapIntegration;
	prepareConnections(proposalId:string,expectedBase:number,identities?:Record<string,string>):MapIntegration;
	commit(id:string,digest:string):MapIntegration;
}
export function identityCandidates(title:string,atlas:AtlasSnapshot) {
	const normalize=(s:string)=>s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu," ").trim();
	const needle=normalize(title);
	return atlas.concepts.filter(c=>[c.title,...c.aliases].some(t=>{const v=normalize(t);return v===needle||needle.length>3&&v.length>3&&(v.includes(needle)||needle.includes(v));}));
}
/** No identity inference: every kept node has an explicit create/reuse choice. */
export function planMapIntegration(p:MapProposal,review:MapReview,atlas:AtlasSnapshot,choices:IntegrationChoices,id:string,mint:(key:string)=>string,audit?:SyncReview|null):Omit<MapIntegration,"digest"> {
	if(!p.draft||!p.digest||p.status!=="prepared")throw new AtlasError("Only prepared map drafts can be integrated.");
	const draft=mapDraft.parse(review.draft),keys=new Set(draft.concepts.map(n=>n.key)),picked=new Set(choices.connections),ordinary=new Set(choices.mapConnections??[]);
	if(Object.keys(choices.identities).some(k=>!keys.has(k))||draft.concepts.some(n=>!(n.key in choices.identities)))throw new AtlasError("Choose an identity for every concept.");
	if(ordinary.size!==(choices.mapConnections?.length??0)||[...ordinary].some(k=>!draft.connections.some(e=>e.key===k)))throw new AtlasError("Invalid mind-map connection selection.");
	if(picked.size!==choices.connections.length||choices.connections.some(k=>!draft.connections.some(e=>e.key===k)))throw new AtlasError("Invalid connection selection.");
	if(choices.subjectId&&choices.newSubject)throw new AtlasError("Choose an existing subject or create one, not both.");
	const knownSubject=atlas.subjects.find(s=>s.id===choices.subjectId);
	if(choices.subjectId&&!knownSubject)throw new AtlasError("Subject no longer exists.",409);
	if(!knownSubject&&!choices.newSubject)throw new AtlasError("Choose or create a subject before integrating.");
	if(choices.newSubject&&atlas.subjects.some(s=>s.title.toLowerCase()===choices.newSubject!.title.toLowerCase()))throw new AtlasError("A subject with that title exists. Select it instead.",409);
	const subject=knownSubject?{id:knownSubject.id,title:knownSubject.title,color:knownSubject.color,existing:true}:{id:mint("subject"),...choices.newSubject!,existing:false};
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
	let associations:SyncAssociation[]=[];
	if(choices.auditId){
		if(!audit||audit.id!==choices.auditId||audit.kind!=="map"||audit.status!=="prepared"||audit.sourceId!==p.id||audit.sourceHash!==review.digest||audit.reviewRevision!==review.revision||audit.baseRevision!==(atlas.layoutRevision??0))throw new AtlasError("Identity review is stale. Run it again against the current Atlas.",409);
		const additions=suggestedRelations(audit,choices.suggestions??[],mapping,atlas,mint);associations=additions.associations;
		relations.push(...additions.relations.filter(r=>!relations.some(o=>o.sourceId===r.sourceId&&o.targetId===r.targetId&&o.relationType===r.relationType&&o.conditions===r.conditions)));reusedRelations.push(...additions.reusedRelations);
		for(const [target,notes] of additions.notes){let n=concepts.find(c=>c.id===target);if(!n){const old=atlas.concepts.find(c=>c.id===target)!;n={key:target,id:target,title:old.title,existing:true,markdown:"",x:old.x,y:old.y,reasons:["AI connection needs mathematical review and personal study"]};concepts.push(n);}n.markdown+=`\n\n${notes.join("\n\n")}`;}
	}else if(choices.suggestions?.length)throw new AtlasError("Run the connection review before accepting suggestions.");
	if(new Set([...map.captures.find(c=>c.id===p.sourceRevision)!.conceptIds,...concepts.map(n=>n.id)]).size>200)throw new AtlasError("This source revision cannot link more than 200 concepts.");
	if(concepts.some(c=>{const n=atlas.concepts.find(n=>n.id===c.id);return n&&!n.subjectIds.includes(subject.id)&&n.subjectIds.length>=50;}))throw new AtlasError("A reused concept has reached its subject membership limit.");
	return {schemaVersion:3,id,subject,mapConnections,associations,...(audit?{auditDigest:audit.digest}:{}),proposalId:p.id,reviewRevision:review.revision,baseRevision:atlas.layoutRevision??0,choices,concepts,relations,reusedRelations,sourceRevision:p.sourceRevision,sourceHash:p.sourceHash,mapId:map.id,status:"prepared"};
}

/** Reuse the original approved mapping; repairs never create/rename concepts or promote claims. */
export function planMapConnectionRepair(p:MapProposal,review:MapReview,original:MapIntegration,atlas:AtlasSnapshot,id:string,mint:(key:string)=>string,identities:Record<string,string>={},linked:Record<string,string>={}):Omit<MapIntegration,"digest"> {
	if(original.status!=="committed"||original.repairOf||original.proposalId!==p.id||original.reviewRevision!==review.revision||original.sourceRevision!==p.sourceRevision||original.sourceHash!==p.sourceHash)
		throw new AtlasError("Repair needs the unchanged original integration.",409);
	if(!atlas.mindmaps?.some(m=>!m.archived&&m.currentRevision===p.sourceRevision&&m.captures.some(c=>c.id===p.sourceRevision&&c.hash===p.sourceHash)))
		throw new AtlasError("This map was rewritten or archived. Review the current revision instead.",409);
	const ids=new Set(atlas.concepts.map(n=>n.id)),mapping=new Map(original.concepts.filter(n=>ids.has(n.id)).map(n=>[n.key,n.id]));
	const keysInDraft=new Set(review.draft.concepts.map(n=>n.key));
	for(const [key,target] of Object.entries(linked))if(keysInDraft.has(key)&&ids.has(target)&&!mapping.has(key))mapping.set(key,target);
	const relinkedConcepts=Object.entries(identities).map(([key,target])=>{
		if(!keysInDraft.has(key)||!ids.has(target)||mapping.has(key))throw new AtlasError("Only excluded or removed draft identities can be linked to existing concepts.",409);
		if([...mapping.values()].includes(target))throw new AtlasError("Two draft nodes cannot map to one identity. Review their meaning separately.");
		mapping.set(key,target);return {key,id:target};
	});
	if(new Set([...atlas.mindmaps!.find(m=>m.id===original.mapId)!.captures.find(c=>c.id===p.sourceRevision)!.conceptIds,...mapping.values()]).size>200)throw new AtlasError("This source revision cannot link more than 200 concepts.");
	const subjectId=relinkedConcepts.length?atlas.mindmaps!.find(m=>m.id===original.mapId)!.subjectId??null:null;
	if(subjectId&&relinkedConcepts.some(c=>{const n=atlas.concepts.find(n=>n.id===c.id)!;return !n.subjectIds.includes(subjectId)&&n.subjectIds.length>=50;}))throw new AtlasError("A reused concept has reached its subject membership limit.");
	const present=new Set(atlas.mapConnections?.filter(c=>c.proposalId===p.id).map(c=>c.connectionKey));
	const skipped=review.draft.connections.filter(e=>!mapping.has(e.source)||!mapping.has(e.target)).map(e=>e.key);
	const keys=review.draft.connections.filter(e=>!skipped.includes(e.key)&&!present.has(e.key)).map(e=>e.key);
	return {schemaVersion:3,id,...(relinkedConcepts.length?{relinkedConcepts}:{}),proposalId:p.id,reviewRevision:review.revision,baseRevision:atlas.layoutRevision??0,repairOf:original.id,
		choices:{identities:Object.fromEntries(mapping),subjectId,connections:[],mapConnections:keys},concepts:[],relations:[],reusedRelations:[],
		mapConnections:draftMapConnections(p,review.draft,mapping,keys,mint),skippedConnections:skipped,
		sourceRevision:p.sourceRevision,sourceHash:p.sourceHash,mapId:original.mapId,status:"prepared"};
}
