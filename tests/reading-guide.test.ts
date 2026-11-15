import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {initialLesson} from '../src/core/learning-session.ts';
import {pdfExtract} from '../src/agent/subagents/pdf-ops.ts';
import {createReadingStore} from '../src/store/article-reading.ts';
import {readingGuideTools} from '../src/agent/tools/reading-guide.ts';
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'atlas-guide-test-')));
process.env.LH_DATA_DIR=path.join(root,'data');process.env.LH_AUTH_FILE=path.join(root,'auth.json');process.env.LH_IGNORE_ENV_KEYS='1';fs.writeFileSync(process.env.LH_AUTH_FILE,'{}');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {stores}=await import('../src/server/stores.ts'),{readingGuideService}=await import('../src/server/reading-guide.ts'),{readingResponse}=await import('../src/server/article-reading.ts');
const file=path.join(import.meta.dirname,'fixtures/sample-3page.pdf'),bytes=fs.readFileSync(file);
const quote=(await pdfExtract(file,'1')).split('\n').find(t=>t.length>15&&!t.startsWith('---'))!.trim();
function fixture(){const chat=stores.chatStore.createChat('A guide lesson');stores.lessonStore.create(chat.id,initialLesson('Understand calculus before applying it'));const source=stores.lessonDocuments.put(chat.id,'Calculus.pdf',bytes,'pdf',3);return {chat,source,service:readingGuideService(chat.id)};}
const entry=(page=1,q=quote)=>({page,quote:q,title:'A key concept',establishes:'Introduces the central object.',importance:'It is the starting point for our lesson.'});
const post=(chat:string,body:unknown)=>readingResponse(new Request('http://local/reading',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),chat);
test('real PDF matches become clickable locations; missing quotes stay page-only; append/restart keep earlier entries',async()=>{
 const {chat,source,service}=fixture(),lesson=stores.lessonStore.read(chat.id);
 const result:any=await service.add(source.id,[entry(2,'This quotation is not present in this mathematical paper.'),entry()]);assert.equal(result.added,2);
 let w=stores.readingStore.read(chat.id,source.hash)!;assert.deepEqual(w.guide!.items.map(i=>i.page),[1,2]);assert.equal(w.guide!.items[0]!.location,'exact');assert(w.guide!.items[0]!.rects.length);assert.equal(w.guide!.items[1]!.location,'page-only');assert.deepEqual(w.guide!.items[1]!.rects,[]);assert.equal(w.comments.length,0);
 const first=w.guide!.items[0];await service.add(source.id,[entry()]);assert.equal(stores.readingStore.read(chat.id,source.hash)!.guide!.items.length,2);
 const off=await post(chat.id,{action:'guide-toggle',sourceId:source.id,revision:w.revision,enabled:false});assert.equal(off.status,200);
 await service.add(source.id,[entry(3,'A second passage that cannot be uniquely located.')]);w=stores.readingStore.read(chat.id,source.hash)!;
 assert.equal(w.guide!.enabled,false);assert.deepEqual(w.guide!.items[0],first);assert.equal(w.guide!.items.length,3);
 const restarted=createReadingStore(path.join(root,'data/article-reading')).read(chat.id,source.hash);assert.deepEqual(restarted!.guide,w.guide);assert.deepEqual(stores.lessonStore.read(chat.id),lesson);
});
test('guide writes preserve comments/position changed during PDF lookup, refuse wrong source/pages/topics and cancelled calls',async()=>{
 const {chat,source,service}=fixture(),other=fixture();await assert.rejects(()=>readingGuideService(other.chat.id).add(`ls_${'f'.repeat(64)}`,[entry()]));await assert.rejects(()=>service.add(source.id,[entry(4)]));await assert.rejects(()=>service.add(source.id,[{...entry(),topicId:'invented'}]));
 const deferred=readingGuideService(chat.id,async()=>{const w=stores.readingStore.open(chat.id,{id:source.id,hash:source.hash,title:'Calculus',pages:3,kind:'lesson'});stores.readingStore.save(chat.id,{...w,page:3,comments:[{id:`rc_${randomUUID()}`,page:3,quote:'My note',text:'Keep this',rects:[{x:.1,y:.1,width:.2,height:.1}],padIds:[],attemptIds:[]}]},w.revision);return {pages:3,location:'page-only' as const,reference:'',rects:[]};});
 await deferred.add(source.id,[entry()]);const w=stores.readingStore.read(chat.id,source.hash)!;assert.equal(w.page,3);assert.equal(w.comments[0]!.text,'Keep this');
 const controller=new AbortController();controller.abort();await assert.rejects(()=>service.add(source.id,[entry(2)],controller.signal));assert.equal(stores.readingStore.read(chat.id,source.hash)!.guide!.items.length,1);
});
test('guide discussions and quick pads use native attempts without becoming owner comments',async()=>{
 const {chat,source,service}=fixture();await service.add(source.id,[entry()]);let w=stores.readingStore.read(chat.id,source.hash)!,g=w.guide!.items[0]!;
 const request={action:'question',sourceId:source.id,revision:w.revision,guideId:g.id,id:randomUUID(),text:'Explain this argument.',image:null};const r=await post(chat.id,request),v=await r.json();assert.equal(r.status,200);assert.match(stores.scratchpadStore.attempt(chat.id,v.attemptId)!.draft.text,/AI reading guide/);assert.equal(v.workspace.comments.length,0);assert.deepEqual(v.workspace.guide.items[0].attemptIds,[v.attemptId]);assert.equal((await post(chat.id,request)).status,200);
 w=v.workspace;const quick=await post(chat.id,{action:'quick',sourceId:source.id,revision:w.revision,guideId:g.id,id:randomUUID()});assert.equal(quick.status,200);assert.equal((await quick.json()).workspace.guide.items[0].padIds.length,2);
 const tools=readingGuideTools(service);assert.equal(Object.keys(tools).length,4);const result=await tools.list_reading_guides!.execute('list',{});assert(JSON.stringify(result).includes('Understand calculus'));assert.equal((await service.read(source.id,1) as any).sourceId,source.id);
});

