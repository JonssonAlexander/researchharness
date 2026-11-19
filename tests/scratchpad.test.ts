import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Resvg} from '@resvg/resvg-js';
import {createFauxCore,fauxAssistantMessage,fauxText} from '@earendil-works/pi-ai';
import {createScratchpadStore,checkScratchPng} from '../src/store/scratchpad.ts';
import {initialLesson} from '../src/core/learning-session.ts';
import {practiceScratchTarget,lessonScratchTarget,scratchAttemptMessage,resolveScratchpadImages,scratchDelivery,type ScratchScene} from '../src/core/scratchpad.ts';
import {projectView} from '../src/core/view.ts';
import {toLlmMessages,asAgentMessages,nativeInputCause} from '../src/core/native-messages.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-scratch-test-'));process.env.LH_DATA_DIR=path.join(root,'data');process.env.LH_AUTH_FILE=path.join(root,'auth.json');process.env.OPENROUTER_API_KEY='fake-key-presence';
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const image=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><text x="1" y="20">x²</text></svg>').render().asPng();
const scene:ScratchScene={type:'excalidraw',version:2,elements:[{id:'stroke',type:'freedraw',isDeleted:false,points:[[0,0],[10,10]]}],appState:{zoom:{value:1},scrollX:20},files:{}};
const target={id:'derivation',title:'A result',start:'Assume A.',finish:'Prove B.'};
const id=()=>`sa_${randomUUID()}`;
const {stores}=await import('../src/server/stores.ts');
const {scratchpadResponse,scratchImages}=await import('../src/server/scratchpad.ts');
function fixture(){const store=createScratchpadStore(path.join(root,randomUUID())),draft=store.save('chat','derivation',0,{scene:structuredClone(scene),text:'Use the tower property.',target});return {store,draft};}
test('autosave retains editable scenes/assets, rejects stale writes and restores after restart',()=>{
 const folder=path.join(root,randomUUID()),store=createScratchpadStore(folder),first=store.save('chat','derivation',0,{scene,text:'First reasoning',target});
 const next=store.save('chat','derivation',1,{scene:{...scene,appState:{zoom:{value:2}}},text:'More reasoning',target});assert.equal(next.revision,2);assert.deepEqual(createScratchpadStore(folder).read('chat','derivation'),next);
 assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'chat','derivation','previous.json'),'utf8')).text,first.text);assert.throws(()=>store.save('chat','derivation',1,{scene,text:'stale',target}),/changed/);assert.deepEqual(store.read('chat','derivation'),next);
 assert.throws(()=>store.read('../outside','derivation'));fs.symlinkSync(path.join(folder,'chat','derivation'),path.join(folder,'chat','linked'));assert.throws(()=>store.read('chat','linked'),/regular directory/);
});
test('an exact submitted attempt is immutable, idempotent and keeps earlier snapshots when the draft changes',()=>{
 const {store,draft}=fixture(),token=id(),first=store.capture('chat','derivation',token,draft.revision,image);assert.equal(first.number,1);assert.deepEqual(store.capture('chat','derivation',token,draft.revision,image),first);assert.equal(store.list('chat','derivation').length,1);assert.deepEqual(store.image('chat',token),image);
 store.save('chat','derivation',1,{scene,text:'Revised reasoning',target:{...target,finish:'A different target'}});assert.equal(store.attempt('chat',token)!.draft.text,'Use the tower property.');assert.equal(store.attempt('chat',token)!.draft.target.finish,'Prove B.');
 assert.throws(()=>store.capture('chat','derivation',token,2,image),/different work/);assert.throws(()=>store.capture('chat','derivation',id(),1,image),/exact drawing revision/);
 const second=store.capture('chat','derivation',id(),2,image);assert.equal(second.number,2);assert.equal(store.list('chat','other').length,0);
});
test('failed export/capture does not clear the drawing; corrupt images and external asset URLs are refused',()=>{
 const {store,draft}=fixture();assert.throws(()=>store.capture('chat','derivation',id(),1,null),/Export/);assert.deepEqual(store.read('chat','derivation'),draft);
 assert.throws(()=>checkScratchPng(Buffer.from('bad png')),/PNG/);const broken=Buffer.from(image);broken[broken.length-5]=broken[broken.length-5]!^1;assert.throws(()=>checkScratchPng(broken),/checksum/);
 const asset={...scene,files:{image:{id:'image',mimeType:'image/png' as const,dataURL:'https://outside/image.png',created:1}}};assert.throws(()=>store.save('chat','derivation',1,{scene:asset,text:'Reasoning',target}),/local PNG/);
});
test('an interrupted atomic save preserves the last draft and permits retry',()=>{
 const {store,draft}=fixture(),rename=fs.renameSync;fs.renameSync=((from,to)=>{if(String(to).endsWith('current.json'))throw new Error('injected rename');return rename(from,to);}) as typeof fs.renameSync;
 try{assert.throws(()=>store.save('chat','derivation',1,{scene,text:'unsaved',target}),/injected/);}finally{fs.renameSync=rename;}
 assert.deepEqual(store.read('chat','derivation'),draft);assert.equal(store.save('chat','derivation',1,{scene,text:'retried',target}).revision,2);
});
test('native replay resolves one image at the model boundary, preserves source IDs and renders a thumbnail reference',()=>{
 const {store}=fixture(),a=store.capture('chat','derivation',id(),1,image),m=scratchAttemptMessage(a);assert(!JSON.stringify(m).includes(Buffer.from(image).toString('base64')));assert.equal(nativeInputCause(m,[]),'learner');
 const converted=toLlmMessages(resolveScratchpadImages(asAgentMessages([m]),attempt=>{assert.equal(attempt,a.id);return {type:'image',mimeType:'image/png',data:Buffer.from(store.image('chat',attempt)).toString('base64')};}));assert.equal(converted[0]!.role,'user');assert(JSON.stringify(converted).includes('"type":"image"'));assert(JSON.stringify(converted).includes('Use the tower property.'));
 const view=projectView([m]);assert.equal(view[0]!.role,'user');assert(view[0]!.parts.some(p=>p.type==='data-scratchpad'));assert.equal(scratchDelivery([],a.id),'ready');assert.equal(scratchDelivery([m],a.id),'submitted');assert.equal(scratchDelivery([m,{...fauxAssistantMessage([fauxText('Hint')]),id:'feedback'}],a.id),'answered');
});
async function session(){const chat=stores.chatStore.createChat('Scratchpad lesson'),plan=initialLesson('Prove a result');plan.derivations=[{id:'derivation',nodeId:'topic_0',title:'Result',start:'Assume A.',finish:'Prove B.',status:'working'}];plan.activeDerivationId='derivation';const lesson=stores.lessonStore.create(chat.id,plan);const draft=stores.scratchpadStore.save(chat.id,'derivation',0,{scene,text:'My argument',target:lessonScratchTarget(lesson)});return {chat,lesson,draft};}
test('HTTP saves/captures are local; targets are bound to the lesson and attempts remain queryable',async()=>{
 const f=await session(),before=stores.chatStore.getChat(f.chat.id)!.messages;
 const request=(method:string,body?:unknown,suffix='')=>scratchpadResponse(new Request(`http://local/scratchpad${suffix}`,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined}),f.chat.id);
 const bad=await request('PUT',{padId:'derivation',draft:{expectedRevision:1,scene,text:'changed',target:{...target,finish:'Wrong target'}}});assert.equal(bad.status,409);
 const token=id(),captured=await request('POST',{padId:'derivation',id:token,expectedRevision:1,image:`data:image/png;base64,${Buffer.from(image).toString('base64')}`});assert.equal(captured.status,200);assert.deepEqual(stores.chatStore.getChat(f.chat.id)!.messages,before);
 const list=await (await request('GET',undefined,'?pad=derivation')).json();assert.equal(list.attempts[0].delivery,'ready');assert.equal((await request('GET',undefined,`?image=${token}`)).headers.get('Content-Type'),'image/png');
 assert.throws(()=>scratchImages(f.chat.id,asAgentMessages([scratchAttemptMessage(stores.scratchpadStore.attempt(f.chat.id,token)!)]),false),/image-capable/);
});
test('a scripted multimodal lesson receives actual image pixels once; duplicate delivery adds no turn or message',async()=>{
 const {handleChatInput}=await import('../src/server/chat-handler.ts'),{createLearningAgent}=await import('../src/agent/teacher-agent.ts'),{runningTurn}=await import('../src/server/turn-runs.ts');
 const f=await session();stores.chatStore.saveSettings(f.chat.id,{model:{provider:'openrouter',id:'openai/gpt-4.1'}});const a=stores.scratchpadStore.capture(f.chat.id,'derivation',id(),1,image),faux=createFauxCore({});let calls=0;
 faux.setResponses([context=>{calls++;assert(context.messages.some(m=>m.role==='user'&&Array.isArray(m.content)&&m.content.some(p=>p.type==='image'&&p.data===Buffer.from(image).toString('base64'))));return fauxAssistantMessage([fauxText('Use the tower property at the inner conditional expectation.')]);}]);
 const build=(opts:Parameters<typeof createLearningAgent>[3])=>createLearningAgent({chatId:f.chat.id,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}});
 const result=await handleChatInput(f.chat.id,{type:'scratchpad',attemptId:a.id},build);assert.equal(result.status,200,await result.text());const run=runningTurn(f.chat.id);if(run)await new Response(run.subscribe()).text();
 const record=stores.chatStore.getChat(f.chat.id)!;assert.equal(calls,1);assert.equal(record.messages.filter(m=>m.id===a.id).length,1);assert(record.messages.some(m=>m.role==='assistant'));assert(!JSON.stringify(record).includes(Buffer.from(image).toString('base64')));
 const duplicate=await handleChatInput(f.chat.id,{type:'scratchpad',attemptId:a.id},build);assert.equal(duplicate.status,200);assert.equal((await handleChatInput(f.chat.id,{type:'continue',scratchpadAttemptId:a.id},build)).status,200);assert.equal(calls,1);assert.equal(stores.chatStore.getChat(f.chat.id)!.messages.filter(m=>m.id===a.id).length,1);
});

