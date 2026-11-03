import {z} from "zod";
import type {LearningSession} from "./learning-session.ts";
import type {LhMarkerMessage,LhMessage} from "./native-messages.ts";
import type {AgentMessage} from "@earendil-works/pi-agent-core";
import {activeCompactionOf,keptIndexFor} from "./compaction.ts";
import type {ImageContent} from "@earendil-works/pi-ai";
export const SCRATCH_LIMITS={sceneBytes:16*1024*1024,imageBytes:10*1024*1024,elements:10000,text:20000};
export const scratchKey=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),attemptId=z.string().regex(/^sa_[0-9a-f-]{36}$/);
export const scratchScene=z.object({type:z.literal("excalidraw"),version:z.literal(2),source:z.string().optional(),elements:z.array(z.record(z.string(),z.unknown())).max(SCRATCH_LIMITS.elements),appState:z.record(z.string(),z.unknown()),files:z.record(z.string(),z.object({id:z.string(),dataURL:z.string().max(14*1024*1024),mimeType:z.enum(["image/png","image/jpeg","image/webp"]),created:z.number(),lastRetrieved:z.number().optional()}).passthrough())}).strict();
export const scratchTarget=z.object({id:scratchKey,title:z.string().max(160),start:z.string().max(4000),finish:z.string().max(4000)}).strict();
export type ScratchTarget=z.infer<typeof scratchTarget>;
export type ScratchScene=z.infer<typeof scratchScene>;
export interface ScratchDraft {schemaVersion:1;revision:number;target:ScratchTarget;scene:ScratchScene;text:string;updatedAt:string;}
export interface ScratchAttempt {schemaVersion:1;id:string;chatId:string;padId:string;number:number;draft:ScratchDraft;sceneHash:string;imageHash:string|null;createdAt:string;}
/** Local immutable lesson attachment; pixels and scene are never embedded in Atlas snapshots. */
export interface ScratchNote {id:string;chatId:string;padId:string;title:string;revision:number;updatedAt:string;sceneHash:string;imageHash:string|null;attemptId?:string;}
export interface RetainedScratchwork {note:ScratchNote;draft:ScratchDraft;}
export interface ScratchpadStore {
 retain:(chatId:string,padId:string,draft:ScratchDraft,attemptId?:string)=>ScratchNote;
 retained:(id:string)=>RetainedScratchwork|null;
 retainedImage:(id:string)=>Uint8Array;

 read:(chatId:string,padId:string)=>ScratchDraft|null;
 save:(chatId:string,padId:string,expectedRevision:number,draft:Pick<ScratchDraft,"scene"|"text"|"target">)=>ScratchDraft;
 list:(chatId:string,padId:string)=>ScratchAttempt[];
 attempt:(chatId:string,id:string)=>ScratchAttempt|null;
 capture:(chatId:string,padId:string,id:string,expectedRevision:number,image:Uint8Array|null)=>ScratchAttempt;
 image:(chatId:string,id:string)=>Uint8Array;
 remove:(chatId:string)=>void;
}
export function lessonScratchTarget(lesson:LearningSession,targetId?:string):ScratchTarget{
 const p=lesson.plan,d=p.derivations.find(d=>d.id===(targetId??p.activeDerivationId));
 const topic=p.nodes.find(n=>n.id===(targetId?.startsWith("topic-")?targetId.slice(6):p.currentNodeId))??p.nodes[0]!;
 return d?{id:d.id,title:d.title,start:d.start,finish:d.finish}:{id:`topic-${topic.id}`,title:"Lesson scratchpad",start:topic.title,finish:p.objective};
}
/** Separate working pad per successfully posed practice problem; never reads its hidden solution. */
export function practiceScratchTarget(messages:readonly LhMessage[],padId?:string):ScratchTarget|null{
 const succeeded=new Set(messages.flatMap(m=>m.role==="toolResult"&&m.toolName==="problem"&&!m.isError?[m.toolCallId]:[]));
 const problems=messages.flatMap(m=>m.role==="assistant"?m.content.flatMap(c=>c.type==="toolCall"&&c.name==="problem"&&succeeded.has(c.id)&&typeof c.arguments.statement==="string"?[c.arguments.statement]:[]):[]);
 if(padId==="practice-draft"||!padId&&!problems.length)return {id:"practice-draft",title:"Practice scratchpad",start:"Working notes for this practice session.",finish:"Explain your reasoning."};
 const index=padId?Number(/^practice-(\d+)$/.exec(padId)?.[1])-1:problems.length-1,statement=problems[index];
 return typeof statement==="string"?{id:`practice-${index+1}`,title:`Practice problem ${index+1}`,start:statement.length<=4000?statement:"See the full problem statement in the conversation.",finish:"Solve the problem and explain your reasoning."}:null;
}
export function scratchAttemptMessage(a:ScratchAttempt):LhMarkerMessage{return {id:a.id,role:"custom",customType:"scratchpad-attempt",display:true,timestamp:Date.parse(a.createdAt),details:{attemptId:a.id,padId:a.padId,number:a.number,hasImage:!!a.imageHash,text:a.draft.text,title:a.draft.target.title},content:`Learner attempt ${a.number}: ${a.draft.target.title}\nStart: ${a.draft.target.start}\nFinish: ${a.draft.target.finish}\n${a.draft.text}${a.imageHash?"\n[Submitted drawing attached at the model boundary.]":""}\nGive a concise hint or explanation based on this attempt; preserve uncertainty in handwritten symbols.`};}
/** Hydrate only at dispatch. Native history retains references, never base64 copies. */
export function resolveScratchpadImages(messages:readonly AgentMessage[],read:(id:string)=>ImageContent):AgentMessage[]{const source=messages as readonly LhMessage[],cut=activeCompactionOf(source),start=cut?keptIndexFor(source,cut):0;return messages.map((m,i)=>{
 if(i<start)return m;
 if(m.role!=="custom"||m.customType!=="scratchpad-attempt")return m;
 const d=m.details as {hasImage?:boolean};return {role:"user",id:m.id,timestamp:m.timestamp,content:[{type:"text" as const,text:m.content},...(d.hasImage?[read(m.id)]:[])]};
});}
export function scratchDelivery(messages:readonly LhMessage[],id:string):"ready"|"submitted"|"answered"|"failed"{
 const i=messages.findIndex(m=>m.id===id);if(i<0)return "ready";
 const tail=messages.slice(i+1),boundary=tail.findIndex(m=>m.role==="user"||m.role==="custom"&&["scratchpad-attempt","practice-thinking","practice-next"].includes(m.customType)),responses=tail.slice(0,boundary<0?tail.length:boundary).filter(m=>m.role==="assistant"),next=responses.at(-1);return !next?"submitted":next.role==="assistant"&&["error","aborted"].includes(next.stopReason)?"failed":"answered";
}
