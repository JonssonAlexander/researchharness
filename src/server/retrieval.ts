import {z} from "zod";
import {createHash} from "node:crypto";
import {AtlasError} from "../core/atlas.ts";
import {reviewCommand,reviewSource,reviewDeck,studyDay,publicReviewActivity,REVIEW_LIMIT,reviewActivityProposal,nextReviewChange,type ReviewItem,type ReviewActivity,type ReviewStore} from "../core/retrieval.ts";
import {accumulateJobUsage,piUsageToStep} from "../core/index.ts";
import {resolveSlot} from "../core/settings-resolution.ts";
import {piEngineForSpec,type PiEngine} from "../agent/models.ts";
import {makeReviewQuestion} from "../agent/subagents/retrieval.ts";
import {reviewScheduler,schedulerConfig,cardInput,prepareReplay,serial} from "./retrieval-scheduler.ts";
import {stores} from "./stores.ts";
import {readSourceBody} from "./mindmaps.ts";
import {emit} from "../core/events.ts";
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function engineFor(){const spec=resolveSlot(stores.settingsStore.readSettings()?.models?.strong);if(!spec)throw new AtlasError('Choose a teaching model in Settings for connected questions. Individual cards work locally.',503);return piEngineForSpec(spec,false);}
export function createRetrievalService(store:ReviewStore=stores.atlasStore.retrieval,atlas=()=>stores.atlasStore.read(),clock=()=>new Date(),engine:()=>PiEngine=engineFor,generate=makeReviewQuestion){
 // Local, idempotent catch-up also repairs an interrupted post-integration enrolment.
 async function autoEnrol(){
  const view=atlas(),known=new Set(store.items().map(i=>i.conceptId)),lessons=new Set(view.lessonMaps?.flatMap(m=>m.conceptIds)??[]);
  const candidates=view.concepts.filter(c=>!known.has(c.id)&&(lessons.has(c.id)||/<!-- atlas-(?:source|update):/.test(c.markdown??'')));
  for(const concept of candidates){
   // Keep the latest approved reading intact: never cut a formula to meet a limit.
   const back=(concept.markdown??'').split(/<!-- (?:atlas-(?:source|update)|lesson-review):[^>]*-->/).at(-1)!.replace(/^AI session synthesis[^\n]*\n/gm,'').replace(/^Updated source reading[^\n]*\n/gm,'').replace(/^Session: [^\n]*$/gm,'').trim();
   if(back.replace(/[#*\s]/g,'').length<30||back.length>12000)continue;
   if(store.items().some(i=>i.conceptId===concept.id))continue;
   try{await command({action:'enrol',conceptId:concept.id,expectedRevision:0,front:`Explain ${concept.title}: the key idea and essential conditions.`,back,paused:false},new AbortController().signal);}catch(error){if(!store.items().some(i=>i.conceptId===concept.id))throw error;}
  }
 }
 const sourceHashes=()=>new Map(atlas().concepts.map(c=>[c.id,hash(reviewSource(c))]));
 async function snapshot(){
  await autoEnrol();
  const now=clock(),settings=store.settings(),items=store.items(),day=studyDay(now,settings.timeZone),activities=store.activities(day),today=activities.filter(a=>a.status!=='failed'),active=store.active(),last=store.last(),view=atlas(),hashes=new Map(view.concepts.map(c=>[c.id,hash(reviewSource(c))]));
  const used=today.reduce((n,a)=>n+Math.min(900,Math.max(a.items.length>1?180:45,(Date.parse(a.revealedAt??a.ratedAt??a.createdAt)-Date.parse(a.readyAt??a.createdAt))/1000)),0),valid=items.filter(i=>hashes.get(i.conceptId)===i.sourceHash);
  const statuses=await Promise.all(items.map(async item=>{const s=await reviewScheduler(item.config),card=cardInput(item.card),probability=card.reps>0?s.model.forgettingCurve(card,Math.max(0,s.chrono.difference(card.lastReviewAt??new Date(item.createdAt),now))):null;return {item,retrievability:probability,stale:hashes.get(item.conceptId)!==item.sourceHash};}));
  let model:string|null=null;try{const e=engine();model=`${e.model.provider}:${e.model.id}`;}catch{}
  const deck=reviewDeck(view,valid,now,Math.max(0,settings.minutes*60-used)),count=deck.groups.length;deck.groups=deck.groups.slice(0,Math.max(0,Math.min(REVIEW_LIMIT,settings.dailyGoal)-today.length));deck.deferred+=count-deck.groups.length;
  const intervals:Record<string,string[]>={};
  if(active?.status==='revealed'){
   const scheduler=await reviewScheduler(active.config),at=new Date(active.revealedAt!);
   for(const item of active.items)intervals[item.id]=[1,2,3,4].map(grade=>scheduler.review({card:cardInput(item.card),grade:grade as 1|2|3|4,now:at}).card.dueAt.toISOString());
  }
  return {intervals,now:now.toISOString(),refreshAt:nextReviewChange(now,settings.timeZone,valid),day,settings,model,items:statuses,deck,used:today.length,remaining:Math.max(0,Math.min(REVIEW_LIMIT,settings.dailyGoal)-today.length),active:active?publicReviewActivity(active):null,last:last?publicReviewActivity(last):null};
 }
 async function command(raw:unknown,signal:AbortSignal){const c=reviewCommand.parse(raw),now=clock(),settings=store.settings(),scheduler=await reviewScheduler(undefined,settings.retention);
  if(c.action==='settings')return store.saveSettings(c.settings);
  if(c.action==='enrol'){
   const concept=atlas().concepts.find(n=>n.id===c.conceptId);if(!concept)throw new AtlasError('Concept no longer exists.',404);
   const id=`ri_${c.conceptId.slice(3)}`,old=store.items().find(i=>i.id===id),changed=!old||old.front!==c.front||old.back!==c.back,config=changed?schedulerConfig(scheduler):old.config;
   const item:ReviewItem={id,conceptId:concept.id,title:concept.title,front:c.front,back:c.back,sourceHash:hash(reviewSource(concept)),revision:(old?.revision??0)+1,targetVersion:(old?.targetVersion??0)+(changed?1:0),paused:c.paused,createdAt:changed?now.toISOString():old.createdAt,card:changed?serial(scheduler.newCard({cardId:id,now})):old.card,config};
   store.saveItem(item,c.expectedRevision);return item;
  }
  if(c.action==='start'){
   const old=store.activity(c.id);if(old){if(old.items.map(i=>i.id).join()!==c.itemIds.join())throw new AtlasError('Review token was already used for other targets.',409);return publicReviewActivity(old);}
   if(new Set(c.itemIds).size!==c.itemIds.length)throw new AtlasError('Choose distinct review targets.');
   const allItems=store.items(),hashes=sourceHashes(),items=c.itemIds.map(id=>allItems.find(i=>i.id===id));if(items.some(i=>!i||i.paused||hashes.get(i.conceptId)!==i.sourceHash||Date.parse(i.card.dueAt)>now.getTime()))throw new AtlasError('Targets changed or are not due. Reload.',409);
   const picked=items as ReviewItem[];
   if(picked.length===2)throw new AtlasError('Choose one card or a connected group of 3–4 targets.');
   if(picked.length>1&&!reviewDeck(atlas(),picked,now,3600).groups.some(g=>g.length===picked.length&&g.every(id=>c.itemIds.includes(id))))throw new AtlasError('Choose concepts connected by actual Atlas links.');
   const e=picked.length>1?engine():null,model=e?`${e.model.provider}:${e.model.id}`:undefined;
   if(e&&(!c.consent||c.expectedModel!==model))throw new AtlasError('Confirm the current model before preparing a connected question.',409);
   let activity:ReviewActivity={id:c.id,revision:1,day:studyDay(now,settings.timeZone),timeZone:settings.timeZone,createdAt:now.toISOString(),readyAt:e?undefined:now.toISOString(),status:e?'preparing':'ready',items:picked,front:e?'':picked[0]!.front,back:e?'':picked[0]!.back,criteria:picked.map(i=>({itemId:i.id,text:i.front})),answer:'',attempted:false,config:schedulerConfig(scheduler),model};
   const reserved=store.reserve(activity);if(reserved!==activity)return publicReviewActivity(reserved);emit('review-changed',{});
   if(e)try{const proposal=reviewActivityProposal.parse(await generate(e,picked,AbortSignal.any([signal,AbortSignal.timeout(20*60*1000)]),usage=>{const next={...activity,revision:activity.revision+1,usage:accumulateJobUsage(activity.usage,model!,piUsageToStep(usage))};activity=store.update(next,activity.revision);}));
    if(proposal.criteria.length!==picked.length||new Set(proposal.criteria.map(c=>c.itemId)).size!==picked.length||proposal.criteria.some(c=>!picked.some(i=>i.id===c.itemId)))throw new AtlasError('The question did not cover the selected targets. Use individual cards.');
    activity=store.update({...activity,...proposal,status:'ready',readyAt:clock().toISOString(),revision:activity.revision+1},activity.revision);
   }catch{const latest=store.activity(activity.id);if(latest&&latest.revision!==activity.revision)return publicReviewActivity(latest);activity=store.update({...activity,status:'failed',error:'The connected question could not be prepared. No review rating was recorded. Try individual cards or explicitly retry.',revision:activity.revision+1},activity.revision);}
   return publicReviewActivity(activity);
  }
  const a=store.activity(c.id);if(!a)throw new AtlasError('Review not found.',404);
  if(c.action==='draft'){if(a.status!=='ready')throw new AtlasError('Only working answers can be edited.',409);return publicReviewActivity(store.update({...a,answer:c.answer,revision:a.revision+1},c.revision));}
  if(c.action==='drawing'){
   if(a.status!=='ready'||a.revision!==c.revision)throw new AtlasError('The review changed. Keep your drawing open and reload.',409);
   const target={id:'review',title:a.items.map(i=>i.title).join(' · ').slice(0,160),start:a.front.slice(0,4000),finish:'Recall the basic concepts independently.'};
   return stores.scratchpadStore.save(a.id,'review',c.expectedRevision,{scene:c.scene,text:a.answer,target});
  }
  if(c.action==='skip'){if(['failed','skipped'].includes(a.status))return publicReviewActivity(a);if(!['preparing','ready','revealed'].includes(a.status))throw new AtlasError('This review is already closed.',409);return publicReviewActivity(store.update({...a,status:a.status==='preparing'?'failed':'skipped',revision:a.revision+1},c.revision));}
  if(c.action==='reveal'){
   if(['revealed','rated'].includes(a.status))return publicReviewActivity(a);if(a.status!=='ready'||a.revision!==c.revision)throw new AtlasError('The question changed. Reload before revealing.',409);
   let scratchwork=a.scratchwork;let drawing=stores.scratchpadStore.read(a.id,'review');
   if(drawing?.scene.elements.some(e=>!e.isDeleted)){
    if(!c.image||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(c.image))throw new AtlasError('Export your drawing before revealing the answer. The saved work is retained.');
    if(c.drawingRevision!==drawing.revision)throw new AtlasError('The drawing changed in another window. Keep your work open and reload.',409);
    if(drawing.text!==c.answer)drawing=stores.scratchpadStore.save(a.id,'review',drawing.revision,{scene:drawing.scene,text:c.answer,target:drawing.target});
    const h=hash([a.id,drawing.revision]),token=`sa_${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`,pixels=Buffer.from(c.image.slice(c.image.indexOf(',')+1),'base64'),attempt=stores.scratchpadStore.capture(a.id,'review',token,drawing.revision,pixels);scratchwork=stores.scratchpadStore.retain(a.id,'review',attempt.draft,token);
   }
   return publicReviewActivity(store.update({...a,scratchwork,status:'revealed',answer:c.answer,attempted:true,revealedAt:now.toISOString(),revision:a.revision+1},c.revision));
  }
  const items=store.items().filter(i=>a.items.some(n=>n.id===i.id)),events=items.flatMap(i=>store.events(i.id)),apply=await prepareReplay(items,[...events,...items.map(i=>({id:'pending',activityId:a.id,itemId:i.id,targetVersion:i.targetVersion,at:now.toISOString(),recordedAt:now.toISOString(),rating:3,config:a.config,revlog:null}))]);
  return publicReviewActivity(store.rate(a.id,c.revision,c.ratings,now.toISOString(),apply));
 }
 return {snapshot,command,autoEnrol};
}
export async function retrievalResponse(request:Request){try{
 const service=createRetrievalService();if(request.method==='GET'){
  const q=new URL(request.url).searchParams,id=q.get('drawing')??q.get('image')??q.get('scene');
  if(id){const activity=stores.atlasStore.retrieval.activity(id);if(!activity)throw new AtlasError('Review not found.',404);const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
   if(q.has('drawing'))return Response.json({draft:stores.scratchpadStore.read(id,'review')},{headers});
   if(!activity.scratchwork)throw new AtlasError('No drawing was submitted for this review.',404);
   if(q.has('image'))return new Response(Buffer.from(stores.scratchpadStore.retainedImage(activity.scratchwork.id)),{headers:{...headers,'Content-Type':'image/png'}});
   return new Response(JSON.stringify(stores.scratchpadStore.retained(activity.scratchwork.id)!.draft.scene),{headers:{...headers,'Content-Type':'application/json','Content-Disposition':'attachment; filename="review.excalidraw"'}});
  }
  return Response.json(await service.snapshot(),{headers:{'Cache-Control':'no-store'}});
 }
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new AtlasError('Expected JSON.',415);
 const raw=JSON.parse((await readSourceBody(request,24*1024*1024)).toString('utf8')),result=await service.command(raw,request.signal);emit('review-changed',{});return Response.json({result,snapshot:await service.snapshot()});
 }catch(e){return Response.json({error:e instanceof AtlasError?e.message:e instanceof z.ZodError?`Check review details: ${e.issues[0]?.message??'unsupported request'}`:'Review is unavailable. Saved targets and attempts are retained.'},{status:e instanceof AtlasError?e.status:400});}}
