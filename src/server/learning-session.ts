import {AtlasError} from "../core/atlas.ts";
import {initialLesson,lessonChange,type LearningSession} from "../core/learning-session.ts";
import {resolveDerivationTarget} from "../core/concept-derivations.ts";
import {getGraph} from "../core/graph.ts";
import type {LearningContext} from "../core/atlas-sync.ts";
import {stores} from "./stores.ts";
import {emit} from "../core/events.ts";
import {isTurnRunning} from "./turn-liveness.ts";
import {readSourceBody} from "./mindmaps.ts";
export const getLesson=(id:string)=>stores.lessonStore.read(id);
export function startLesson(id:string,objective:string,context?:LearningContext):LearningSession{
 const concepts=context?stores.atlasStore.read().concepts.filter(c=>context.conceptIds.includes(c.id)):[];
 const plan=initialLesson(objective,concepts);
 if(context?.derivation){const graph=getGraph(stores.graphStore),picked=resolveDerivationTarget(concepts,graph.nodes,graph.chains,context.derivation),claim=picked.propositions.find(n=>n.id===context.derivation!.targetId)!;
  const premiseIds=new Set(picked.chains.flatMap(c=>c.premises)),start=picked.propositions.filter(n=>premiseIds.has(n.id)).map(n=>n.statement).join("\n\n");
  // A missing recorded argument is not permission to invent starting assumptions.
  if(start&&start.length<=4000&&claim.statement.length<=4000){plan.derivations=[{id:"derivation_0",nodeId:plan.nodes[0]!.id,title:claim.name.slice(0,160),start,finish:claim.statement,status:"working"}];plan.activeDerivationId="derivation_0";}
 }
 return stores.lessonStore.create(id,plan);
}
export async function lessonResponse(request:Request,id:string):Promise<Response>{
 try{
  const chat=stores.chatStore.getChat(id);if(!chat)throw new AtlasError("Session not found.",404);
  const lesson=getLesson(id);if(request.method==="GET")return Response.json({lesson},{headers:{"Cache-Control":"no-store"}});
  if(!lesson||chat.kind==="practice")throw new AtlasError("This session does not use the lesson workspace.",409);
  if(isTurnRunning(id))throw new AtlasError("Wait for the current response before editing the lesson.",409);
  if(!request.headers.get("content-type")?.startsWith("application/json"))throw new AtlasError("Expected JSON.",415);
  const change=lessonChange.parse(JSON.parse((await readSourceBody(request,262144)).toString("utf8")));
  const saved=stores.lessonStore.save(id,change);emit("lesson-changed",{chatId:id});return Response.json({lesson:saved});
 }catch(e){return Response.json({error:e instanceof AtlasError?e.message:"Lesson could not be loaded or saved."},{status:e instanceof AtlasError?e.status:400});}
}
