import {currentChallenge} from "./problems.ts";
import {challengeLesson,attemptStatus} from "../core/problems.ts";
import {createRetrievalService} from "./retrieval.ts";
import {z} from "zod";
import {AtlasError,type AtlasSnapshot} from "../core/atlas.ts";
import {lessonSummary,validateLessonSummary,initialLessonDecisions,planLessonSummary,type LessonReview,type LessonSource} from "../core/lesson-integration.ts";
import {initialLesson} from "../core/learning-session.ts";
import {getGraph,mergeFindings} from "../core/graph.ts";
import {sessionMarkdown,accumulateJobUsage,piUsageToStep} from "../core/index.ts";
import {lessonHash,lessonMint} from "../store/lesson-integration.ts";
import {SubmitProposalError} from "../agent/subagents/submit-agent.ts";
import {distillLesson} from "../agent/subagents/lesson-integration.ts";
import {piEngineForSpec,type PiEngine} from "../agent/models.ts";
import {resolveConversationSpec,resolveSlot} from "../core/settings-resolution.ts";
import {stores} from "./stores.ts";
import {isTurnRunning} from "./turn-liveness.ts";
import {emit} from "../core/events.ts";
import {readSourceBody} from "./mindmaps.ts";
import {syncContext} from "./atlas-sync.ts";
const id=z.string().regex(/^lr_[0-9a-f-]{36}$/),digest=z.string().regex(/^[0-9a-f]{64}$/);
const command=z.discriminatedUnion("action",[
 z.object({action:z.literal("generate"),id,chatId:z.string().max(100),subjectId:z.string().nullable(),expectedModel:z.string(),consent:z.literal(true)}).strict(),
 z.object({action:z.literal("edit"),id,digest,draft:lessonSummary,decisions:z.record(z.string(),z.string().max(100)),subjectId:z.string().nullable()}).strict(),
 z.object({action:z.literal("commit"),id,digest,approve:z.literal(true)}).strict(),
]);
/** Shares the upstream extraction auditor's FIFO gate; canonical mutations stay serialized. */
async function withLibraryGate<T>(critical:()=>T):Promise<T>{const g=globalThis as typeof globalThis&{__lhAuditLock?:{tail:Promise<void>}};const gate=g.__lhAuditLock??={tail:Promise.resolve()},previous=gate.tail;let release!:()=>void;gate.tail=new Promise<void>(resolve=>{release=resolve;});await previous;try{return critical();}finally{release();}}
function engineFor(chatId:string){const chat=stores.chatStore.getChat(chatId),settings=stores.settingsStore.readSettings(),spec=resolveConversationSpec(chat?.settings,resolveSlot(settings?.models?.strong));if(!spec)throw new AtlasError("Choose a model for this lesson.",503);return piEngineForSpec(spec,false);}
function source(chatId:string):LessonSource{
 const chat=stores.chatStore.getChat(chatId);if(!chat||chat.kind==="practice"&&!chat.challenge)throw new AtlasError("A learning session is required.",404);if(isTurnRunning(chatId))throw new AtlasError("Wait for the response to finish before reviewing.",409);
 if(!chat.messages.some(m=>m.role==="assistant"))throw new AtlasError("Work through some material before reviewing the lesson.");
 const challenge=chat.challenge?currentChallenge(chatId):null;
 if(chat.challenge&&(!challenge||attemptStatus(challenge.attempt)==="inProgress"))throw new AtlasError("Finish or set aside this challenge before proposing Atlas updates.",409);
 const transcript=(challenge?`[Saved challenge attempt: ${attemptStatus(challenge.attempt)}. The committed model solution and checking are preparation, not learner work. Only learner messages and submitted scratchwork show independent work. Retain requested hints, reveals, failed approaches and uncertainty. Reusable technique notes should include recognition cues, mechanism, conditions and failure cases; do not manufacture new concepts merely to populate Atlas.]\n\n`:"")+sessionMarkdown(chat.messages,{anchors:true});if(transcript.length>160000)throw new AtlasError("This session exceeds the 160,000-character review limit. Split it into focused sessions.",413);
 const lesson=(challenge?challengeLesson(challenge.problem,challenge.attempt):null)??stores.lessonStore.read(chatId)??{schemaVersion:1 as const,revision:1,status:"active" as const,plan:initialLesson(chat.title,stores.atlasStore.read().concepts.filter(c=>stores.atlasStore.sync.context(chatId)?.conceptIds.includes(c.id)))};
 const scratchwork:NonNullable<LessonSource["scratchwork"]>=[];
 const pads:{padId:string;topicId:string;derivationId?:string}[]=[...lesson.plan.nodes.map(n=>({padId:`topic-${n.id}`,topicId:n.id})),...lesson.plan.derivations.map(d=>({padId:d.id,topicId:d.nodeId,derivationId:d.id}))];
 for(const pad of pads){
  const attempts=stores.scratchpadStore.list(chatId,pad.padId),current=stores.scratchpadStore.read(chatId,pad.padId);
  const snapshots=[...attempts.map(a=>({draft:a.draft,token:a.id})),...current&&!attempts.some(a=>a.sceneHash===lessonHash(current))?[{draft:current,token:undefined}]:[]];
  for(const {draft,token} of snapshots){if(!draft.text.trim()&&!draft.scene.elements.some(e=>!e.isDeleted))continue;
   if(scratchwork.length>=200)throw new AtlasError("This lesson has more than 200 scratchwork snapshots. Split it into focused lessons before review.",413);
   scratchwork.push({...stores.scratchpadStore.retain(chatId,pad.padId,draft,token),topicId:pad.topicId,...pad.derivationId?{derivationId:pad.derivationId}:{}});
  }
 }
 return {chatId,lesson,transcript,...scratchwork.length?{scratchwork}:{},messageIds:chat.messages.flatMap(m=>"id" in m&&typeof m.id==="string"?[m.id]:[])};
}
function complete(r:LessonReview,atlas:AtlasSnapshot,graph:ReturnType<typeof getGraph>):LessonReview{
 try{const plan=planLessonSummary(r,atlas,graph,(key,prefix)=>lessonMint(r.id,key,prefix));
  for(const c of plan.concepts){const old=atlas.concepts.find(n=>n.id===c.id);if((old?.markdown?.length??0)+c.notes.length+300>16000)throw new AtlasError(`Shorten the notes for ${c.title} before integrating.`);}
  return {...r,plan,problems:[]};
 }catch(e){return {...r,plan:null,problems:[e instanceof AtlasError?e.message:"Resolve invalid proposal references before integration."]};}
}
export function createLessonIntegrationService(engine=engineFor,distill=distillLesson){
 const reviews=stores.atlasStore.lessonReviews;
 return {
 model:(chatId:string)=>{const e=engine(chatId);return `${e.model.provider}:${e.model.id}`;},
 async generate(raw:unknown,signal:AbortSignal){
  const c=command.parse(raw);if(c.action!=="generate")throw new AtlasError("Invalid lesson review request.");
  const previous=reviews.read(c.id);if(previous){if(previous.chatId!==c.chatId)throw new AtlasError("Review token belongs to another session.",409);return previous;}
  const captured=source(c.chatId),sourceHash=lessonHash(captured),atlas=stores.atlasStore.read(),graph=getGraph(stores.graphStore);
  const existing=reviews.list(c.chatId).find(r=>r.sourceHash===sourceHash&&(r.status==="committed"||r.status==="applying"||r.status==="prepared"&&r.model===c.expectedModel&&r.subjectId===c.subjectId&&r.baseAtlasRevision===atlas.layoutRevision&&r.baseGraphHash===lessonHash(graph)));
  if(existing)return existing;
  const running=reviews.list(c.chatId).find(r=>r.status==="running");if(running&&Date.now()-Date.parse(running.createdAt)<21*60*1000)throw new AtlasError("A lesson review is already running.",409);
  if(running)reviews.put({...running,status:"failed",error:"Review was interrupted. Retry explicitly; recorded usage may be incomplete."},running.digest);
  const e=engine(c.chatId),model=`${e.model.provider}:${e.model.id}`;if(model!==c.expectedModel)throw new AtlasError("The review model changed. Reopen the review.",409);
  const boundIds=captured.lesson.plan.nodes.flatMap(n=>n.conceptId?[n.conceptId]:[]),context=syncContext(atlas,captured.transcript,boundIds);
  let budget=60000;const picked=graph.nodes.map(n=>({n,score:(context.concepts.some(c=>c.propositionIds.includes(n.id))?10000:0)+(captured.transcript.toLowerCase().includes(n.name.toLowerCase())?100:0)})).sort((a,b)=>b.score-a.score).flatMap(({n})=>{const size=n.statement.length+n.aliases.join("").length;if(size>budget)return [];budget-=size;return [n];}).slice(0,80),known=new Set(picked.map(n=>n.id));
  let r:LessonReview={schemaVersion:1,id:c.id,chatId:c.chatId,revision:0,status:"running",source:captured,sourceHash,baseAtlasRevision:atlas.layoutRevision??0,baseGraphHash:lessonHash(graph),model,createdAt:new Date().toISOString(),draft:null,decisions:{},subjectId:c.subjectId,context:{concepts:context.concepts,propositions:picked},plan:null,problems:[],error:null,digest:""};
  r=reviews.put(r,null);
  try{
   const bounded=AbortSignal.any([signal,AbortSignal.timeout(20*60*1000)]),draft=lessonSummary.parse(await distill(e,{source:captured,atlas:context,graph:{nodes:picked,chains:graph.chains.filter(a=>known.has(a.conclusion)&&a.premises.every(p=>known.has(p)))}},bounded,u=>{r=reviews.put({...r,usage:accumulateJobUsage(r.usage,model,piUsageToStep(u))},r.digest);}));bounded.throwIfAborted();
   const problem=validateLessonSummary(draft,captured);if(problem)throw new AtlasError(problem);
   r=reviews.put(complete({...r,status:"prepared",revision:1,draft,decisions:initialLessonDecisions(draft,captured,atlas,graph.nodes)},atlas,graph),r.digest);
  }catch(e){r=reviews.put({...r,status:signal.aborted?"cancelled":"failed",error:e instanceof AtlasError||e instanceof SubmitProposalError?e.message:"Lesson review failed or timed out. Saved work is unchanged; recorded usage may be incomplete."},r.digest);}
  emit("atlas-changed",{});return r;
 },
 edit(raw:unknown){const c=command.parse(raw);if(c.action!=="edit")throw new AtlasError("Invalid edit.");const r=reviews.read(c.id);if(!r||r.status!=="prepared"||r.digest!==c.digest)throw new AtlasError("Review changed. Reload before editing.",409);
  const atlas=stores.atlasStore.read(),graph=getGraph(stores.graphStore);if(lessonHash(source(r.chatId))!==r.sourceHash||atlas.layoutRevision!==r.baseAtlasRevision||lessonHash(graph)!==r.baseGraphHash)throw new AtlasError("Session or knowledge changed. Generate a fresh proposal.",409);
  return reviews.put(complete({...r,revision:r.revision+1,draft:c.draft,decisions:c.decisions,subjectId:c.subjectId},atlas,graph),r.digest);
 },
 async commit(raw:unknown){const c=command.parse(raw);if(c.action!=="commit")throw new AtlasError("Explicit approval is required.");return withLibraryGate(()=>{
  let r=reviews.read(c.id);if(!r)throw new AtlasError("Review not found.",404);
  if(r.status==="committed"){if(r.approval?.digest!==c.digest)throw new AtlasError("Approval differs.",409);for(const saved of stores.problemStore.byChat(r.chatId))stores.problemStore.link(saved.problem.id,r.id);return r;}
  const pending=reviews.list().find(p=>p.status==="applying"&&p.id!==r!.id);if(pending)throw new AtlasError("Resume the interrupted lesson integration first.",409);
  if(r.status==="prepared"){
   if(r.digest!==c.digest||!r.plan)throw new AtlasError("Save a valid exact preview before approving.",409);
   if(lessonHash(source(r.chatId))!==r.sourceHash||stores.atlasStore.read().layoutRevision!==r.baseAtlasRevision||lessonHash(getGraph(stores.graphStore))!==r.baseGraphHash)throw new AtlasError("Session or knowledge changed. Generate a fresh proposal.",409);
   r=reviews.put({...r,status:"applying",approval:{digest:c.digest,at:new Date().toISOString()}},r.digest);
  }
  if(r.status!=="applying"||r.approval?.digest!==c.digest||!r.plan)throw new AtlasError("Exact lesson approval is required.",409);
  for(const note of r.plan.artifact.scratchwork??[]){const saved=stores.scratchpadStore.retained(note.id);if(!saved||saved.note.sceneHash!==note.sceneHash)throw new AtlasError("Scratchwork attachment is missing or changed. Restore it before resuming approval.",409);if(note.imageHash)stores.scratchpadStore.retainedImage(note.id);}
  const plan=r.plan,nodeIds=new Set(plan.nodes.map(n=>n.id)),chainIds=new Set(plan.chains.map(a=>a.id));
  // On recovery, remove only this operation's own append lines when checking its base.
  const base=getGraph({readNodes:()=>stores.graphStore.readNodes().filter(n=>!(nodeIds.has(n.id)&&n.integrationId===r!.id)),readChains:()=>stores.graphStore.readChains().filter(a=>!(chainIds.has(a.id)&&a.integrationId===r!.id))});
  if(lessonHash(base)!==r.baseGraphHash)throw new AtlasError("Canonical knowledge changed during an interrupted integration. Resolve the conflict before retrying.",409);
  const expectedNodes=Object.fromEntries(plan.nodes.map(n=>[n.key,n.id])),expectedChains=Object.fromEntries(plan.chains.map(a=>[[...a.premises].sort().join("+")+">"+a.conclusion,a.id]));
  mergeFindings(r.chatId,{propositions:plan.nodes.map(n=>({id:n.key,name:n.name,statement:n.statement,aliases:[],messageId:n.messageId})),chains:plan.chains.map(a=>({premises:a.premises,conclusion:a.conclusion}))},{links:plan.nodes.filter(n=>n.existing).map(n=>({id:n.key,linkTo:n.id}))},stores,{foldedAt:r.createdAt,reviewed:{operationId:r.id,nodes:expectedNodes,chains:expectedChains,createdAt:r.createdAt}});
  const canonical=getGraph(stores.graphStore);
  if(plan.nodes.some(n=>!canonical.nodes.some(p=>p.id===n.id&&[p.statement,...p.aliases].includes(n.statement)))||plan.chains.some(a=>!canonical.chains.some(b=>b.id===a.id&&b.conclusion===a.conclusion&&[...a.premises].sort().join(":")===[...b.premises].sort().join(":"))))throw new AtlasError("Canonical integration is incomplete; retry the same approval.",409);
  const result=reviews.finish(r.id,c.digest);
  for(const saved of stores.problemStore.byChat(r.chatId))stores.problemStore.link(saved.problem.id,r.id);emit("atlas-changed",{});emit("lesson-changed",{chatId:r.chatId});emit("record-changed",{chatId:r.chatId});return result;
 });},
 };
}
export async function lessonIntegrationResponse(request:Request):Promise<Response>{try{
 const service=createLessonIntegrationService();if(request.method==="GET"){const q=new URL(request.url).searchParams;if(q.has("config"))return Response.json({model:service.model(q.get("chatId")??"")});if(q.has("id"))return Response.json({review:stores.atlasStore.lessonReviews.read(id.parse(q.get("id")))});return Response.json({reviews:stores.atlasStore.lessonReviews.list(q.get("chatId")??undefined)});}
 if(!request.headers.get("content-type")?.startsWith("application/json"))throw new AtlasError("Expected JSON.",415);
 const c=command.parse(JSON.parse((await readSourceBody(request,1048576)).toString("utf8")));const review=c.action==="generate"?await service.generate(c,request.signal):c.action==="edit"?service.edit(c):await service.commit(c);if(c.action==="commit"){await createRetrievalService().autoEnrol();emit("review-changed",{});}return Response.json({review});
}catch(e){return Response.json({error:e instanceof AtlasError?e.message:e instanceof z.ZodError?`Check proposal fields: ${e.issues[0]?.path.join(".")||"request"} — ${e.issues[0]?.message}`:"Lesson integration is unavailable. Local work is retained; retry the exact approval if interrupted."},{status:e instanceof AtlasError?e.status:400});}}
