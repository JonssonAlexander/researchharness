import {z} from "zod";
import {randomUUID} from "node:crypto";
import {AtlasError} from "../core/atlas.ts";
import {publicProblem,problemKey,problemStatus,challengeSettings,challengeLesson,attemptStatus,attemptRevealed,type SavedProblem,type ProblemAttempt} from "../core/problems.ts";
import type {ChatRecord} from "../core/contracts/chat.ts";
import type {LhMessage} from "../core/native-messages.ts";
import {stores} from "./stores.ts";
import {isTurnRunning} from "./turn-liveness.ts";
import {compactionInFlight} from "./compaction.ts";
import {readSourceBody} from "./mindmaps.ts";
/** Redaction is only for browser/export views. The model and persisted native transcript stay intact. */
export function challengeClientValue<T>(value:T,chatId:string,entries?:ReturnType<typeof stores.problemStore.byChat>):T{
 if(!entries&&!stores.chatStore.getChat(chatId)?.challenge)return value;
 const saved=entries??stores.problemStore.byChat(chatId);
 function visit(v:unknown):unknown{
  if(Array.isArray(v))return v.filter(x=>!(x&&typeof x==="object"&&"type" in x&&x.type==="thinking")).map(visit);
  if(!v||typeof v!=="object")return v;
  const o=v as Record<string,unknown>;
  if(o.role==="system")return {role:"system",content:"[Hidden challenge preparation]"};
  if(o.customType==="compaction")return {...o,content:"[Context compacted; hidden challenge preparation omitted from this view.]",details:{}};
  if((o.type==="toolCall"&&o.name==="problem")||(o.toolName==="problem"&&"args" in o)){
   const entry=saved.find(x=>x.attempt.callId===(o.id??o.toolCallId)||String(o.id??o.toolCallId).startsWith(`${x.attempt.callId}~`));
   const args=entry?{statement:entry.problem.statement,mode:"composition",...(attemptRevealed(entry.attempt)?{modelSolution:entry.problem.modelSolution}:{})}:{};
   return Object.fromEntries(Object.entries(o).filter(([k])=>!["partialJson","_partialJson","thinkingSignature"].includes(k)).map(([k,v])=>[k,k==="arguments"||k==="args"?args:visit(v)]));
  }
  return Object.fromEntries(Object.entries(o).filter(([k])=>!["modelSolution","checking","thinking","thinkingSignature","partialJson","_partialJson"].includes(k)).map(([k,v])=>[k,visit(v)]));
 }
 return visit(value) as T;
}
export function challengeClientChat(chat:ChatRecord){return {...chat,messages:challengeClientValue(chat.messages,chat.id)};}
export function currentChallenge(chatId:string){return stores.problemStore.byChat(chatId).at(-1)??null;}
export function challengeScratchLesson(chatId:string){const saved=currentChallenge(chatId);return saved?challengeLesson(saved.problem,saved.attempt):null;}
function seed(p:SavedProblem,a:ProblemAttempt):LhMessage[]{const timestamp=Date.now();return [
 {id:`pose_${a.id}`,role:"assistant",content:[{type:"toolCall",id:a.callId,name:"problem",arguments:{statement:p.statement,mode:"composition",modelSolution:p.modelSolution}}],timestamp,api:"openai-responses",provider:"openai",model:"saved-challenge",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"toolUse"},
 {id:`ack_${a.id}`,role:"toolResult",toolCallId:a.callId,toolName:"problem",content:[{type:"text",text:"Saved challenge resumed for a fresh attempt. Previous attempts and hints are not included."}],details:null,isError:false,timestamp:timestamp+1},
 ];}
