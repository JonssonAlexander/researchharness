import {z} from "zod";
import type {LearningSession} from "./learning-session.ts";
export const problemKey=z.string().regex(/^pb_[0-9a-f-]{36}$/);
export const challengeSettings=z.object({workflow:z.literal("challenge"),minutes:z.number().int().min(5).max(240).default(45)}).strict();
export type ChallengeSettings=z.infer<typeof challengeSettings>;
export const problemStatus=z.enum(["inProgress","solved","solvedWithHints","setAside"]);
export const problemStatusLabel={inProgress:"In progress",solved:"Solved independently",solvedWithHints:"Solved with hints",setAside:"Set aside"};
export const problemSubmission=z.object({title:z.string().trim().min(1).max(160),statement:z.string().trim().min(1).max(16000),modelSolution:z.string().trim().min(1).max(40000),source:z.object({kind:z.enum(["past","generated","supplied"]),citation:z.string().trim().min(1).max(2000),url:z.string().url().max(2000).regex(/^https?:\/\//).optional()}).strict(),checking:z.string().trim().min(30).max(12000),conceptIds:z.array(z.string().max(100)).max(20),techniqueIds:z.array(z.string().max(100)).max(20)}).strict();
export type ProblemSubmission=z.infer<typeof problemSubmission>;
const event=z.object({at:z.string(),status:problemStatus.optional(),reveal:z.literal(true).optional(),defect:z.string().max(2000).optional(),debrief:z.string().max(4000).optional()}).strict();
export const problemAttempt=z.object({id:z.string(),chatId:z.string(),callId:z.string(),createdAt:z.string(),minutes:z.number(),events:z.array(event)}).strict();
export const savedProblem=problemSubmission.extend({schemaVersion:z.literal(1),id:problemKey,createdAt:z.string(),attempts:z.array(problemAttempt),integrationReviewIds:z.array(z.string())}).strict();
export type SavedProblem=z.infer<typeof savedProblem>;
export type ProblemAttempt=z.infer<typeof problemAttempt>;
export function attemptStatus(a:ProblemAttempt){return a.events.filter(e=>e.status).at(-1)?.status??"inProgress";}
export function attemptRevealed(a:ProblemAttempt){return a.events.some(e=>e.reveal);}
/** Client projection never includes checking/technique spoilers or an unrevealed solution. */
export function publicProblem(p:SavedProblem,attemptId=p.attempts.at(-1)?.id){const a=p.attempts.find(a=>a.id===attemptId);return {selectedAttemptId:a?.id,id:p.id,title:p.title,statement:p.statement,source:p.source,conceptIds:p.conceptIds,techniqueIds:a&&attemptRevealed(a)?p.techniqueIds:[],createdAt:p.createdAt,integrationReviewIds:p.integrationReviewIds,attempts:p.attempts.map(item=>({...item,events:item.id===a?.id?item.events:[],status:attemptStatus(item),revealed:attemptRevealed(item)})),...a&&attemptRevealed(a)?{solution:p.modelSolution,checking:p.checking}:{}};}
export type PublicProblem=ReturnType<typeof publicProblem>;
export function challengeLesson(p:Pick<SavedProblem,"title"|"statement"|"conceptIds">,a:ProblemAttempt):LearningSession{return {schemaVersion:1,revision:1,status:"active",plan:{objective:p.title,nodes:[{id:a.id,title:p.title,conceptId:p.conceptIds[0]??null,tangent:false}],connections:[],currentNodeId:a.id,derivations:[{id:a.id,nodeId:a.id,title:p.title,start:p.statement.length<=4000?p.statement:"See the full saved problem statement in the conversation.",finish:"Solve the problem. Explain the key argument and its conditions.",status:attemptStatus(a)==="solved"||attemptStatus(a)==="solvedWithHints"?"finished":"working"}],activeDerivationId:a.id}};}
/** Stable, namespaced hubs: problems share actual canonical concepts, never name-only merges. */
export function problemGraph(problems:PublicProblem[],concepts:{id:string;title:string}[]){const known=new Map(concepts.map(c=>[c.id,c])),used=new Set(problems.flatMap(p=>[...p.conceptIds,...p.techniqueIds]).filter(id=>known.has(id)));return {nodes:[...problems.map(p=>({id:p.id,title:p.title,kind:"problem" as const})),...Array.from(used,id=>({id,title:known.get(id)!.title,kind:"concept" as const}))],edges:problems.flatMap(p=>Array.from(new Set([...p.conceptIds,...p.techniqueIds])).filter(id=>used.has(id)).map(id=>({from:p.id,to:id})))};}

export interface ProblemStore {
 read:(id:string)=>SavedProblem|null;
 list:()=>SavedProblem[];
 byChat:(chatId:string)=>{problem:SavedProblem;attempt:ProblemAttempt}[];
 create:(input:ProblemSubmission,chatId:string,callId:string,minutes:number)=>{problem:SavedProblem;attempt:ProblemAttempt};
 append:(id:string,attemptId:string,event:ProblemAttempt["events"][number])=>SavedProblem;
 retry:(id:string,chatId:string,callId:string,minutes:number,attemptId?:string)=>{problem:SavedProblem;attempt:ProblemAttempt};
 bindCall:(id:string,attemptId:string,callId:string)=>void;
 link:(id:string,reviewId:string)=>void;
}
