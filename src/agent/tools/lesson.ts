import type {AtlasLessonReader} from "../../core/atlas-lesson-context.ts";
import {Type} from "typebox";
import {z} from "zod";
import {focusLessonTopic,lessonPlan,lessonRoute,type LearningPlan,type LearningSession,type LearningSessionStore} from "../../core/learning-session.ts";
import {lessonEdit,applyLessonEdit} from "../../core/lesson-edits.ts";
import {serverExecute} from "../tool-execute.ts";
import type {AgentTool} from "@earendil-works/pi-agent-core";
const input=Type.Object({expectedRevision:Type.Integer({minimum:1}),plan:Type.Unsafe<LearningPlan>(z.toJSONSchema(lessonPlan,{unrepresentable:"any"}))});
const topicKey=Type.String({minLength:1,maxLength:60});
const readInput=Type.Object({topicId:Type.Optional(topicKey),topicIds:Type.Optional(Type.Array(topicKey,{minItems:1,maxItems:8,uniqueItems:true})),scope:Type.Optional(Type.Union([Type.Literal("current"),Type.Literal("map")]))},{additionalProperties:false});
const editInput=Type.Unsafe<z.infer<typeof lessonEdit>>(z.toJSONSchema(lessonEdit,{unrepresentable:"any"}));
/** Compact fresh topology; request one topic to read its complete notes/targets. */
function summary(lesson:LearningSession){
 const {plan}=lesson;
 return {revision:lesson.revision,status:lesson.status,objective:plan.objective,currentNodeId:plan.currentNodeId,activeDerivationId:plan.activeDerivationId,
  route:lessonRoute(plan),topics:plan.nodes.map(n=>({id:n.id,title:n.title,conceptId:n.conceptId,tangent:n.tangent,progress:n.progress??"upcoming",kind:n.kind??(n.tangent?"tangent":"topic"),parentId:n.parentId??null,question:n.question,section:n.section,hasNotes:!!n.notes})),
  connections:plan.connections,derivations:plan.derivations.map(({id,nodeId,title,status})=>({id,nodeId,title,status}))};
}
export function lessonTools(chatId:string,store:LearningSessionStore,notify:()=>void,atlas?:AtlasLessonReader):Record<string,AgentTool<any>>{
 function current(){const old=store.read(chatId);if(!old)throw new Error("The lesson is unavailable.");return old;}
 function save(old:LearningSession,plan:LearningPlan,expectedRevision:number){
  if(old.status!=="active")throw new Error("The lesson is finished. The learner must reopen it.");
  if(atlas){const ids=new Set(atlas.read().atlas.concepts.map(c=>c.id));if(plan.nodes.some(n=>n.conceptId&&!ids.has(n.conceptId)))throw new Error("Use existing Atlas concept IDs; new lesson topics must have conceptId=null.");}
  plan.nodes=plan.nodes.map(n=>{const previous=old.plan.nodes.find(p=>p.id===n.id);return {...n,notes:n.notes??previous?.notes,progress:n.progress??previous?.progress,kind:n.kind??previous?.kind,parentId:n.parentId===undefined?previous?.parentId:n.parentId,formula:n.formula??previous?.formula,question:n.question??previous?.question,section:n.section??previous?.section};});
  if(plan.currentNodeId)plan=focusLessonTopic(plan,plan.currentNodeId);else plan={...plan,activeDerivationId:null};
  if(old.plan.derivations.some(d=>!plan.derivations.some(n=>n.id===d.id)))throw new Error("Retain existing derivations; return to the lesson without deleting them.");
  plan.derivations=plan.derivations.map(d=>({...d,status:old.plan.derivations.find(p=>p.id===d.id)?.status??"working"}));
  const saved=store.save(chatId,{expectedRevision,status:old.status,plan});notify();return saved;
 }
 return {
  read_lesson:{name:"read_lesson",label:"Read live lesson map",description:"Read the current saved lesson revision, ordered main route, topic IDs/coverage, ordinary associations and derivation summaries. Use scope=current for current notes/targets and nearby topics. Use topicIds for up to eight complete topics together, or topicId for one. Omit both for compact map topology. This is a local read, not a separate model call. Use before editing when state may be stale, including after compaction or a revision conflict. Reading never changes focus or progress. Route order is teaching order, not mathematical implication or mastery.",parameters:readInput,execute:serverExecute("read_lesson",readInput,async raw=>{
   const lesson=current(),overview=summary(lesson);
   if(raw.topicId&&raw.topicIds)throw new Error("Use topicId or topicIds, not both.");
   const requested=raw.topicIds??(raw.topicId?[raw.topicId]:raw.scope==="current"&&lesson.plan.currentNodeId?[lesson.plan.currentNodeId]:null);
   if(!requested)return overview;
   if(requested.length>8||new Set(requested).size!==requested.length)throw new Error("Read up to eight unique topics together.");
   const selected=requested.map((id:string)=>{
    const topic=lesson.plan.nodes.find(n=>n.id===id);if(!topic)throw new Error("Unknown lesson topic. Read scope=map to get current IDs.");
    const neighbours=new Set(lesson.plan.connections.flatMap(e=>e.from===topic.id?[e.to]:e.to===topic.id?[e.from]:[]));
    return {topic,neighbours:overview.topics.filter(n=>neighbours.has(n.id)),parent:overview.topics.find(n=>n.id===topic.parentId)??null,children:overview.topics.filter(n=>n.parentId===topic.id),derivations:lesson.plan.derivations.filter(d=>d.nodeId===topic.id)};
   });
   const base={revision:lesson.revision,status:lesson.status,currentNodeId:lesson.plan.currentNodeId,activeDerivationId:lesson.plan.activeDerivationId,route:overview.route};
   return raw.topicIds?{...base,selected}:{...base,...selected[0]};
  })},
  edit_lesson:{name:"edit_lesson",label:"Edit lesson topic",description:"Make small revision-checked changes to the live lesson: edit topic title/question/section/formula/notes/coverage/kind/parentId/tangent flag, add new topics, add/remove ordinary associations, change focus or reorder topics. Omitted fields and unrelated notes/derivations remain intact. Batch related changes into one call. Read the needed topics together first before revising their notes; include the learner's useful intuition and properly delimited equations. topicOrder must list every ID exactly once; non-tangent topics form the teaching route. Use kind=detail plus parentId for supporting equations and kind=tangent for digressions; formula is a complete bare LaTeX expression. Set tangent=true for non-route nodes. New topics use conceptId=null unless an actual Atlas identity was read. Moving focus clears an unrelated active derivation; finishing remains learner-owned. Use update_lesson only for initial planning, major restructuring or derivation targets. On a stale revision read_lesson and rebase, never overwrite unseen changes.",parameters:editInput,execute:serverExecute("edit_lesson",editInput,async raw=>{
   const old=current();if(old.revision!==raw.expectedRevision)throw new Error("Lesson changed. Use read_lesson before retrying the edit.");
   const saved=save(old,applyLessonEdit(old.plan,raw),raw.expectedRevision);
   const ids=new Set([...(raw.topics??[]).map(n=>n.id),...(raw.newTopics??[]).map(n=>n.id)]);
   return {revision:saved.revision,status:saved.status,currentNodeId:saved.plan.currentNodeId,activeDerivationId:saved.plan.activeDerivationId,changedTopicIds:[...ids],addedConnections:raw.addConnections?.length??0,removedConnections:raw.removeConnections?.length??0};
  })},
  update_lesson:{name:"update_lesson",label:"Update lesson map",description:"Create the initial lesson plan or deliberately restructure its objective, topics, associations and Start/Finish derivation targets. Prefer edit_lesson for local note/focus/connection changes, and read_lesson for fresh state. Preserve stable IDs and existing derivations. Topic array order excluding tangents is the teaching route, not proof order. Preserve useful notes and coverage; explored means discussed, not mastered. Keep currentNodeId aligned with teaching. Only the learner marks derivations or the lesson finished.",parameters:input,execute:serverExecute("update_lesson",input,async raw=>{const saved=save(current(),lessonPlan.parse(raw.plan),raw.expectedRevision);return {revision:saved.revision,currentNodeId:saved.plan.currentNodeId,activeDerivationId:saved.plan.activeDerivationId,topics:saved.plan.nodes.length,derivations:saved.plan.derivations.map(({id,status})=>({id,status}))};})}
 };
}
