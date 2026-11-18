import {z} from 'zod';
import {researchTrailId,researchNodeId,researchWorkspaceId} from './research-trails.ts';

export const researchDigest=z.string().regex(/^[a-f0-9]{64}$/);
const localId=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const text=z.string().max(8000);
export const researchArtifactSchema=z.object({path:z.string().min(1).max(500),hash:researchDigest,mime:z.enum(['text/plain','text/csv','application/json','application/pdf','image/png','image/jpeg','image/webp']).optional()}).strict();
export const researchRunSchema=z.object({
 schemaVersion:z.literal(1),runId:localId,trailId:researchTrailId,objective:text.optional(),
 timestamp:z.string().datetime().optional(),outcome:z.enum(['completed','failed','interrupted','unknown']).default('unknown'),
 codeReference:z.string().max(2000).optional(),command:z.string().max(2000).optional(),parameters:z.record(z.string(),z.unknown()).optional(),
 seed:z.union([z.number().finite(),z.string().max(200)]).optional(),environment:z.record(z.string(),z.string().max(1000)).optional(),
 evaluators:z.record(z.string(),z.string().max(2000)).optional(),metrics:z.record(z.string(),z.union([z.number().finite(),z.string().max(1000),z.null()])).optional(),
 outputs:z.array(text).max(30).optional(),artifacts:z.array(researchArtifactSchema).max(30).default([]),limitations:z.array(z.string().max(2000)).max(30).default([]),
 workbench:z.object({chatId:localId,runId:localId}).strict().optional(),
}).strict();
export type ResearchRun=z.infer<typeof researchRunSchema>;
export const researchRunIndexSchema=z.object({schemaVersion:z.literal(1),runId:localId,path:z.string().max(110),hash:researchDigest}).strict().refine(r=>r.path===`${r.runId}.json`,'Run path must match its ID');
export const researchSourceSchema=z.object({id:localId,kind:z.enum(['brief','handoff','run','git']),path:z.string().max(1000),hash:researchDigest,content:z.string().max(65536),run:researchRunSchema.optional()}).strict();
export type ResearchImportSource=z.infer<typeof researchSourceSchema>;
const gitSchema=z.object({revision:z.string().max(100).nullable(),dirty:z.boolean(),files:z.array(z.string().max(1000)).max(500),limitation:z.string().max(2000).optional()}).strict();
export const researchCheckpointSchema=z.object({trailId:researchTrailId,workspaceId:researchWorkspaceId,fileHashes:z.record(z.string(),researchDigest),runHashes:z.record(z.string(),researchDigest),git:gitSchema.nullable(),runCursor:z.number().int().nonnegative().optional(),receipt:z.string(),updatedAt:z.string().datetime()}).strict();
export type ResearchCheckpoint=z.infer<typeof researchCheckpointSchema>;
export const preparedResearchSchema=z.object({id:z.string().uuid(),digest:researchDigest,trailId:researchTrailId,workspaceId:researchWorkspaceId,createdAt:z.string().datetime(),status:z.enum(['prepared','applied','dismissed']),
 base:z.object({trailRevision:z.number().int().positive(),workspaceRevision:z.number().int().positive(),nodes:z.array(z.object({id:researchNodeId,revision:z.number().int().positive()}).strict()).max(500),checkpointReceipt:z.string().nullable()}).strict(),
 sources:z.array(researchSourceSchema).max(24),fileHashes:z.record(z.string(),researchDigest),runHashes:z.record(z.string(),researchDigest),git:gitSchema.nullable(),warnings:z.array(z.string().max(2000)).max(200),remaining:z.number().int().nonnegative(),runCursor:z.number().int().nonnegative().optional(),
}).strict();
export type PreparedResearch=z.infer<typeof preparedResearchSchema>;
export const researchDecisionSchema=z.object({sourceId:localId,nodeId:researchNodeId.nullable(),parentNodeId:researchNodeId,title:z.string().trim().min(1).max(160),interpretation:text,uncertainty:z.string().max(4000),included:z.boolean()}).strict();
export const researchApplySchema=z.object({reviewId:z.string().uuid(),digest:researchDigest,decisions:z.array(researchDecisionSchema).max(24),dismiss:z.boolean()}).strict();
export type ResearchApply=z.infer<typeof researchApplySchema>;
export const researchEvidenceSchema=z.object({id:z.string().uuid(),nodeId:researchNodeId,sourceId:localId,reviewId:z.string().uuid(),title:z.string().min(1).max(160),interpretation:text,uncertainty:z.string().max(4000),source:researchSourceSchema,createdAt:z.string().datetime()}).strict();
export type ResearchEvidence=z.infer<typeof researchEvidenceSchema>;
export type ResearchReceipt={reviewId:string;status:'applied'|'dismissed';evidenceIds:string[]};
export interface ResearchIntegrationStore {
 checkpoint(trailId:string,workspaceId:string):ResearchCheckpoint|null;
 reviews(trailId:string):{id:string;digest:string;status:PreparedResearch['status'];createdAt:string}[];
 review(id:string):PreparedResearch;
 prepare(snapshot:PreparedResearch):PreparedResearch;
 apply(input:ResearchApply):ResearchReceipt;
 evidence(trailId:string,before?:string):ResearchEvidence[];
}
