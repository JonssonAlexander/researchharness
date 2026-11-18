import type {ResearchIntegrationStore} from './research-integration.ts';
import { z } from 'zod';
import { atlasConceptId } from './atlas.ts';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_${uuid}$`));
export const researchTrailId = id('rt');
export const researchNodeId = id('rn');
export const researchWorkspaceId = id('rw');
const requestId = z.string().uuid();
const title = z.string().trim().min(1).max(160);
const body = z.string().max(16000);
const concepts = z.array(atlasConceptId).max(50).refine(ids => new Set(ids).size === ids.length, 'Duplicate concepts');
const origin = z.object({kind:z.enum(['atlas','chat','lesson','manual']),chatId:z.string().min(1).max(200).optional(),messageId:z.string().min(1).max(200).optional(),lessonNodeId:z.string().min(1).max(200).optional()}).strict();
const status = z.enum(['active','paused','resolved','abandoned']);
const nodeKind = z.enum(['question','approach','note','open-issue']);
const revision = z.number().int().min(1);
const anchors = {anchorConceptIds:concepts,primaryConceptId:atlasConceptId.nullable()};
const linksValid = (v:{anchorConceptIds:string[];primaryConceptId:string|null}) => v.primaryConceptId === null ? v.anchorConceptIds.length === 0 : v.anchorConceptIds.includes(v.primaryConceptId);
const nodeFields = {nodeKind,title,body,relatedConceptIds:concepts};
export const researchCommandSchema = z.discriminatedUnion('kind',[
 z.object({kind:z.literal('create'),requestId,id:researchTrailId,rootNodeId:researchNodeId,title,question:title,...anchors,origin}).strict(),
 z.object({kind:z.literal('edit-trail'),id:researchTrailId,expectedRevision:revision,title,status,...anchors,archived:z.boolean()}).strict(),
 z.object({kind:z.literal('add-node'),requestId,id:researchNodeId,trailId:researchTrailId,parentNodeId:researchNodeId,...nodeFields}).strict(),
 z.object({kind:z.literal('edit-node'),id:researchNodeId,expectedRevision:revision,parentNodeId:researchNodeId.nullable(),...nodeFields}).strict(),
 z.object({kind:z.literal('workspace'),requestId,id:researchWorkspaceId,label:title,localRoot:z.string().min(1).max(4096),expectedRevision:z.number().int().nonnegative(),provision:z.enum(['pending','ready','repair-needed'])}).strict(),
 z.object({kind:z.literal('bind'),requestId,trailId:researchTrailId,workspaceId:researchWorkspaceId.nullable(),expectedRevision:revision}).strict(),
]).refine(c => c.kind !== 'create' && c.kind !== 'edit-trail' || linksValid(c), 'Primary concept must be one of the anchors');
const timestamp = z.string().datetime();
export const researchWorkspaceSchema = z.object({id:researchWorkspaceId,label:title,localRoot:z.string().min(1).max(4096),revision,provision:z.enum(['pending','ready','repair-needed']),createdAt:timestamp,updatedAt:timestamp}).strict();
export const researchTrailSchema = z.object({id:researchTrailId,title,rootNodeId:researchNodeId,status,workspaceId:researchWorkspaceId.nullable(),...anchors,origin,revision,createdAt:timestamp,updatedAt:timestamp,archivedAt:timestamp.nullable()}).strict().refine(linksValid);
export const researchNodeSchema = z.object({id:researchNodeId,trailId:researchTrailId,parentNodeId:researchNodeId.nullable(),kind:nodeKind,title,body,relatedConceptIds:concepts,revision,createdAt:timestamp,updatedAt:timestamp}).strict();
export type ResearchCommand = z.infer<typeof researchCommandSchema>;
export type ResearchWorkspace = {id:string;label:string;localRoot:string;revision:number;provision:'pending'|'ready'|'repair-needed';createdAt:string;updatedAt:string};
export type ResearchTrail = {id:string;title:string;rootNodeId:string;status:z.infer<typeof status>;workspaceId:string|null;primaryConceptId:string|null;anchorConceptIds:string[];origin:z.infer<typeof origin>;revision:number;createdAt:string;updatedAt:string;archivedAt:string|null;missingConceptIds:string[];linkedConceptIds:string[]};
export type ResearchNode = {id:string;trailId:string;parentNodeId:string|null;kind:z.infer<typeof nodeKind>;title:string;body:string;relatedConceptIds:string[];revision:number;createdAt:string;updatedAt:string;missingConceptIds:string[]};
export interface ResearchStore { integration:ResearchIntegrationStore; list():{trails:ResearchTrail[];workspaces:ResearchWorkspace[]}; detail(id:string):{trail:ResearchTrail;nodes:ResearchNode[];workspace:ResearchWorkspace|null}; save(command:ResearchCommand):{trailId?:string;workspaceId?:string} }
