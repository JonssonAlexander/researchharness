import { z } from "zod";
import { atlasConceptId, type AtlasConcept } from "./atlas.ts";
import { mindmapRevisionId } from "./mindmaps.ts";
import { RELATION_TYPES } from "./atlas-relations.ts";

const text = z.string().max(4000);
const region = z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)})
	.strict().refine(r => r.x+r.w<=1.001 && r.y+r.h<=1.001, "Region exceeds page");
const evidence = z.object({page:z.number().int().min(0).max(7),quote:z.string().min(1).max(1000),region:region.nullable()}).strict();
export const mapFindings = z.object({
	transcription:z.string().max(16000),
	concepts:z.array(z.object({key:z.string().regex(/^draft_[a-zA-Z0-9_-]{1,40}$/),title:z.string().trim().min(1).max(160),
		aliases:z.array(z.string().min(1).max(160)).max(10),existingId:atlasConceptId.nullable(),notes:text,evidence,uncertainty:text}).strict()).max(40),
	relations:z.array(z.object({source:z.string().max(46),target:z.string().max(46),type:z.enum(RELATION_TYPES),conditions:text,evidence,uncertainty:text}).strict()).max(60),
	questions:z.array(z.string().min(1).max(2000)).max(20),
}).strict();
export type MapFindings = z.infer<typeof mapFindings>;
export type ProposalContext = Pick<AtlasConcept,"id"|"title"|"aliases"|"revision">;
export function validateMapFindings(value:MapFindings,context:ProposalContext[],pages:number):string|null {
	const keys = new Set(value.concepts.map(c=>c.key));
	if(keys.size!==value.concepts.length) return "Use unique draft keys.";
	const seen = new Set<string>(), normalize=(s:string)=>s.trim().toLowerCase();
	for(const c of value.concepts) {
		if(c.evidence.page>=pages) return "Evidence page does not exist.";
		if(c.existingId) {
			const known=context.find(n=>n.id===c.existingId);
			if(!known || ![known.title,...known.aliases].some(t=>normalize(t)===normalize(c.title)) || seen.has(c.existingId))
				return "Reuse an existing ID only once and only for an exact known title/alias. Otherwise leave existingId null and explain uncertainty.";
			seen.add(c.existingId);
		}
	}
	for(const r of value.relations) if(!keys.has(r.source)||!keys.has(r.target)||r.source===r.target||r.evidence.page>=pages)
		return "Relations need distinct draft endpoints and a real evidence page.";
	return null;
}
const count=z.number().finite().nonnegative().optional();
const call=z.object({inputTokens:count,outputTokens:count,cacheReadTokens:count,cacheWriteTokens:count,cacheWrite1hTokens:count,reasoningTokens:count}).strict();
export const proposalRecord = z.object({
	schemaVersion:z.literal(1),id:z.string().regex(/^mp_[0-9a-f-]{36}$/),sourceRevision:mindmapRevisionId,
	sourceHash:z.string().regex(/^[a-f0-9]{64}$/),baseRevision:z.number().int().nonnegative(),
	context:z.array(z.object({id:atlasConceptId,title:z.string().max(160),aliases:z.array(z.string().max(160)).max(10),revision:z.number().int().positive()}).strict()).max(40),
	model:z.string().min(1).max(240),status:z.enum(["running","prepared","failed","cancelled"]),
	images:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(8),findings:mapFindings.nullable(),digest:z.string().nullable(),
	createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),error:z.string().max(2000).nullable(),
	usage:z.object({model:z.string(),steps:z.number().int().nonnegative(),inputTokens:count,outputTokens:count,cacheReadTokens:count,
		cacheWriteTokens:count,cacheWrite1hTokens:count,reasoningTokens:count,calls:z.array(call).optional(),lastStep:call.optional()}).strict().optional(),
}).strict();
export type MapProposal=z.infer<typeof proposalRecord>;
export interface ProposalView extends MapProposal {
	estimatedCost:number|null;
	attempts?: {id:string;status:MapProposal["status"];model:string;calls:number|null;estimatedCost:number|null}[];
}
export interface MapProposalStore {
	read(id:string):MapProposal|null;
	latest(sourceRevision:string):MapProposal|null;
	history(sourceRevision:string):MapProposal[];
	begin(record:MapProposal):boolean;
	update(record:MapProposal):void;
	retainImage(bytes:Uint8Array):string;
	image(hash:string):Uint8Array;
}