test('lesson sends only the latest drawing and can inspect an older submitted drawing for one inference', async () => {
 const {handleChatInput} = await import('../src/server/chat-handler.ts');
 const {createLearningAgent} = await import('../src/agent/teacher-agent.ts');
 const {runningTurn} = await import('../src/server/turn-runs.ts');
 const {fauxToolCall} = await import('@earendil-works/pi-ai');
 const f = await session();
 const chatId = f.chat.id;
 stores.chatStore.saveSettings(chatId, {model:{provider:'openrouter',id:'openai/gpt-4.1'}});
 const older = stores.scratchpadStore.capture(chatId, 'derivation', id(), 1, image);
 const latestPng = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10"/></svg>').render().asPng();
 const latest = stores.scratchpadStore.capture(chatId, 'derivation', id(), 1, latestPng);
 const unsent = stores.scratchpadStore.capture(chatId, 'derivation', id(), 1, image);
 stores.chatStore.saveMessages(chatId, [scratchAttemptMessage(older)]);
 const faux = createFauxCore({});
 const olderPixels = image.toString('base64'), latestPixels = latestPng.toString('base64');
 let calls = 0;
 faux.setResponses([
  context => {
   calls++;
   const history = JSON.stringify(context.messages);
   assert(history.includes(older.id));
   assert(!history.includes(olderPixels));
   assert(history.includes(latestPixels));
   return fauxAssistantMessage([
    fauxToolCall('read_scratchpad', {attemptId: older.id}, {id:'read-older'}),
    fauxToolCall('read_scratchpad', {attemptId: unsent.id}, {id:'read-unsent'}),
   ], {stopReason:'toolUse'});
  },
  context => {
   calls++;
   const results = context.messages.filter(m => m.role === 'toolResult');
   assert(results.some(m => m.content.some(block => block.type === 'image' && block.data === olderPixels)));
   assert(results.some(m => m.isError && JSON.stringify(m.content).includes('not submitted')));
   return fauxAssistantMessage([fauxToolCall('read_scratchpad', {}, {id:'list-drawings'})], {stopReason:'toolUse'});
  },
  context => {
   calls++;
   const history = JSON.stringify(context.messages);
   assert(!history.includes(olderPixels));
   assert(history.includes(latestPixels));
   const list = context.messages.find(m => m.role === 'toolResult' && JSON.stringify(m.content).includes('drawings'));
   assert(list && JSON.stringify(list.content).includes(older.id));
   assert(!JSON.stringify(list.content).includes(unsent.id));
   return fauxAssistantMessage([fauxText('The two drawings use different first steps.')]);
  },
 ]);
 const build = (opts: Parameters<typeof createLearningAgent>[3]) =>
  createLearningAgent({chatId,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},
   stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}});
 const result = await handleChatInput(chatId, {type:'scratchpad',attemptId:latest.id}, build);
 assert.equal(result.status, 200);
 const run = runningTurn(chatId);
 if (run) await new Response(run.subscribe()).text();
 assert.equal(calls, 3);
 const record = JSON.stringify(stores.chatStore.getChat(chatId));
 assert(record.includes('different first steps'));
 assert(!record.includes(olderPixels));
 assert(!record.includes(latestPixels));
});

