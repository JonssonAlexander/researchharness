import type {ScratchNote} from "./scratchpad.ts";
import {drawingConnections,drawingLink,type DrawingLink} from "./atlas-drawing.ts";
import {z} from "zod";
import {AtlasError,type AtlasSnapshot} from "./atlas.ts";
import {lessonPlan,type LearningSession} from "./learning-session.ts";
import type {GraphNode,GraphChain,JobUsage} from "./contracts.ts";
const key=z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),text=z.string().trim().min(1).max(6000),nodeId=z.string().regex(/^n_[\w-]+$/);
const origin=z.enum(["session","ai-explanation","owner-edit"]),evidence=z.array(z.string().min(1).max(160)).max(10);
export const lessonSummary=z.object({
 overview:text,map:lessonPlan,
 concepts:z.array(z.object({key,title:z.string().trim().min(1).max(160),notes:text,existingId:z.string().regex(/^ac_[0-9a-f-]{36}$/).nullable(),rationale:text,topicIds:z.array(key).max(40),include:z.boolean()}).strict()).max(20),
 propositions:z.array(z.object({key,name:z.string().trim().min(1).max(160),statement:text,existingId:nodeId.nullable(),identityRationale:z.string().max(2000),origin,evidence,uncertainty:z.string().max(2000)}).strict()).max(80),
 arguments:z.array(z.object({key,premises:z.array(key).min(1).max(20),conclusion:key,rationale:text,origin,evidence,status:z.enum(["inference","gap"]),uncertainty:z.string().max(2000)}).strict()).max(80),
 derivations:z.array(z.object({key,title:z.string().trim().min(1).max(160),topicId:key,start:text,finish:text,root:key,propositions:z.array(key).min(1).max(80),arguments:z.array(key).max(80),concepts:z.array(key).max(20),include:z.boolean(),gaps:z.array(text).max(20),assistance:z.string().max(3000)}).strict()).max(20),
}).strict();
export type LessonSummary=z.infer<typeof lessonSummary>;
export interface LessonSource {chatId:string;lesson:LearningSession;transcript:string;messageIds:string[];scratchwork?:(ScratchNote & {topicId:string;derivationId?:string})[];}
export type LessonDecisions=Record<string,string>;
export interface LessonCommitPlan {
 nodes:{key:string;id:string;existing:boolean;name:string;statement:string;messageId:string}[];
 chains:{key:string;id:string;existing:boolean;premises:string[];conclusion:string}[];
 concepts:{key:string;id:string;expectedRevision:number;title:string;aliases:string[];subjectIds:string[];preferredSubjectId:string|null;propositionIds:string[];notes:string;x:number;y:number}[];
 drawingLinks:DrawingLink[];
 subjectId:string|null;
 artifact:LessonArtifact;
}
export interface LessonScratchwork extends ScratchNote {topicIds:string[];conceptIds:string[];propositionIds:string[];derivationKeys:string[];}
export interface LessonArtifact {scratchwork?:LessonScratchwork[];id:string;chatId:string;title:string;conceptIds:string[];newPropositionIds:string[];map:LessonSummary["map"];derivations:{key:string;title:string;rootId:string;conceptIds:string[];propositionIds:string[];argumentIds:string[];gaps:string[];assistance:string;reviewFlags?:string[]}[];}
export interface LessonReview {
 schemaVersion:1;id:string;chatId:string;revision:number;status:"running"|"prepared"|"failed"|"cancelled"|"applying"|"committed";
 sourceHash:string;source:LessonSource;baseAtlasRevision:number;baseGraphHash:string;
 model:string;createdAt:string;draft:LessonSummary|null;decisions:LessonDecisions;subjectId:string|null;
 context:{concepts:AtlasSnapshot["concepts"];propositions:GraphNode[]};
 plan:LessonCommitPlan|null;problems:string[];error:string|null;usage?:JobUsage;digest:string;
 approval?:{digest:string;at:string};committedAt?:string;
}
export interface LessonReviewStore {
 read:(id:string)=>LessonReview|null;list:(chatId?:string)=>LessonReview[];
 put:(record:LessonReview,expectedDigest:string|null)=>LessonReview;
 finish:(id:string,approvalDigest:string)=>LessonReview;
}
export function validateLessonSummary(d:LessonSummary,source:LessonSource):string|null{
 for(const items of [d.concepts,d.propositions,d.arguments,d.derivations])if(new Set(items.map(n=>n.key)).size!==items.length)return "Use unique keys within each proposed collection.";
 if(new Set(d.propositions.map(p=>p.statement)).size!==d.propositions.length)return "Shared identical statements must use one proposition key across derivations.";
 const topics=new Set(d.map.nodes.map(n=>n.id)),props=new Set(d.propositions.map(n=>n.key)),args=new Map(d.arguments.map(n=>[n.key,n])),concepts=new Set(d.concepts.map(n=>n.key)),messages=new Set(source.messageIds);
 if(d.concepts.some(n=>n.topicIds.some(id=>!topics.has(id)))||d.arguments.some(a=>!props.has(a.conclusion)||a.premises.includes(a.conclusion)||new Set(a.premises).size!==a.premises.length||a.premises.some(p=>!props.has(p))))return "References must preserve distinct, existing topics and joint premises.";
 for(const n of [...d.propositions,...d.arguments])if(n.evidence.some(id=>!messages.has(id))||n.origin==="session"&&!n.evidence.length)return "Session readings need actual source message IDs; added explanations must be labelled AI.";
 for(const p of d.derivations){const ids=new Set(p.propositions);if(!topics.has(p.topicId)||!ids.has(p.root)||p.propositions.some(k=>!props.has(k))||p.concepts.some(k=>!concepts.has(k))||p.arguments.some(k=>!args.has(k)||![args.get(k)!.conclusion,...args.get(k)!.premises].every(id=>ids.has(id))))return "Each derivation must include its root and every joint premise of its arguments.";}
 return null;
}
export function initialLessonDecisions(d:LessonSummary,source:LessonSource,atlas:AtlasSnapshot,nodes:GraphNode[]):LessonDecisions{
 const result:LessonDecisions={};
 for(const p of d.propositions){const matches=nodes.filter(n=>[n.statement,...n.aliases].includes(p.statement));result[`p:${p.key}`]=matches.length===1?matches[0]!.id:p.existingId?"":"new";}
 const bound=new Set(source.lesson.plan.nodes.flatMap(n=>n.conceptId?[n.conceptId]:[]));
 for(const c of d.concepts)result[`c:${c.key}`]=c.existingId&&bound.has(c.existingId)&&atlas.concepts.some(n=>n.id===c.existingId)?c.existingId:c.existingId?"":"new";
 return result;
}
export function planLessonSummary(review:LessonReview,atlas:AtlasSnapshot,graph:{nodes:GraphNode[];chains:GraphChain[]},mint:(key:string,prefix:string)=>string):LessonCommitPlan{
 const d=review.draft!;const invalid=validateLessonSummary(d,review.source);if(invalid)throw new AtlasError(invalid);
 const derivations=d.derivations.filter(p=>p.include),used=new Set(derivations.flatMap(p=>p.propositions)),usedArgs=new Set(derivations.flatMap(p=>p.arguments));
 const claimed=new Set<string>(),nodes=d.propositions.filter(p=>used.has(p.key)).map(p=>{
  const decision=review.decisions[`p:${p.key}`];if(!decision)throw new AtlasError(`Resolve the proposed identity for ${p.name}.`);
  const old=graph.nodes.find(n=>n.id===decision);
  if(decision!=="new"&&!old)throw new AtlasError("A selected canonical claim no longer exists.",409);
  if(decision==="new"&&graph.nodes.some(n=>[n.statement,...n.aliases].includes(p.statement)))throw new AtlasError(`Reuse the existing exact claim for ${p.name}.`);
  const id=old?.id??mint(`claim:${p.key}`,"n");if(claimed.has(id))throw new AtlasError("Combine duplicate proposed claim identities before integration.");claimed.add(id);
  return {key:p.key,id,existing:!!old,name:old?.name??p.name,statement:p.statement,messageId:p.evidence[0]??""};
 });
 const mapping=new Map(nodes.map(n=>[n.key,n.id]));
 const chains=d.arguments.filter(a=>usedArgs.has(a.key)&&a.status==="inference").map(a=>{
  const premises=a.premises.map(k=>mapping.get(k)!),conclusion=mapping.get(a.conclusion)!;
  if(!conclusion||premises.some(p=>!p)||new Set(premises).size!==premises.length||premises.includes(conclusion))throw new AtlasError("An argument lost a required premise.");
  const old=graph.chains.find(c=>c.conclusion===conclusion&&[...c.premises].sort().join(":")===[...premises].sort().join(":"));
  return {key:a.key,id:old?.id??mint(`argument:${a.key}`,"arg"),existing:!!old,premises,conclusion};
 });
 if(new Set(chains.map(c=>c.id)).size!==chains.length)throw new AtlasError("Combine duplicate proposed arguments before integration.");
 const included=d.concepts.filter(c=>c.include),home=atlas.subjects.find(s=>s.id===review.subjectId),conceptIds=new Set<string>();
 const concepts=included.map((c,i)=>{
  const choice=review.decisions[`c:${c.key}`];if(!choice)throw new AtlasError(`Resolve the proposed identity for ${c.title}.`);
  const old=atlas.concepts.find(n=>n.id===choice);if(choice!=="new"&&!old)throw new AtlasError("A selected concept no longer exists.",409);
  if(choice==="new"&&!home)throw new AtlasError("Choose a subject for new Atlas concepts.");
  if(choice==="new"&&atlas.concepts.some(n=>[n.title,...n.aliases].some(t=>t.trim().toLowerCase()===c.title.trim().toLowerCase())))throw new AtlasError(`Reuse the existing concept for ${c.title}.`);
  const id=old?.id??mint(`concept:${c.key}`,"ac");if(conceptIds.has(id))throw new AtlasError("Combine duplicate concept identities before integration.");conceptIds.add(id);
  const roots=derivations.filter(p=>p.concepts.includes(c.key)).map(p=>mapping.get(p.root)!);
  return {key:c.key,id,expectedRevision:old?.revision??0,title:old?.title??c.title,aliases:old?.aliases??[],subjectIds:old?.subjectIds??[home!.id],preferredSubjectId:old?old.preferredSubjectId:home!.id,propositionIds:[...new Set([...(old?.propositionIds??[]),...roots])],notes:c.notes,x:old?.x??(home?.x??0)+i*130,y:old?.y??home?.y??0};
 });
 const conceptMap=new Map(concepts.map(c=>[c.key,c.id]));
 const artifact:LessonArtifact={id:review.id,chatId:review.chatId,title:d.map.objective.slice(0,120),conceptIds:concepts.map(c=>c.id),newPropositionIds:nodes.filter(n=>!n.existing).map(n=>n.id),map:d.map,derivations:derivations.map(p=>({key:p.key,title:p.title,rootId:mapping.get(p.root)!,conceptIds:p.concepts.flatMap(k=>conceptMap.has(k)?[conceptMap.get(k)!]:[]),propositionIds:p.propositions.map(k=>mapping.get(k)!),argumentIds:p.arguments.flatMap(k=>chains.filter(a=>a.key===k).map(a=>a.id)),gaps:[...p.gaps,...p.arguments.flatMap(k=>d.arguments.filter(a=>a.key===k&&a.status==="gap").map(a=>a.rationale))],assistance:p.assistance,reviewFlags:[...new Set([...d.propositions.filter(n=>p.propositions.includes(n.key)),...d.arguments.filter(n=>p.arguments.includes(n.key))].flatMap(n=>[...(n.origin==="ai-explanation"?["Contains AI-added explanation"]:[]),...(n.uncertainty?[n.uncertainty]:[])]))]}))};
 for(const c of concepts)if(c.propositionIds.length>200)throw new AtlasError(`Too many linked claims for ${c.title}.`);
 const topicConcept=new Map(concepts.flatMap(c=>d.concepts.find(n=>n.key===c.key)!.topicIds.map(topic=>[topic,c.id] as const)));
 artifact.map={...d.map,nodes:d.map.nodes.map(n=>({...n,conceptId:topicConcept.get(n.id)??n.conceptId}))};
 if(review.source.scratchwork?.length)artifact.scratchwork=review.source.scratchwork.map(note=>{
  const topicIds=[note.topicId],proofs=derivations.filter(p=>p.topicId===note.topicId),evidence=d.propositions.filter(p=>note.attemptId&&p.evidence.includes(note.attemptId)&&mapping.has(p.key));
  return {...note,topicIds,conceptIds:[...new Set([...concepts.filter(c=>d.concepts.find(n=>n.key===c.key)!.topicIds.includes(note.topicId)).map(c=>c.id),...[...artifact.map.nodes,...review.source.lesson.plan.nodes].filter(n=>n.id===note.topicId&&n.conceptId&&(atlas.concepts.some(c=>c.id===n.conceptId)||concepts.some(c=>c.id===n.conceptId))).flatMap(n=>n.conceptId?[n.conceptId]:[])])],propositionIds:[...new Set([...proofs.map(p=>mapping.get(p.root)!),...evidence.map(p=>mapping.get(p.key)!)])],derivationKeys:proofs.map(p=>p.key)};
 });
 const pairs=new Set([...drawingConnections(atlas),...atlas.relations].map(e=>[e.sourceId,e.targetId].sort().join(":")));
 const drawingLinks=d.map.connections.flatMap(e=>{const sourceId=topicConcept.get(e.from),targetId=topicConcept.get(e.to);if(!sourceId||!targetId||sourceId===targetId)return [];const pair=[sourceId,targetId].sort().join(":");if(pairs.has(pair))return [];pairs.add(pair);return [drawingLink.parse({id:mint(`line:${pair}`,"dl"),sourceId,targetId,label:"Lesson association",direction:"unclear",notes:`Session: ${review.chatId}\nReviewed lesson map: ${review.id}\nOrdinary association, not a mathematical implication.`,replaces:null,removed:false})];});
 return {nodes,chains,concepts,drawingLinks,subjectId:review.subjectId,artifact};
}
