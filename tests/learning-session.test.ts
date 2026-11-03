import test,{after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {focusLessonTopic,nextLessonTopic,initialLesson,lessonPlan} from "../src/core/learning-session.ts";
import {createLearningSessionStore} from "../src/store/learning-session.ts";
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-learning-'));
process.env.LH_DATA_DIR=path.join(root,'data');process.env.LH_AUTH_FILE=path.join(root,'auth.json');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {stores}=await import('../src/server/stores.ts');
const {POST}=await import('../app/api/chats/route.ts');
const {lessonResponse}=await import('../src/server/learning-session.ts');
const {lessonTools}=await import('../src/agent/tools/lesson.ts');

test('lesson plans retain map, tangents, Start/Finish and completion across restart with revision history',()=>{
 const dir=path.join(root,'isolated'),store=createLearningSessionStore(dir),plan=initialLesson('Understand stochastic calculus');
 plan.nodes.push({id:'tangent',title:'Generators and PDEs',conceptId:null,tangent:true});plan.connections.push({from:'topic_0',to:'tangent'});
 plan.derivations.push({id:'proof',nodeId:'topic_0',title:'Quadratic variation',start:'Standard Brownian motion; deterministic partitions.',finish:'Show the quadratic sums converge in L² to t.',status:'working'});plan.activeDerivationId='proof';
 const first=store.create('chat_fixture',plan),before=JSON.stringify(first);
 const next=store.save('chat_fixture',{expectedRevision:1,status:'active',plan:{...plan,currentNodeId:'tangent'}});
 assert.deepEqual(createLearningSessionStore(dir).read('chat_fixture'),next);assert.equal(fs.readFileSync(path.join(dir,'chat_fixture','revision-1.json'),'utf8'),before);
 assert.throws(()=>store.save('chat_fixture',{expectedRevision:1,status:'finished',plan}),/changed/);
 assert.deepEqual(store.read('chat_fixture'),next);assert.throws(()=>store.read('../outside'),/Invalid/);
 assert.throws(()=>lessonPlan.parse({...plan,activeDerivationId:'absent'}));assert.throws(()=>lessonPlan.parse({...plan,connections:[{from:'missing',to:'topic_0'}]}));
 store.save('chat_fixture',{expectedRevision:2,status:'finished',plan:{...next.plan,activeDerivationId:null,derivations:next.plan.derivations.map(d=>({...d,status:'finished'}))}});
 assert.equal(store.read('chat_fixture')!.status,'finished');assert.equal(store.read('chat_fixture')!.plan.derivations[0]!.finish,plan.derivations[0]!.finish);
});

test('lesson endpoint refuses stale and busy edits and preserves native history and canonical graph',async()=>{
 const response=await POST(new Request('http://test/api/chats',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Explore Brownian motion',learning:true})}));assert.equal(response.status,200);const {id}=await response.json();
 const lesson=stores.lessonStore.read(id)!,messages=stores.chatStore.getChat(id)!.messages,graph=stores.graphStore.readNodes();
 const update=(revision:number)=>lessonResponse(new Request('http://test/lesson',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:revision,status:'active',plan:{...lesson.plan,objective:'Updated objective'}})}),id);
 assert.equal((await update(1)).status,200);assert.equal((await update(1)).status,409);
 const {beginTurn,endTurn}=await import('../src/server/turn-liveness.ts');beginTurn(id);try{assert.equal((await update(2)).status,409);}finally{endTurn(id);}
 assert.deepEqual(stores.chatStore.getChat(id)!.messages,messages);assert.deepEqual(stores.graphStore.readNodes(),graph);
 const {POST:extract}=await import('../app/api/graph/coverage/extract/route.ts');assert.equal((await extract(new Request('http://test/extract',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chatId:id})}))).status,409);
 for(const body of [{title:'Legacy'},{title:'Practice',kind:'practice',learning:true}]){const r=await POST(new Request('http://test/api/chats',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));const {id}=await r.json();assert.equal(stores.lessonStore.read(id),null);}
});