test('pending feedback and its follow-up retry keep the drawing, then ordinary chat stops sending it', async () => {
 const {handleChatInput} = await import('../src/server/chat-handler.ts');
 const {createLearningAgent} = await import('../src/agent/teacher-agent.ts');
 const {runningTurn} = await import('../src/server/turn-runs.ts');
 const {newCompactionMarker} = await import('../src/core/compaction.ts');
 const f = await session();
 const chatId = f.chat.id;
 stores.chatStore.saveSettings(chatId, {model:{provider:'openrouter',id:'openai/gpt-4.1'}});
 const attempt = stores.scratchpadStore.capture(chatId, 'derivation', id(), 1, image);
 const marker = scratchAttemptMessage(attempt);
 const faux = createFauxCore({});
 const pixels = image.toString('base64');
 const hasDrawing = (messages: unknown) => JSON.stringify(messages).includes(pixels);
 const step = (expected: boolean, answer: string) => (context: {messages: unknown}) => {
  assert.equal(hasDrawing(context.messages), expected);
  return fauxAssistantMessage(answer);
 };
 faux.setResponses([
  step(true, 'The first equality is correct.'),
  step(true, 'Check the next line.'),
  step(true, 'The correction preserves the sign.'),
  step(false, 'Let us move to the next concept.'),
 ]);
 const build = (opts: Parameters<typeof createLearningAgent>[3]) =>
  createLearningAgent({chatId,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},
   stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}});
 const run = async (input: Parameters<typeof handleChatInput>[1]) => {
  const reply = await handleChatInput(chatId, input, build);
  assert.equal(reply.status, 200);
  const turn = runningTurn(chatId);
  if (turn) await new Response(turn.subscribe()).text();
 };
 const tail = {...fauxAssistantMessage('Kept reasoning.'), id: 'kept'};
 const cut = newCompactionMarker('Saved reasoning summary.', {firstKeptMessageId: 'kept', tokensBefore: 1000, at: 'fixture'});
 const compacted = [marker, tail, cut];
 assert(!hasDrawing(toLlmMessages(scratchImages(chatId, asAgentMessages(compacted), true, attempt.id))));
 assert(hasDrawing(toLlmMessages(scratchImages(chatId, asAgentMessages(compacted), true, attempt.id, true))));
 stores.chatStore.saveMessages(chatId, [marker]);
 await run({type: 'continue', scratchpadAttemptId: attempt.id});
 await run({type: 'text', text: 'Why is the sign positive on my drawing?'});
 const messages = stores.chatStore.getChat(chatId)!.messages;
 const last = messages.at(-1)!;
 assert(last.role === 'assistant');
 stores.chatStore.saveMessages(chatId, [...messages.slice(0, -1), {...last, stopReason: 'error'}]);
 await run({type: 'retry'});
 await run({type: 'text', text: 'Move on to the next result.'});
 assert(stores.chatStore.getChat(chatId)!.messages.some(m => JSON.stringify(m.content).includes('move to the next concept')));
 assert(!JSON.stringify(stores.chatStore.getChat(chatId)).includes(pixels));
});

