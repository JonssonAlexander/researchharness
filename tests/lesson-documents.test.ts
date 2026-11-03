import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLessonDocumentStore} from '../src/store/lesson-documents.ts';
import {initialLesson} from '../src/core/learning-session.ts';
import {lessonDocumentTools} from '../src/agent/tools/lesson-documents.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-lesson-documents-'));process.env.LH_DATA_DIR=path.join(root,'profile');process.env.LH_AUTH_FILE=path.join(root,'auth.json');after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {stores}=await import('../src/server/stores.ts'),{lessonDocumentsResponse,lessonDocumentReader}=await import('../src/server/lesson-documents.ts');
function fixture(){const chat=stores.chatStore.createChat('Learn from a paper');stores.lessonStore.create(chat.id,initialLesson('Understand the paper'));return chat.id;}
const upload=(chat:string,name:string,body:Uint8Array|string)=>lessonDocumentsResponse(new Request(`http://localhost/api/chats/${chat}/sources?name=${encodeURIComponent(name)}`,{method:'POST',body:typeof body==='string'?body:new Uint8Array(body).buffer}),chat);
test('source originals are immutable, scoped per lesson, deduplicated and survive reopening',()=>{
 const store=createLessonDocumentStore(path.join(root,'unit')),bytes=Buffer.from('A definition and its assumptions.'),source=store.put('lesson-a','paper.md',bytes,'text',null);
 assert.deepEqual(store.put('lesson-a','copy.md',bytes,'text',null),source);assert.equal(store.list('lesson-a').length,1);assert.deepEqual(createLessonDocumentStore(path.join(root,'unit')).asset('lesson-a',source.id).bytes,bytes);
 assert.throws(()=>store.asset('lesson-b',source.id),/not found/);assert.throws(()=>store.list('../elsewhere'),/Invalid session/);
 fs.writeFileSync(store.asset('lesson-a',source.id).path,'changed');assert.throws(()=>store.asset('lesson-a',source.id),/changed/);
});
test('upload/read/download retain complete local text and provide bounded, source-labelled tool excerpts',async()=>{
 const chat=fixture(),original='Definition with conditions. '.repeat(1000),r=await upload(chat,'research.tex',original);assert.equal(r.status,200);const source=(await r.json()).source;
 const reader=lessonDocumentReader(chat,false),tools=lessonDocumentTools(reader),result=await tools.read_lesson_source!.execute('read',{id:source.id},undefined),value=JSON.parse((result.content[0] as {text:string}).text);assert.equal(value.name,'research.tex');assert.equal(value.excerpt.length,12000);assert.equal(value.nextOffset,12000);assert.equal(value.source,source.id);
 const download=await lessonDocumentsResponse(new Request(`http://localhost/sources?asset=${source.id}`),chat);assert.equal(await download.text(),original);assert.match(download.headers.get('Content-Disposition')!,/attachment/);
 assert.equal((await upload(chat,'duplicate.tex',original)).status,200);assert.equal(reader.list().length,1);await assert.rejects(()=>lessonDocumentReader(fixture(),false).read(source.id,0,1),/not found/);
});
test('real PDF source reads page-labelled mathematics and renders a page through the native image tool',async()=>{
 const chat=fixture(),bytes=fs.readFileSync(path.join(import.meta.dirname,'fixtures/sample-3page.pdf')),r=await upload(chat,'paper.pdf',bytes);assert.equal(r.status,200);const source=(await r.json()).source;assert.equal(source.pages,3);
 const reader=lessonDocumentReader(chat,true),value=await reader.read(source.id,0,2) as {excerpt:string;page:number};assert.match(value.excerpt,/--- Page 2 ---/);assert.equal(value.page,2);
 const tools=lessonDocumentTools(reader),result=await tools.view_lesson_page!.execute('page',{id:source.id,page:2},undefined);assert(result.content.some(c=>c.type==='image'&&c.mimeType==='image/png'));assert(JSON.stringify(result.content[0]).includes('page 2'));
 await assert.rejects(()=>lessonDocumentReader(chat,false).page(source.id,1),/cannot view images/);await assert.rejects(()=>reader.page(source.id,4),/Choose a page/);
});
test('unreadable or unsupported uploads do not alter the lesson or create source records',async()=>{
 const chat=fixture(),before=stores.lessonStore.read(chat);for(const [name,body] of [['bad.pdf','not a pdf'],['binary.txt','a\0b'],['paper.docx','unsupported'],['empty.md','']]){const r=await upload(chat,name!,body!);assert.equal(r.status,400);}
 assert.equal(stores.lessonDocuments.list(chat).length,0);assert.deepEqual(stores.lessonStore.read(chat),before);
 const practice=stores.chatStore.createChat('Practice','practice');assert.equal((await upload(practice.id,'notes.md','Definition.')).status,404);
});
test('a source-based teaching agent retains both source and Atlas lookup tools',async()=>{
 const {createLearningAgent}=await import('../src/agent/teacher-agent.ts'),{createFauxCore}=await import('@earendil-works/pi-ai');const chat=fixture();await upload(chat,'paper.md','A source explanation with conditions.');const faux=createFauxCore({});
 const agent=createLearningAgent({chatId:chat,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{learning:stores.lessonStore.read(chat)!,engine:{model:faux.getModel(),streamFn:faux.streamSimple},lessonSources:lessonDocumentReader(chat,false),atlasLookup:{read:()=>({atlas:stores.atlasStore.read(),propositions:[],chains:[]}),lesson:id=>stores.atlasStore.lessonReviews.read(id)}});
 const names=agent.state.tools.map(t=>t.name);for(const name of ['read_lesson_source','view_lesson_page','search_atlas','read_atlas','update_lesson'])assert(names.includes(name));assert(agent.state.systemPrompt.includes('paper.md'));assert(agent.state.systemPrompt.includes('untrusted evidence'));assert(agent.state.systemPrompt.includes('saved nodes never establish independent mastery'));
});

test('a native source lesson reads an attachment and Atlas before planning, retaining both tool results',async()=>{
 process.env.OPENROUTER_API_KEY='test-key-presence-gate';
 const {createLearningAgent}=await import('../src/agent/teacher-agent.ts'),{createFauxCore,fauxAssistantMessage,fauxToolCall,fauxText}=await import('@earendil-works/pi-ai'),{handleChatInput}=await import('../src/server/chat-handler.ts'),{runningTurn}=await import('../src/server/turn-runs.ts');
 const chat=fixture();stores.chatStore.saveSettings(chat,{model:{provider:'openrouter',id:'z-ai/glm-5.3-flash'}});const source=(await (await upload(chat,'paper.tex','The paper assumes independent increments and derives a limit.')).json()).source;
 const conceptId='ac_00000000-0000-4000-8000-000000000081';stores.atlasStore.save({kind:'concept',id:conceptId,expectedRevision:0,title:'Independent increments',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[],markdown:'Previously discussed; independence under the stated conditions.'});const lesson=stores.lessonStore.read(chat)!,plan=structuredClone(lesson.plan);plan.nodes[0]!.conceptId=conceptId;
 const before=JSON.stringify(stores.atlasStore.read()),faux=createFauxCore({});faux.setResponses([
  ()=>fauxAssistantMessage([fauxToolCall('read_lesson_source',{id:source.id},{id:'source_read'})],{stopReason:'toolUse'}),
  context=>{assert(JSON.stringify(context.messages).includes('derives a limit'));return fauxAssistantMessage([fauxToolCall('search_atlas',{query:'Independent increments'},{id:'source_atlas'})],{stopReason:'toolUse'});},
  context=>{assert(JSON.stringify(context.messages).includes(conceptId));return fauxAssistantMessage([fauxToolCall('update_lesson',{expectedRevision:1,plan},{id:'source_plan'})],{stopReason:'toolUse'});},
  ()=>fauxAssistantMessage([fauxText('Start with the paper’s assumptions, connecting them to independent increments.')]),
 ]);
 const response=await handleChatInput(chat,{type:'text',text:'Teach me from the attached paper.'},opts=>{assert(opts.lessonSources);assert(opts.atlasLookup);return createLearningAgent({chatId:chat,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}});});assert.equal(response.status,200);const run=runningTurn(chat);if(run)await new Response(run.subscribe()).text();
 assert.equal(stores.lessonStore.read(chat)!.revision,2);assert.equal(JSON.stringify(stores.atlasStore.read()),before);const messages=stores.chatStore.getChat(chat)!.messages;for(const name of ['read_lesson_source','search_atlas','update_lesson'])assert(messages.some(m=>m.role==='toolResult'&&m.toolName===name));assert.equal(lessonDocumentReader(chat,false).list()[0]!.id,source.id);
});
