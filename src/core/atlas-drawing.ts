import {z} from "zod";
import type {AtlasSnapshot} from "./atlas.ts";
import {visibleMapConnections} from "./map-connections.ts";

const conceptId=z.string().regex(/^ac_[0-9a-f-]{36}$/);
export const nodeEmphasis=z.record(conceptId,z.enum(["small","prominent"])).refine(v=>Object.keys(v).length<=500,"Emphasise up to 500 nodes per view.");
export type NodeEmphasis=z.infer<typeof nodeEmphasis>;
export const emphasisScale=(value?:string)=>value==="prominent"?2:value==="small"?.65:1;
/** Owner drawing edits overlay immutable source records; never change claims. */
export const drawingLink=z.object({
 id:z.string().regex(/^dl_[0-9a-f-]{36}$/),sourceId:conceptId,targetId:conceptId,
 label:z.string().trim().max(160),direction:z.enum(["forward","both","unclear"]),notes:z.string().max(2000),
 replaces:z.string().regex(/^(mc|ar)_[0-9a-f-]{36}$/).nullable(),removed:z.boolean(),
}).strict().refine(v=>v.sourceId!==v.targetId,"Choose two different concepts.");
export type DrawingLink=z.infer<typeof drawingLink>;
export const drawingLinkCommand=drawingLink.safeExtend({kind:z.literal("drawing-link"),expectedRevision:z.number().int().nonnegative()});
export interface DrawingConnection {id:string;sourceId:string;targetId:string;label:string;direction:DrawingLink["direction"];notes:string;origin:"source"|"ai"|"owner";}
export function drawingConnections(atlas:AtlasSnapshot):DrawingConnection[]{
 const sources:DrawingConnection[]=[...visibleMapConnections(atlas).map(c=>({id:c.id,sourceId:c.sourceId,targetId:c.targetId,label:c.label,direction:c.direction,notes:[c.rationale,c.assumptions,c.uncertainty].filter(Boolean).join("\n\n"),origin:"source" as const})),...(atlas.associations??[]).map(c=>({...c,direction:"unclear" as const,notes:c.status,origin:"ai" as const}))];
 const overrides=new Map((atlas.drawingLinks??[]).filter(c=>c.replaces).map(c=>[c.replaces!,c]));
 const known=new Set(atlas.concepts.map(c=>c.id));
 return [...sources.flatMap(c=>{const edit=overrides.get(c.id);return edit?edit.removed?[]:[{...edit,origin:"owner" as const}]:[c];}),...(atlas.drawingLinks??[]).filter(c=>!c.replaces&&!c.removed).map(c=>({...c,origin:"owner" as const}))].filter(c=>known.has(c.sourceId)&&known.has(c.targetId));
}