test('a capture interrupted after image write retries safely with the same token',()=>{
 const {store,draft}=fixture(),token=id(),rename=fs.renameSync;fs.renameSync=((from,to)=>{if(String(to).endsWith(`${token}.json`))throw new Error('injected snapshot failure');return rename(from,to);}) as typeof fs.renameSync;
 try{assert.throws(()=>store.capture('chat','derivation',token,1,image),/snapshot failure/);}finally{fs.renameSync=rename;}
 assert.deepEqual(store.read('chat','derivation'),draft);assert.equal(store.list('chat','derivation').length,0);assert.equal(store.capture('chat','derivation',token,1,image).number,1);assert.equal(store.list('chat','derivation').length,1);
});

test('switching targets keeps separate drafts and still permits flushing the prior derivation',async()=>{
 const f=await session(),plan=structuredClone(f.lesson.plan);plan.derivations.push({id:'other',nodeId:'topic_0',title:'Other',start:'Assume C.',finish:'Show D.',status:'working'});plan.activeDerivationId='other';stores.lessonStore.save(f.chat.id,{expectedRevision:1,status:'active',plan});
 const request=new Request('http://local/scratchpad',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({padId:'derivation',draft:{expectedRevision:1,target:f.draft.target,scene,text:'Last pen strokes before switching'}})});
 assert.equal((await scratchpadResponse(request,f.chat.id)).status,200);assert.equal(stores.scratchpadStore.read(f.chat.id,'derivation')!.text,'Last pen strokes before switching');assert.equal(stores.scratchpadStore.read(f.chat.id,'other'),null);
});

