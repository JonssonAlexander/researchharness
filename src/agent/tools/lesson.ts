import {Type} from "typebox";
import {z} from "zod";
import {focusLessonTopic,lessonPlan,type LearningSessionStore} from "../../core/learning-session.ts";
import {serverExecute} from "../tool-execute.ts";
import type {AgentTool} from "@earendil-works/pi-agent-core";
const input=Type.Object({expectedRevision:Type.Integer({minimum:1}),plan:Type.Unsafe(z.toJSONSchema(lessonPlan,{unrepresentable:"any"}))});
export function lessonTools(chatId:string,store:LearningSessionStore,notify:()=>void):Record<string,AgentTool<any>>{
 return {update_lesson:{name:"update_lesson",label:"Update lesson map",description:"Maintain the lesson objective, concept map, current topic, tangent branches and Start/Finish derivation targets. These are session planning, not mathematical claims. Read the current revision from your context or this tool's result. Preserve existing derivations and stable IDs. Keep currentNodeId aligned with the topic being taught. Record topic progress as upcoming, explored or revisit (coverage, never mastery). Clear activeDerivationId when moving away. Only the learner marks derivations or the lesson finished.",parameters:input,execute:serverExecute("update_lesson",input,async raw=>{
  const old=store.read(chatId);if(!old||old.status!=="active")throw new Error("The lesson is finished or unavailable. The learner must reopen it.");
  let plan=lessonPlan.parse(raw.plan);
  plan.nodes=plan.nodes.map(n=>({...n,progress:n.progress??old.plan.nodes.find(p=>p.id===n.id)?.progress}));
  if(plan.currentNodeId)plan=focusLessonTopic(plan,plan.currentNodeId);
  if(old.plan.derivations.some(d=>!plan.derivations.some(n=>n.id===d.id)))throw new Error("Retain existing derivations; return to the lesson without deleting them.");
  plan.derivations=plan.derivations.map(d=>({...d,status:old.plan.derivations.find(p=>p.id===d.id)?.status??"working"}));
  const saved=store.save(chatId,{expectedRevision:raw.expectedRevision,status:old.status,plan});notify();return {revision:saved.revision,currentNodeId:saved.plan.currentNodeId,activeDerivationId:saved.plan.activeDerivationId,derivations:saved.plan.derivations.map(d=>({id:d.id,status:d.status}))};
 })}};
}
