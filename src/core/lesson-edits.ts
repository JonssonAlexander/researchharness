import {z} from "zod";
import {lessonPlan,type LearningPlan} from "./learning-session.ts";

const topic=lessonPlan.shape.nodes.element,connection=lessonPlan.shape.connections.element,key=topic.shape.id;
const topicEdit=topic.omit({conceptId:true}).partial().extend({id:key}).strict()
 .refine(v=>Object.keys(v).length>1,"Include a topic field to change.");
/** Bounded edits against one exact revision; no topic deletion or identity reassignment. */
export const lessonEdit=z.object({
 expectedRevision:z.number().int().positive(),
 topics:z.array(topicEdit).min(1).max(40).optional(),
 newTopics:z.array(topic).min(1).max(40).optional(),
 addConnections:z.array(connection).min(1).max(80).optional(),
 removeConnections:z.array(connection).min(1).max(80).optional(),
 topicOrder:z.array(key).min(1).max(40).optional(),
 currentNodeId:key.nullable().optional(),activeDerivationId:key.nullable().optional(),
 objective:lessonPlan.shape.objective.optional(),
}).strict().refine(v=>Object.keys(v).length>1,"Include at least one change.");
export type LessonEdit=z.infer<typeof lessonEdit>;
export function applyLessonEdit(plan:LearningPlan,raw:LessonEdit):LearningPlan{
 const edit=lessonEdit.parse(raw),next=structuredClone(plan),known=new Set(plan.nodes.map(n=>n.id));
 const unique=(ids:string[])=>new Set(ids).size===ids.length;
 if(!unique((edit.topics??[]).map(n=>n.id))||!unique((edit.newTopics??[]).map(n=>n.id)))throw new Error("Edit each topic ID only once.");
 for(const change of edit.topics??[]){const node=next.nodes.find(n=>n.id===change.id);if(!node)throw new Error(`Unknown lesson topic: ${change.id}. Read the live map first.`);Object.assign(node,change);}
 for(const node of edit.newTopics??[]){if(known.has(node.id))throw new Error("New topics need unused IDs; edit existing topics through topics.");next.nodes.push(node);}
 const edgeKey=(e:{from:string;to:string})=>[e.from,e.to].sort().join(":");
 const removed=new Set((edit.removeConnections??[]).map(edgeKey));
 if((edit.addConnections??[]).some(e=>removed.has(edgeKey(e))))throw new Error("Do not add and remove the same connection together.");
 const ids=new Set(next.nodes.map(n=>n.id));
 for(const edge of [...edit.removeConnections??[],...edit.addConnections??[]])if(edge.from===edge.to||!ids.has(edge.from)||!ids.has(edge.to))throw new Error("Connections must name two existing topics.");
 const edges=new Map(next.connections.filter(e=>!removed.has(edgeKey(e))).map(e=>[edgeKey(e),e]));
 for(const edge of edit.addConnections??[])edges.set(edgeKey(edge),edge);
 next.connections=[...edges.values()];
 if(edit.topicOrder){if(edit.topicOrder.length!==next.nodes.length||!unique(edit.topicOrder)||edit.topicOrder.some(id=>!ids.has(id)))throw new Error("topicOrder must contain every topic ID exactly once, including tangents.");const byId=new Map(next.nodes.map(n=>[n.id,n]));next.nodes=edit.topicOrder.map(id=>byId.get(id)!);}
 for(const field of ["objective","currentNodeId","activeDerivationId"] as const)if(edit[field]!==undefined)Object.assign(next,{[field]:edit[field]});
 return lessonPlan.parse(next);
}
