import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Resvg} from '@resvg/resvg-js';
import {initialLesson} from '../src/core/learning-session.ts';
import {createReadingStore} from '../src/store/article-reading.ts';
import {articleCanvasTarget,readingComment,type ReadingComment} from '../src/core/article-reading.ts';
import {scratchAttemptMessage,type ScratchScene} from '../src/core/scratchpad.ts';
import {newUserMessage} from '../src/core/native-messages.ts';
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'atlas-reading-')));
process.env.LH_DATA_DIR=path.join(root,'data');process.env.LH_AUTH_FILE=path.join(root,'auth.json');process.env.LH_IGNORE_ENV_KEYS='1';fs.writeFileSync(process.env.LH_AUTH_FILE,'{}');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {stores}=await import('../src/server/stores.ts'),{readingResponse}=await import('../src/server/article-reading.ts'),{scratchpadResponse}=await import('../src/server/scratchpad.ts');
const image=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="4" y="30">x = y</text></svg>').render().asPng(),png=`data:image/png;base64,${image.toString('base64')}`;
const scene:ScratchScene={type:'excalidraw',version:2,elements:[{id:'stroke',type:'freedraw',isDeleted:false,points:[[0,0],[10,20]]}],appState:{scrollX:17,scrollY:33,zoom:{value:1.5}},files:{}};
function fixture(lesson=true){const chat=stores.chatStore.createChat('Reading test');if(lesson)stores.lessonStore.create(chat.id,initialLesson('A fixed lesson objective'));
 const bytes=Buffer.from(`%PDF-1.4 fixture for ownership and state ${chat.id}`),source=stores.lessonDocuments.put(chat.id,'paper.pdf',bytes, 'pdf',3);
 const post=async(body:unknown)=>readingResponse(new Request('http://local/reading',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),chat.id);
 const get=async(query='')=>readingResponse(new Request(`http://local/reading${query}`),chat.id);
 return {chat,source,post,get,bytes};}