test('agent updates a plan through its injected port, retains derivations, and cannot finish the learner’s work',async()=>{
 const store=createLearningSessionStore(path.join(root,'tool')),plan=initialLesson('Derive a result');plan.derivations=[{id:'proof',nodeId:'topic_0',title:'Result',start:'Assumptions',finish:'Precise target',status:'working'}];store.create('chat_tool',plan);
 let notified=0;const tool=lessonTools('chat_tool',store,()=>notified++).update_lesson!;
 await tool.execute('call',{expectedRevision:1,plan:{...plan,activeDerivationId:'proof',derivations:[{...plan.derivations[0],status:'finished'}]}},undefined);
 assert.equal(store.read('chat_tool')!.plan.derivations[0]!.status,'working');assert.equal(notified,1);
 await assert.rejects(()=>tool.execute('stale',{expectedRevision:1,plan},undefined),/changed/);
 await assert.rejects(()=>tool.execute('delete',{expectedRevision:2,plan:{...plan,derivations:[]}},undefined),/Retain/);
});

test('learning agent has conversational policy and no assessment/plan-gate tools',async()=>{
 const {createLearningAgent}=await import('../src/agent/teacher-agent.ts');const {createFauxCore}=await import('@earendil-works/pi-ai');
 const faux=createFauxCore({}),store=createLearningSessionStore(path.join(root,'agent')),lesson=store.create('chat_agent',initialLesson('Understand a result'));
 const agent=createLearningAgent({chatId:'chat_agent',chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},store,()=>{}, {engine:{model:faux.getModel(),streamFn:faux.streamSimple},learning:lesson});
 const names=agent.state.tools.map(t=>t.name);assert(names.includes('update_lesson'));for(const name of ['quiz','explain','recall','probe','probe_done','ask_user_question','plan_init'])assert(!names.includes(name));
 assert(agent.state.systemPrompt.includes('Do not run an initial prober'));assert(agent.state.systemPrompt.includes('Start (assumptions'));assert(agent.state.systemPrompt.includes('Understand a result'));
});

test('a conversational lesson streams a native plan update and prose without a pending question',async()=>{
 process.env.OPENROUTER_API_KEY='test-key-presence-gate';
 const {createLearningAgent}=await import('../src/agent/teacher-agent.ts'),{createFauxCore,fauxAssistantMessage,fauxToolCall,fauxText}=await import('@earendil-works/pi-ai');
 const {handleChatInput}=await import('../src/server/chat-handler.ts'),{danglingQuestionOf}=await import('../src/core/native-messages.ts');
 const chat=stores.chatStore.createChat('Concepts to proofs');stores.chatStore.saveSettings(chat.id,{model:{provider:'openrouter',id:'z-ai/glm-5.3-flash'}});
 const first=stores.lessonStore.create(chat.id,initialLesson('Understand quadratic variation')),plan=structuredClone(first.plan);plan.nodes.push({id:'variation',title:'Quadratic variation',conceptId:null,tangent:false});plan.connections.push({from:'topic_0',to:'variation'});
 const faux=createFauxCore({});faux.setResponses([()=>fauxAssistantMessage([fauxToolCall('update_lesson',{expectedRevision:1,plan},{id:'lesson_plan'})],{stopReason:'toolUse'}),()=>fauxAssistantMessage([fauxText('Start with the conceptual picture: quadratic variation measures accumulated squared increments.')])]);
 const response=await handleChatInput(chat.id,{type:'text',text:'Teach me the conceptual picture.'},opts=>{assert.equal(opts.teaching,true);assert(opts.learning);return createLearningAgent({chatId:chat.id,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}});});
 assert.equal(response.status,200);const {runningTurn}=await import("../src/server/turn-runs.ts"),handle=runningTurn(chat.id);const stream=handle?await new Response(handle.subscribe()).text():"already settled";
 assert.equal(stores.lessonStore.read(chat.id)!.revision,2,`${stream}\n${JSON.stringify(stores.chatStore.getChat(chat.id)!.messages)}`);assert.equal(stores.lessonStore.read(chat.id)!.plan.nodes.length,2);
 const record=stores.chatStore.getChat(chat.id)!;assert.equal(danglingQuestionOf(record.messages),null);assert(JSON.stringify(record.messages).includes('conceptual picture'));assert(record.messages.some(m=>m.role==='toolResult'));
});

