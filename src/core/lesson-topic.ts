import type {LearningSession} from "./learning-session.ts";
import type {LhMessage} from "./native-messages.ts";
import {failedOutputCallIds,userFacingTextOf} from "./native-messages.ts";
/** Read only existing teaching; inspection never infers a definition or changes lesson progress. */
export function lessonTopicDetail(lesson:LearningSession,messages:readonly LhMessage[],id:string,atlasNotes=""){
 const node=lesson.plan.nodes.find(n=>n.id===id);if(!node)return null;
 if(node.notes?.trim())return {text:node.notes,source:"Lesson note"};
 const successful=new Set(messages.flatMap(m=>m.role==="toolResult"&&m.toolName==="update_lesson"&&!m.isError?[m.toolCallId]:[])),failed=failedOutputCallIds(messages);
 const excerpts:string[]=[];let current:string|null=null;
 for(const m of messages){if(m.role!=="assistant"||["error","aborted"].includes(m.stopReason))continue;
  for(const block of m.content){
   if(block.type==="toolCall"&&block.name==="update_lesson"&&successful.has(block.id)){
    const plan=block.arguments.plan as {currentNodeId?:unknown}|undefined;if(typeof plan?.currentNodeId==="string")current=plan.currentNodeId;
   }
   if(current===id)excerpts.push(...userFacingTextOf([block],failed));
  }
 }
 // Keep complete Markdown paragraphs, including whole display equations. No mid-formula truncation.
 const parts=excerpts.slice(-2).flatMap(t=>t.match(/(?:\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|[^\n]|\n(?![ \t]*\n))+/g)??[]).filter(t=>t.trim()&&!/^#{1,6}\s/.test(t));
 let budget=2200;const selected=parts.flatMap(p=>{if(p.length>budget)return [];budget-=p.length;return [p];}).slice(0,6);
 if(selected.length)return {text:selected.join("\n\n"),source:"From the lesson conversation"};
 const derivation=lesson.plan.derivations.find(d=>d.nodeId===id);
 if(derivation)return {text:`**Start**\n\n${derivation.start}\n\n**Target**\n\n${derivation.finish}`,source:"Saved derivation target"};
 if(atlasNotes.trim()&&atlasNotes.length<=2200)return {text:atlasNotes,source:"Linked Atlas notes"};
 return {text:"",source:"No explanation saved yet"};
}