function comment():ReadingComment{return {id:`rc_${randomUUID()}`,page:2,rects:[{x:.1,y:.2,width:.3,height:.08}],quote:'The stated equation.',text:'Why does this hold?',padIds:[],attemptIds:[]};}
async function open(f:ReturnType<typeof fixture>){const r=await f.post({action:'open',sourceId:f.source.id});assert.equal(r.status,200);return (await r.json()).workspace;}
test('multiple PDF entry points share one canvas per hash, persist reading state and never move the lesson',async()=>{
 const f=fixture(),before=stores.lessonStore.read(f.chat.id),w=await open(f),a=(await (await f.get(`?source=${f.source.id}`)).json()).article;
 const put=await scratchpadResponse(new Request('http://local/pad',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({padId:articleCanvasTarget(a).id,draft:{expectedRevision:0,target:articleCanvasTarget(a),scene,text:''}})}),f.chat.id);assert.equal(put.status,200);
 const positioned=await f.post({action:'position',sourceId:f.source.id,revision:w.revision,page:2,zoom:1.5,split:62});assert.equal(positioned.status,200);
 const research=stores.researchSources.retain(f.chat.id,{bytes:f.bytes,title:'Discovered paper',authors:'',url:'https://example.test/paper',pages:3});
 const same=await (await f.post({action:'open',sourceId:research.id})).json();assert.equal(same.workspace.hash,f.source.hash);assert.equal(same.workspace.page,2);
 const second=stores.lessonDocuments.put(f.chat.id,'second.pdf',Buffer.from('%PDF-1.4 another article'), 'pdf',1);await f.post({action:'open',sourceId:second.id});assert.equal(stores.readingStore.active(f.chat.id),second.id);
 const restored=await (await f.get(`?source=${f.source.id}`)).json();assert.equal(restored.workspace.split,62);assert.deepEqual(restored.draft.scene,scene);
 const restarted=createReadingStore(path.join(root,'data','article-reading'));assert.equal(restarted.read(f.chat.id,f.source.hash)!.zoom,1.5);assert.deepEqual(stores.lessonStore.read(f.chat.id),before);
 assert.equal((await (await f.get()).json()).articles.length,2);
});
test('comments edit/remove explicitly, reject conflicts, and never accept forged attachment links',async()=>{
 const f=fixture(),w=await open(f),c=comment();c.lessonTargetId='topic-topic_0';c.padIds=['forged'];c.attemptIds=[`sa_${randomUUID()}`];
 let r=await f.post({action:'comment',sourceId:f.source.id,revision:w.revision,comment:c});assert.equal(r.status,200);let next=(await r.json()).workspace;assert.deepEqual(next.comments[0].padIds,[]);assert.deepEqual(next.comments[0].attemptIds,[]);
 r=await f.post({action:'comment',sourceId:f.source.id,revision:w.revision,comment:c});assert.equal(r.status,409);
 r=await f.post({action:'comment',sourceId:f.source.id,revision:next.revision,comment:{...c,text:'Updated note'}});assert.equal(r.status,200);next=(await r.json()).workspace;
 assert.equal(next.comments[0].text,'Updated note');
 r=await f.post({action:'remove',sourceId:f.source.id,revision:next.revision,commentId:c.id});assert.equal(r.status,200);assert.equal((await r.json()).workspace.comments.length,0);
 assert(!readingComment.safeParse({...c,rects:[{x:.9,y:.1,width:.4,height:.2}]}).success);
});
test('quick pads are independently saved and registered in research chats without a lesson',async()=>{
 const f=fixture(false);let w=await open(f);const c=comment();w=(await (await f.post({action:'comment',sourceId:f.source.id,revision:w.revision,comment:c})).json()).workspace;
 const targets=[];for(let n=0;n<2;n++){const r=await f.post({action:'quick',sourceId:f.source.id,revision:w.revision,commentId:c.id,id:randomUUID()});assert.equal(r.status,200);const v=await r.json();w=v.workspace;targets.push(v.target);}
 assert.notEqual(targets[0].id,targets[1].id);assert.equal(w.comments[0].padIds.length,2);
 const target=targets[0],put=await scratchpadResponse(new Request('http://local/pad',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({padId:target.id,draft:{expectedRevision:1,target,scene,text:'My derivation'}})}),f.chat.id);assert.equal(put.status,200);
 const restored=await (await scratchpadResponse(new Request(`http://local/pad?pad=${target.id}`),f.chat.id)).json();assert.equal(restored.target.id,target.id);assert.equal(restored.draft.text,'My derivation');assert.equal(stores.lessonStore.read(f.chat.id),null);
 const invalid=await scratchpadResponse(new Request('http://local/pad',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({padId:'unregistered',draft:{expectedRevision:0,target:{...target,id:'unregistered'},scene,text:'No grant'}})}),f.chat.id);assert.equal(invalid.status,404);
});
test('questions and handwritten comments retain immutable snapshots and native conversation links',async()=>{
 const f=fixture();let w=await open(f);const c=comment();w=(await (await f.post({action:'comment',sourceId:f.source.id,revision:w.revision,comment:c})).json()).workspace;
 const token=randomUUID(),body={action:'question',sourceId:f.source.id,revision:w.revision,commentId:c.id,id:token,text:'Explain this step.',image:png};
 let response=await f.post(body);assert.equal(response.status,200);let saved=await response.json();w=saved.workspace;
 const retry=await f.post(body);assert.equal(retry.status,200);assert.equal((await retry.json()).attemptId,saved.attemptId);
 const wrong=await f.post({...body,text:'A different request'});assert.equal(wrong.status,409);
 const attempt=stores.scratchpadStore.attempt(f.chat.id,saved.attemptId)!;assert.match(attempt.draft.text,/selected source excerpt, not my proof/);assert.deepEqual(stores.scratchpadStore.image(f.chat.id,attempt.id),image);
 const {fauxAssistantMessage,fauxText}=await import('@earendil-works/pi-ai');stores.chatStore.saveMessages(f.chat.id,[scratchAttemptMessage(attempt),fauxAssistantMessage([fauxText('Here is the short explanation.')]) as never]);
 const detail=await (await f.get(`?source=${f.source.id}`)).json();assert.equal(detail.exchanges[c.id][0].id,attempt.id);assert.match(detail.exchanges[c.id][0].answer,/short explanation/);
 response=await f.post({action:'attach',sourceId:f.source.id,revision:w.revision,commentId:c.id,id:randomUUID(),image:png,scene});assert.equal(response.status,200);saved=await response.json();assert(saved.workspace.comments[0].handwritingId);assert.deepEqual(stores.scratchpadStore.attempt(f.chat.id,saved.attemptId)!.draft.scene,scene);
});
test('source ownership, changed originals, stale revisions and page bounds fail closed',async()=>{
 const f=fixture(),other=fixture();const w=await open(f);
 assert.equal((await readingResponse(new Request(`http://local/reading?source=${f.source.id}`),other.chat.id)).status,404);
 assert.equal((await f.post({action:'position',sourceId:f.source.id,revision:w.revision,page:9,zoom:1,split:50})).status,400);
 assert.equal((await f.get('?source=../../secret')).status,400);
 const origin=await readingResponse(new Request('http://local/reading',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://other'},body:JSON.stringify({action:'open',sourceId:f.source.id})}),f.chat.id);assert.equal(origin.status,403);
 fs.writeFileSync(stores.lessonDocuments.asset(f.chat.id,f.source.id).path,'modified');assert.equal((await f.get(`?source=${f.source.id}&asset=1`)).status,409);
 assert.throws(()=>createReadingStore(path.join(root,'store')).list('../escape'));
});
test('a prepared article question reaches the existing multimodal learning turn once',async()=>{
 const {authStore}=await import('../src/store/auth.ts');authStore.setAuthVar('OPENROUTER_API_KEY','dummy-key-for-faux-engine');
 const f=fixture(false);let w=await open(f);const c=comment();w=(await (await f.post({action:'comment',sourceId:f.source.id,revision:w.revision,comment:c})).json()).workspace;
 assert.equal(stores.lessonStore.read(f.chat.id),null);
 const prepared=await (await f.post({action:'question',sourceId:f.source.id,revision:w.revision,commentId:c.id,id:randomUUID(),text:'Explain the selected equation.',image:png})).json();
 assert(stores.lessonStore.read(f.chat.id));stores.chatStore.saveSettings(f.chat.id,{model:{provider:'openrouter',id:'openai/gpt-4.1'}});
 const {createFauxCore,fauxAssistantMessage,fauxText}=await import('@earendil-works/pi-ai'),{createLearningAgent}=await import('../src/agent/teacher-agent.ts'),{handleChatInput}=await import('../src/server/chat-handler.ts'),{runningTurn}=await import('../src/server/turn-runs.ts');
 const faux=createFauxCore({});let calls=0;
 faux.setResponses([context=>{calls++;assert(context.messages.some(m=>m.role==='user'&&Array.isArray(m.content)&&m.content.some(p=>p.type==='image'&&p.data===image.toString('base64'))));return fauxAssistantMessage([fauxText('Use the definition in the selected equation.')]);}]);
 const build=(opts:Parameters<typeof createLearningAgent>[3])=>createLearningAgent({chatId:f.chat.id,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}});
 const result=await handleChatInput(f.chat.id,{type:'scratchpad',attemptId:prepared.attemptId},build);assert.equal(result.status,200,await result.text());const run=runningTurn(f.chat.id);if(run)await new Response(run.subscribe()).text();
 assert.equal(calls,1);assert.equal(stores.chatStore.getChat(f.chat.id)!.messages.filter(m=>m.id===prepared.attemptId).length,1);assert(!JSON.stringify(stores.chatStore.getChat(f.chat.id)).includes(image.toString('base64')));
 assert.equal((await handleChatInput(f.chat.id,{type:'scratchpad',attemptId:prepared.attemptId},build)).status,200);assert.equal(calls,1);
});

test('local browser origin follows the real Host through Next internal localhost URLs',async()=>{
 const f=fixture();const r=await readingResponse(new Request('http://localhost:3006/reading',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:3006',Host:'127.0.0.1:3006'},body:JSON.stringify({action:'open',sourceId:f.source.id})}),f.chat.id);assert.equal(r.status,200);
});

test('library spans sessions and renamed titles preserve originals and canvas identity',async()=>{
 const {articleLibraryResponse}=await import('../src/server/article-reading.ts');
 const first=fixture(),second=fixture(),w=await open(first);
 const renamed=await first.post({action:'rename',sourceId:first.source.id,revision:w.revision,title:'Diffusions and generators'});
 assert.equal(renamed.status,200);
 const library=await (await articleLibraryResponse()).json();
 assert.equal(library.articles.find((a:any)=>a.chatId===first.chat.id).title,'Diffusions and generators');
 assert.ok(library.articles.some((a:any)=>a.chatId===second.chat.id));
 const reopened=await (await first.get(`?source=${first.source.id}`)).json();
 assert.equal(reopened.article.title,'Diffusions and generators');
 assert.equal(reopened.workspace.pads[0].target.id,w.pads[0].target.id);
 assert.equal(stores.lessonDocuments.list(first.chat.id)[0]!.name,'paper.pdf');
 assert.equal((await first.post({action:'rename',sourceId:first.source.id,revision:w.revision,title:'Stale writer'})).status,409);
});