test('a failed atomic lesson save keeps the last head and supports retry without losing its archive',()=>{
 const dir=path.join(root,'failure'),store=createLearningSessionStore(dir),first=store.create('chat_failure',initialLesson('Original objective')),rename=fs.renameSync;
 fs.renameSync=((from,to)=>{if(String(to)===path.join(dir,'chat_failure','current.json'))throw new Error('Injected head failure');return rename(from,to);}) as typeof fs.renameSync;
 try{assert.throws(()=>store.save('chat_failure',{expectedRevision:1,status:'active',plan:{...first.plan,objective:'New objective'}}),/Injected/);}finally{fs.renameSync=rename;}
 assert.deepEqual(store.read('chat_failure'),first);assert(fs.existsSync(path.join(dir,'chat_failure','revision-1.json')));
 assert.equal(store.save('chat_failure',{expectedRevision:1,status:'active',plan:{...first.plan,objective:'New objective'}}).revision,2);
});

test('opening a canonical derivation never truncates an oversized mathematical target',async()=>{
 const {startLesson}=await import('../src/server/learning-session.ts'),chat=stores.chatStore.createChat('Long precise target'),at='2026-10-30T00:00:00Z';
 for(const n of [{id:'n_assumption',name:'Assumption',statement:'Explicit assumptions.'},{id:'n_long_target',name:'Long target',statement:'x'.repeat(4100)}])stores.graphStore.appendNode({...n,aliases:[],createdAt:at,provenance:[]});
 stores.graphStore.appendChain({id:'arg_long_target',premises:['n_assumption'],conclusion:'n_long_target',createdAt:at,provenance:[]});
 const conceptId='ac_00000000-0000-4000-8000-000000000055';stores.atlasStore.save({kind:'concept',id:conceptId,expectedRevision:0,title:'Precise object',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:['n_long_target']});
 const lesson=startLesson(chat.id,'Set up a bounded target',{conceptIds:[conceptId],goal:'derive',derivation:{rootId:'n_long_target',targetId:'n_long_target',chainId:'arg_long_target'}});
 assert.equal(lesson.plan.derivations.length,0);assert.equal(stores.graphStore.readNodes().find(n=>n.id==='n_long_target')!.statement.length,4100);
});


test('topic transitions preserve coverage and learner-owned derivations across restart',async()=>{
 const dir=path.join(root,'progress'),store=createLearningSessionStore(dir),plan=initialLesson('Understand a result');
 plan.nodes[0]!.progress='explored';
 plan.nodes.push({id:'tangent',title:'A tangent',conceptId:null,tangent:true},{id:'next',title:'Application',conceptId:null,tangent:false});
 plan.derivations=[{id:'proof',nodeId:'topic_0',title:'Proof',start:'Start',finish:'Finish',status:'working'}];plan.activeDerivationId='proof';
 assert.equal(nextLessonTopic(plan)?.id,'next');
 assert.equal(focusLessonTopic(plan,'topic_0').activeDerivationId,'proof');
 assert.equal(focusLessonTopic(plan,'next').activeDerivationId,null);
 store.create('chat_progress',plan);
 const tool=lessonTools('chat_progress',store,()=>{}).update_lesson!;
 // A model can move focus without dropping prior coverage or completing a proof.
 const proposed=structuredClone(plan);delete proposed.nodes[0]!.progress;proposed.currentNodeId='next';
 await tool.execute('move',{expectedRevision:1,plan:proposed},undefined);
 const saved=createLearningSessionStore(dir).read('chat_progress')!;
 assert.equal(saved.plan.nodes[0]!.progress,'explored');assert.equal(saved.plan.activeDerivationId,null);
 assert.equal(saved.plan.derivations[0]!.status,'working');assert.equal(nextLessonTopic(saved.plan),undefined);
});