test('a text-only model refuses handwriting before delivery and keeps the saved snapshot',async()=>{
 const {handleChatInput}=await import('../src/server/chat-handler.ts'),{piEngineForSpec}=await import('../src/agent/models.ts');const f=await session(),model={provider:'openrouter' as const,id:'openai/o3-mini'};
 assert(!piEngineForSpec(model,false).model.input.includes('image'));stores.chatStore.saveSettings(f.chat.id,{model});const a=stores.scratchpadStore.capture(f.chat.id,'derivation',id(),1,image),before=stores.chatStore.getChat(f.chat.id)!.messages;
 const r=await handleChatInput(f.chat.id,{type:'scratchpad',attemptId:a.id});assert.equal(r.status,422);assert.match((await r.json()).error,/image-capable/);assert.deepEqual(stores.chatStore.getChat(f.chat.id)!.messages,before);assert.equal(scratchDelivery(before,a.id),'ready');assert(stores.scratchpadStore.attempt(f.chat.id,a.id));
});

test('retained lesson scratchwork is immutable, restart-safe and survives removal of working pads',()=>{
 const folder=path.join(root,randomUUID()),store=createScratchpadStore(folder),draft=store.save('chat','derivation',0,{scene,text:'Working notes',target}),token=id();
 store.capture('chat','derivation',token,draft.revision,image);const note=store.retain('chat','derivation',draft,token);
 assert.deepEqual(store.retain('chat','derivation',draft,token),note);store.remove('chat');
 const restored=createScratchpadStore(folder);assert.deepEqual(restored.retained(note.id)!.draft,draft);assert.deepEqual(restored.retainedImage(note.id),image);
 const file=path.join(folder,'_retained',`${note.id}.json`),edited=JSON.parse(fs.readFileSync(file,'utf8'));edited.draft.text='Tampered';fs.writeFileSync(file,JSON.stringify(edited));assert.throws(()=>restored.retained(note.id),/corrupt/);
 assert.throws(()=>restored.retained('../outside'),/Invalid/);
});


test('ordinary Practice saves per-problem scratchpads and sends attempts through the existing practice agent',async()=>{
 const {fauxToolCall}=await import('@earendil-works/pi-ai'),{createPracticeAgent}=await import('../src/agent/teacher-agent.ts'),{handleChatInput}=await import('../src/server/chat-handler.ts'),{runningTurn}=await import('../src/server/turn-runs.ts');
 const chat=stores.chatStore.createChat('Practice drawing','practice');stores.chatStore.saveSettings(chat.id,{model:{provider:'openrouter',id:'openai/gpt-4.1'}});
 const initial=await scratchpadResponse(new Request('http://local/pad'),chat.id);assert.equal(initial.status,200);assert.equal((await initial.json()).target.id,'practice-draft');
 const messages=[{...fauxAssistantMessage([fauxToolCall('problem',{statement:'Prove the identity.',mode:'composition',modelSolution:'SECRET solution'},{id:'practice-call'})],{stopReason:'toolUse'}),id:'practice-pose'},{id:'practice-ack',role:'toolResult' as const,toolCallId:'practice-call',toolName:'problem',isError:false,content:[{type:'text' as const,text:'Problem posed'}],details:null,timestamp:Date.now()}];stores.chatStore.saveMessages(chat.id,messages);
 const target=practiceScratchTarget(messages)!;assert.equal(target.id,'practice-1');assert(!JSON.stringify(target).includes('SECRET'));assert.equal(practiceScratchTarget(messages,'practice-999'),null);
 const put=await scratchpadResponse(new Request('http://local/pad',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({padId:target.id,draft:{expectedRevision:0,target,scene,text:'My practice argument.'}})}),chat.id);assert.equal(put.status,200);
 const token=id(),capture=await scratchpadResponse(new Request('http://local/pad',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({padId:target.id,id:token,expectedRevision:1,image:`data:image/png;base64,${image.toString('base64')}`})}),chat.id);assert.equal(capture.status,200);
 const faux=createFauxCore({});faux.setResponses([context=>{assert(JSON.stringify(context.messages).includes('My practice argument.'));return fauxAssistantMessage([fauxText('Check the first equality in your argument.')]);}]);
 const reply=await handleChatInput(chat.id,{type:'scratchpad',attemptId:token},opts=>createPracticeAgent({chatId:chat.id,chatStore:stores.chatStore},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}}));assert.equal(reply.status,200);const run=runningTurn(chat.id);if(run)await new Response(run.subscribe()).text();assert(stores.chatStore.getChat(chat.id)!.messages.some(m=>m.id===token));assert.equal(stores.scratchpadStore.read(chat.id,target.id)!.text,'My practice argument.');
});
