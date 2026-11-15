import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AtlasError} from '../core/atlas.ts';
import {articleId} from '../core/article-reading.ts';
import {readingRoute,guideProposal,type ReadingGuideService,type GuideHighlight} from '../core/reading-guide.ts';
import {pdfExtract,pdfLocatePassage} from '../agent/subagents/pdf-ops.ts';
import {resolveArticle,readingArticles} from './article-reading.ts';
import {stores} from './stores.ts';
import {emit} from '../core/events.ts';
const proposals=z.array(guideProposal).min(1).max(8);
/** Semantic choices come from the teacher; only this locator owns coordinates. */
export function readingGuideService(chat:string,locate=pdfLocatePassage):ReadingGuideService {
 const source=(id:string)=>{if(!stores.chatStore.getChat(chat)||!stores.lessonStore.read(chat))throw new AtlasError('Open a lesson first.',404);return resolveArticle(chat,articleId.parse(id));};
 async function withFile<T>(id:string,run:(file:string)=>Promise<T>){const {bytes}=source(id),dir=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-guide-'));try{const file=path.join(dir,'source.pdf');await fs.writeFile(file,bytes,{mode:0o600});return await run(file);}finally{await fs.rm(dir,{recursive:true,force:true});}}
 return {
  list:()=>({objective:stores.lessonStore.read(chat)?.plan.objective,topics:stores.lessonStore.read(chat)?.plan.nodes.map(n=>({id:n.id,title:n.title})),articles:readingArticles(chat).map(a=>({...a,route:stores.readingStore.read(chat,a.hash)?.guide?.route,guide:stores.readingStore.read(chat,a.hash)?.guide?.items.map(({id,page,title,quote,location})=>({id,page,title,quote,location}))??null}))}),
  route:(id,raw)=>{
   const {article}=source(id),route=readingRoute.parse(raw),w=stores.readingStore.read(chat,article.hash);
   if(!w?.guide||route.stops.some(s=>!w.guide!.items.some(i=>i.id===s.highlightId)))throw new AtlasError('Reading route must use saved, source-checked passage IDs.');
   const next=stores.readingStore.save(chat,{...w,guide:{...w.guide,route}},w.revision);emit('reading-guide-changed',{chatId:chat});return {route:next.guide!.route,notice:'Saved result-first reading route; existing passages and notes are retained.'};
  },
  read:async(id,page)=>{const {article}=source(id);if(!Number.isInteger(page)||page<1||page>article.pages)throw new AtlasError('Choose a valid PDF page.');const last=Math.min(page+2,article.pages),text=await withFile(id,file=>pdfExtract(file,`${page}-${last}`));return {sourceId:id,page,lastPage:last,excerpt:text.slice(0,16000),truncated:text.length>16000,nextPage:last<article.pages?last+1:null};},
  add:async(id,raw,signal)=>{
   const {article}=source(id),items=proposals.parse(raw),lesson=stores.lessonStore.read(chat)!;
   if(items.some(i=>i.page>article.pages||i.topicId&&!lesson.plan.nodes.some(n=>n.id===i.topicId)))throw new AtlasError('Use valid PDF pages and existing lesson topics.');
   const found=await withFile(id,async file=>{const result:GuideHighlight[]=[];for(const item of items){signal?.throwIfAborted();const location=await locate(file,item.page,item.quote).catch(()=>{signal?.throwIfAborted();return {location:'page-only' as const,rects:[]};});result.push({...item,id:`rg_${createHash('sha256').update(JSON.stringify([article.hash,item.page,item.quote.normalize('NFKC').replace(/\s+/g,' ').trim()])).digest('hex')}`,location:location.location,rects:location.rects,createdAt:new Date().toISOString(),padIds:[],attemptIds:[]});}return result;});
   signal?.throwIfAborted();source(id); // Recheck original bytes before publishing.
   // Re-read after asynchronous PDF work: never replace intervening comments/position.
   const w=stores.readingStore.read(chat,article.hash)??stores.readingStore.open(chat,article),previous=w.guide?.items??[],fresh=found.filter((n,i)=>!previous.some(p=>p.id===n.id)&&found.findIndex(p=>p.id===n.id)===i);
   if(previous.length+fresh.length>32)throw new AtlasError('This guide already has enough highlights. Keep it selective.');
   const all=[...previous,...fresh].sort((a,b)=>a.page-b.page||(a.rects[0]?.y??1)-(b.rects[0]?.y??1));
   if(fresh.length)stores.readingStore.save(chat,{...w,guide:{lens:'conceptual-overview',objective:w.guide?.objective??lesson.plan.objective,enabled:w.guide?.enabled??true,...w.guide?.route?{route:w.guide.route}:{},items:all}},w.revision);
   emit('reading-guide-changed',{chatId:chat});
   return {sourceId:id,added:fresh.length,highlights:all.map(({id,page,title,location})=>({id,page,title,location})),notice:'Saved AI reading guide, not source annotations or verified mathematics. Page-only entries have no reliable highlight.'};
  },
 };
}