test('multi-concept creation preserves selected order and rejects duplicates before creating a chat',async()=>{
 const ids=[1,2].map(n=>`ac_00000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
 for(const [i,id] of ids.entries())stores.atlasStore.save({kind:'concept',id,expectedRevision:0,title:`Starting concept ${i}`,aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[]});
 const create=(conceptIds:string[])=>POST(new Request('http://test/api/chats',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Bridge these concepts',learning:true,atlasContext:{conceptIds,goal:'explain'}})}));
 const response=await create([...ids].reverse());assert.equal(response.status,200);const {id}=await response.json();assert.deepEqual(stores.lessonStore.read(id)!.plan.nodes.map(n=>n.conceptId),[...ids].reverse());
 const before=stores.chatStore.listChats().length;assert.equal((await create([ids[0]!,ids[0]!])).status,400);assert.equal(stores.chatStore.listChats().length,before);
});
test('Atlas tools are opt-in injected, plan updates reject fabricated concepts, and existing IDs survive',async()=>{
 const {createLearningAgent}=await import('../src/agent/teacher-agent.ts'),{createFauxCore}=await import('@earendil-works/pi-ai');
 const store=createLearningSessionStore(path.join(root,'aware-agent')),lesson=store.create('aware',initialLesson('A tailored route'));
 const reader={read:()=>({atlas:stores.atlasStore.read(),propositions:[],chains:[]}),lesson:()=>null},faux=createFauxCore({});
 const agent=createLearningAgent({chatId:'aware',chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},store,()=>{},{learning:lesson,engine:{model:faux.getModel(),streamFn:faux.streamSimple},atlasLookup:reader});
 const names=agent.state.tools.map(t=>t.name);assert(names.includes('search_atlas'));assert(names.includes('read_atlas'));assert(!names.includes('quiz'));assert(agent.state.systemPrompt.includes('assisted argument never establishes independent mastery'));
 const plan=structuredClone(lesson.plan);plan.nodes[0]!.conceptId='ac_00000000-0000-4000-8000-000000000099';
 const tool=agent.state.tools.find(t=>t.name==='update_lesson')!;await assert.rejects(()=>tool.execute('invalid',{expectedRevision:1,plan},undefined),/existing Atlas/);assert.equal(store.read('aware')!.revision,1);
});

test('a native lesson retrieves Atlas notes, plans a bridge and teaches without changing canonical knowledge',async()=>{
 process.env.OPENROUTER_API_KEY='test-key-presence-gate';
 const {createLearningAgent}=await import('../src/agent/teacher-agent.ts'),{createFauxCore,fauxAssistantMessage,fauxToolCall,fauxText}=await import('@earendil-works/pi-ai'),{handleChatInput}=await import('../src/server/chat-handler.ts'),{runningTurn}=await import('../src/server/turn-runs.ts');
 const conceptId='ac_00000000-0000-4000-8000-000000000003';stores.atlasStore.save({kind:'concept',id:conceptId,expectedRevision:0,title:'A known foundation',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[],markdown:'Previously discussed with substantial assistance.'});
 const chat=stores.chatStore.createChat('Bridge to an application');stores.chatStore.saveSettings(chat.id,{model:{provider:'openrouter',id:'z-ai/glm-5.3-flash'}});
 const lesson=stores.lessonStore.create(chat.id,initialLesson('Connect a foundation to an application',[{id:conceptId,title:'A known foundation'}])),plan=structuredClone(lesson.plan);plan.nodes.push({id:'application',title:'A new application',conceptId:null,tangent:false});plan.connections.push({from:'topic_0',to:'application'});
 const before=JSON.stringify([stores.atlasStore.read(),stores.graphStore.readNodes(),stores.graphStore.readChains()]),faux=createFauxCore({});
 faux.setResponses([
  ()=>fauxAssistantMessage([fauxToolCall('search_atlas',{query:'known foundation'},{id:'search_atlas_call'})],{stopReason:'toolUse'}),
  context=>{assert(JSON.stringify(context.messages).includes(conceptId));return fauxAssistantMessage([fauxToolCall('read_atlas',{kind:'concept',id:conceptId},{id:'read_atlas_call'})],{stopReason:'toolUse'});},
  context=>{assert(JSON.stringify(context.messages).includes('substantial assistance'));return fauxAssistantMessage([fauxToolCall('update_lesson',{expectedRevision:1,plan},{id:'bridge_plan'})],{stopReason:'toolUse'});},
  ()=>fauxAssistantMessage([fauxText('We will connect the foundation to the application, revisiting the key step as needed.')]),
 ]);
 const response=await handleChatInput(chat.id,{type:'text',text:'Plan a lesson from my foundation to the application.'},opts=>{assert(opts.atlasLookup);return createLearningAgent({chatId:chat.id,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}});});
 assert.equal(response.status,200);const run=runningTurn(chat.id);if(run)await new Response(run.subscribe()).text();
 assert.equal(stores.lessonStore.read(chat.id)!.revision,2);assert.equal(JSON.stringify([stores.atlasStore.read(),stores.graphStore.readNodes(),stores.graphStore.readChains()]),before);
 const messages=stores.chatStore.getChat(chat.id)!.messages;for(const name of ['search_atlas','read_atlas','update_lesson'])assert(messages.some(m=>m.role==='toolResult'&&m.toolName===name));
 // The existing global graph switch also disables the new read tools.
 const previousSettings=stores.settingsStore.readSettings()??{version:1 as const};stores.settingsStore.writeSettings({...previousSettings,graph:{...previousSettings.graph,enabled:false}});
 const disabled=createFauxCore({});disabled.setResponses([()=>fauxAssistantMessage([fauxText('We can continue from the current lesson context.')])]);
 const next=await handleChatInput(chat.id,{type:'text',text:'Continue.'},opts=>{assert.equal(opts.atlasLookup,undefined);return createLearningAgent({chatId:chat.id,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{...opts,engine:{model:disabled.getModel(),streamFn:disabled.streamSimple}});});
 assert.equal(next.status,200);const second=runningTurn(chat.id);if(second)await new Response(second.subscribe()).text();stores.settingsStore.writeSettings(previousSettings);
});

test('topic inspection reads existing teaching and whole equations without changing the current topic',async()=>{
 const {lessonTopicDetail}=await import('../src/core/lesson-topic.ts'),{fauxAssistantMessage,fauxText,fauxToolCall}=await import('@earendil-works/pi-ai');
 const chat=stores.chatStore.createChat('Inspectable lesson'),plan=initialLesson('Understand variance');plan.nodes.push({id:'variance',title:'Curvature extracts variance',conceptId:null,tangent:false});plan.currentNodeId='variance';const lesson=stores.lessonStore.create(chat.id,plan);
 const messages=[{...fauxAssistantMessage([fauxToolCall('update_lesson',{expectedRevision:1,plan},{id:'focus_variance'})],{stopReason:'toolUse'}),id:'plan-message'},{id:'focus-result',role:'toolResult' as const,toolCallId:'focus_variance',toolName:'update_lesson',isError:false,content:[{type:'text' as const,text:'Saved'}],details:null,timestamp:Date.now()},{...fauxAssistantMessage([fauxText('Curvature measures how the slope changes.\n\n$$d[F(X_t)] = F\u2032(X_t)dX_t + \\tfrac12 F\u2033(X_t)d[X]_t.$$\n\nThe second term captures accumulated variance.')]),id:'teaching-message'}];
 stores.chatStore.saveMessages(chat.id,messages);const before=JSON.stringify([stores.lessonStore.read(chat.id),stores.chatStore.getChat(chat.id),stores.atlasStore.read()]);
 const detail=lessonTopicDetail(lesson,messages,'variance');assert.equal(detail?.source,'From the lesson conversation');assert(detail?.text.includes('\\tfrac12'));assert.equal((detail!.text.match(/\$\$/g)??[]).length,2);
 const response=await lessonResponse(new Request(`http://test/lesson?topic=variance`),chat.id);assert.equal(response.status,200);assert.deepEqual((await response.json()).detail,detail);assert.equal(JSON.stringify([stores.lessonStore.read(chat.id),stores.chatStore.getChat(chat.id),stores.atlasStore.read()]),before);
 assert.equal((await lessonResponse(new Request('http://test/lesson?topic=absent'),chat.id)).status,404);
});
test('short topic notes take precedence, survive plan updates and old nodes need no migration',async()=>{
 const {lessonTopicDetail}=await import('../src/core/lesson-topic.ts'),store=createLearningSessionStore(path.join(root,'topic-notes')),plan=initialLesson('A clear route');plan.nodes[0]!.notes='The local variance rate is $\\sigma_t^2$. Symbols refer to the underlying process.';
 const original=store.create('notes',plan);assert.equal(lessonTopicDetail(original,[],'topic_0')?.text,plan.nodes[0]!.notes);const update=structuredClone(plan);delete update.nodes[0]!.notes;
 await lessonTools('notes',store,()=>{}).update_lesson!.execute('preserve',{expectedRevision:1,plan:update},undefined);assert.equal(store.read('notes')!.plan.nodes[0]!.notes,plan.nodes[0]!.notes);
 const legacy=store.create('legacy',initialLesson('An unexplored topic'));assert.equal(lessonTopicDetail(legacy,[],'topic_0')?.text,'');assert.equal(lessonTopicDetail(legacy,[],'missing'),null);
});