const action=z.discriminatedUnion("action",[
 z.object({action:z.literal("retry"),id:problemKey,requestId:z.string().uuid(),minutes:z.number().int().min(5).max(240).default(45)}).strict(),
 z.object({action:z.literal("event"),id:problemKey,attemptId:z.string(),status:problemStatus.optional(),reveal:z.literal(true).optional(),defect:z.string().trim().max(2000).optional()}).strict(),
]);
export async function problemsResponse(request:Request){try{
 const q=new URL(request.url).searchParams,headers={"Cache-Control":"private, no-store"};
 if(request.method==="GET"){
  const entries=q.has("chatId")?stores.problemStore.byChat(q.get("chatId")!).map(x=>x.problem):stores.problemStore.list();
  if(q.has("id")){const p=stores.problemStore.read(problemKey.parse(q.get("id")));if(!p)throw new AtlasError("Problem not found.",404);if(q.has("attemptId")&&!p.attempts.some(a=>a.id===q.get("attemptId")))throw new AtlasError("Attempt not found.",404);return Response.json({problem:publicProblem(p,q.get("attemptId")??undefined)},{headers});}
  return Response.json({problems:entries.filter(p=>!q.has("conceptId")||[...p.conceptIds,...p.techniqueIds].includes(q.get("conceptId")!)).map(p=>publicProblem(p,q.has("chatId")?p.attempts.find(a=>a.chatId===q.get("chatId"))?.id:undefined))},{headers});
 }
 if(!request.headers.get("content-type")?.startsWith("application/json"))throw new AtlasError("Expected JSON.",415);
 const c=action.parse(JSON.parse((await readSourceBody(request,16384)).toString("utf8"))),p=stores.problemStore.read(c.id);if(!p)throw new AtlasError("Problem not found.",404);
 if(c.action==="retry"){
  const existing=p.attempts.find(a=>a.id===`pa_${c.requestId}`);if(existing){recoverChallengeHistory(stores.chatStore.getChat(existing.chatId)!);return Response.json({chatId:existing.chatId});}
  const chat=stores.chatStore.createChat(p.title,"practice",challengeSettings.parse({workflow:"challenge",minutes:c.minutes})),original=stores.chatStore.getChat(p.attempts[0]!.chatId);if(original?.settings)stores.chatStore.saveSettings(chat.id,original.settings);
  const saved=stores.problemStore.retry(p.id,chat.id,`retry_${randomUUID()}`,c.minutes,`pa_${c.requestId}`);stores.chatStore.saveMessages(chat.id,seed(saved.problem,saved.attempt));return Response.json({chatId:chat.id});
 }
 const a=p.attempts.find(a=>a.id===c.attemptId);if(!a)throw new AtlasError("Attempt not found.",404);
 if(isTurnRunning(a.chatId)||compactionInFlight(a.chatId))throw new AtlasError("Wait for the current response to finish.",409);
 if(c.status==="solved"&&a.events.some(e=>e.reveal&&(!e.status||e.status==="setAside")))throw new AtlasError("This attempt includes a solution reveal. Retry with a fresh attempt to record an independent solve.",409);
 const updated=stores.problemStore.append(p.id,a.id,{at:"",...c.status?{status:c.status}:{},...c.reveal?{reveal:true}:{},...c.defect!==undefined?{defect:c.defect}:{}});
 return Response.json({problem:publicProblem(updated,a.id)},{headers});
 }catch(e){return Response.json({error:e instanceof AtlasError?e.message:e instanceof z.ZodError?"Invalid problem request.":"Problems could not be loaded or saved."},{status:e instanceof AtlasError?e.status:400});}}

/** Recover a durable pose interrupted before native turn settlement. */
export function recoverChallengeHistory(chat:ChatRecord){
 if(!chat?.challenge||isTurnRunning(chat.id)||compactionInFlight(chat.id))return chat;reconcileChallengeCalls(chat.id,chat.messages);const saved=currentChallenge(chat.id);if(!saved)return chat;const call=saved.attempt.callId;
 if(chat.messages.some(m=>m.role==="toolResult"&&m.toolCallId===call&&!m.isError))return chat;
 const hasCall=chat.messages.some(m=>m.role==="assistant"&&m.content.some(c=>c.type==="toolCall"&&c.id===call));
 const restored=seed(saved.problem,saved.attempt);const messages=[...chat.messages,...(hasCall?restored.slice(1):restored)];stores.chatStore.saveMessages(chat.id,messages);return {...chat,messages};
}

/** Cache private records for a streaming turn; refresh only after durable tool boundaries. */
export function challengeProjection(chatId:string){
 let entries=stores.problemStore.byChat(chatId);
 return (event:import("./pi/ui-stream.ts").TurnWireEvent)=>{
  if(event.type==="tool_execution_end"||event.type==="agent_end")entries=stores.problemStore.byChat(chatId);
  return challengeClientValue(event,chatId,entries);
 };
}

/** The native wire uniquifies reused provider call IDs; persist the same reference in Problems. */
export function reconcileChallengeCalls(chatId:string,messages:readonly LhMessage[]){
 for(const {problem:p,attempt:a} of stores.problemStore.byChat(chatId)){
  const calls=messages.flatMap(m=>m.role==="assistant"?m.content.filter(c=>c.type==="toolCall"&&c.name==="problem"):[]);
  const call=calls.find(c=>c.type==="toolCall"&&typeof c.arguments.statement==="string"&&c.arguments.statement.trim()===p.statement&&typeof c.arguments.modelSolution==="string"&&c.arguments.modelSolution.trim()===p.modelSolution&&messages.some(m=>m.role==="toolResult"&&m.toolCallId===c.id&&!m.isError));
  if(call&&call.type==="toolCall")stores.problemStore.bindCall(p.id,a.id,call.id);
 }
}