test('an overview request can save a guide through the native teacher tools and survive the next turn',async()=>{
 const {authStore}=await import('../src/store/auth.ts');authStore.setAuthVar('OPENROUTER_API_KEY','dummy-key-for-faux-engine');
 const {chat,source}=fixture();stores.chatStore.saveSettings(chat.id,{model:{provider:'openrouter',id:'openai/gpt-4.1'}});
 const {createLearningAgent}=await import('../src/agent/teacher-agent.ts'),{createFauxCore,fauxAssistantMessage,fauxToolCall,fauxText}=await import('@earendil-works/pi-ai'),{handleChatInput}=await import('../src/server/chat-handler.ts'),{runningTurn}=await import('../src/server/turn-runs.ts');
 const faux=createFauxCore({});faux.setResponses([
  ()=>fauxAssistantMessage([fauxToolCall('list_reading_guides',{}, {id:'guide_list'})],{stopReason:'toolUse'}),
  ()=>fauxAssistantMessage([fauxToolCall('read_guide_source',{sourceId:source.id,page:1},{id:'guide_read'})],{stopReason:'toolUse'}),
  ()=>fauxAssistantMessage([fauxToolCall('add_reading_highlights',{sourceId:source.id,items:[entry(),entry(2,'Second distinct source passage.'),entry(3,'Third distinct source passage.'),entry(1,'Fourth distinct source passage.')]},{id:'guide_save'})],{stopReason:'toolUse'}),
  ()=>{const highlights=stores.readingStore.read(chat.id,source.hash)!.guide!.items,kinds=['result','setup','mechanism','consequence'] as const;return fauxAssistantMessage([fauxToolCall('set_reading_route',{sourceId:source.id,route:{problem:'Estimate from few samples.',answer:'Use structure.',intuition:'Share information.',stops:highlights.map((h,i)=>({highlightId:h.id,title:`Stop ${i+1}`,kind:kinds[i]!,statement:'Short statement.',intuition:'Simple idea.'}))}},{id:'guide_route'})],{stopReason:'toolUse'});},
  ()=>fauxAssistantMessage([fauxText('The conceptual guide is saved in the PDF workspace.')]),
  ()=>fauxAssistantMessage([fauxText('Here is a short explanation of the definition.')]),
 ]);
 const build=(opts:Parameters<typeof createLearningAgent>[3])=>{assert(opts.readingGuide);return createLearningAgent({chatId:chat.id,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}});};
 const before=stores.atlasStore.read();let r=await handleChatInput(chat.id,{type:'text',text:'Give me a conceptual overview of this PDF with a saved reading guide.'},build);assert.equal(r.status,200);let run=runningTurn(chat.id);if(run)await new Response(run.subscribe()).text();
 const guide=stores.readingStore.read(chat.id,source.hash)!.guide;assert(guide!.items.some(i=>i.location==='exact'));assert.equal(guide!.route!.stops.length,4);
 r=await handleChatInput(chat.id,{type:'text',text:'Explain this definition.'},build);assert.equal(r.status,200);run=runningTurn(chat.id);if(run)await new Response(run.subscribe()).text();
 assert.deepEqual(stores.readingStore.read(chat.id,source.hash)!.guide,guide);assert.deepEqual(stores.atlasStore.read(),before);
 for(const name of ['list_reading_guides','read_guide_source','add_reading_highlights','set_reading_route'])assert(stores.chatStore.getChat(chat.id)!.messages.some(m=>m.role==='toolResult'&&m.toolName===name));
});

test('a result-first route references saved anchors, keeps earlier work and survives additions/restart',async()=>{
 const {chat,source,service}=fixture();await service.add(source.id,[entry(),entry(2,'A distinct second passage in this source.'),entry(3,'A distinct third passage in this source.'),entry(1,'A distinct fourth passage in this source.')]);
 const before=stores.readingStore.read(chat.id,source.hash)!,kinds=['result','setup','mechanism','consequence'] as const;
 const route={problem:'Estimate covariance with limited samples.',answer:'A structured model shares information.',intuition:'Separate shape from scale.',stops:before.guide!.items.map((h,i)=>({highlightId:h.id,title:`Stop ${i+1}`,kind:kinds[i]!,statement:'A concise mathematical statement.',intuition:'A short explanation of the idea.'}))};
 service.route(source.id,route);const saved=stores.readingStore.read(chat.id,source.hash)!;assert.deepEqual(saved.guide!.items,before.guide!.items);assert.deepEqual(saved.comments,before.comments);assert.deepEqual(saved.guide!.route,route);
 assert.throws(()=>service.route(source.id,{...route,stops:route.stops.map((s,i)=>({...s,highlightId:i===0?`rg_${'f'.repeat(64)}`:s.highlightId}))}),/saved/);
 assert.throws(()=>service.route(source.id,{...route,stops:route.stops.map(s=>({...s,kind:'setup' as const}))}));
 await service.add(source.id,[entry(2,'Additional material outside the current reading route.')]);assert.deepEqual(stores.readingStore.read(chat.id,source.hash)!.guide!.route,route);
 const restored=createReadingStore(path.join(root,'data/article-reading')).read(chat.id,source.hash)!;assert.deepEqual(restored.guide!.route,route);
});
