import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'learning-policy-integration-'));
process.env.LH_DATA_DIR=path.join(root,'data');process.env.LH_AUTH_FILE=path.join(root,'auth.json');
process.env.OPENROUTER_API_KEY='test-key-presence-gate';
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {stores}=await import('../src/server/stores.ts');
const {initialLesson}=await import('../src/core/learning-session.ts');
const {handleChatInput}=await import('../src/server/chat-handler.ts');
const {createLearningAgent}=await import('../src/agent/teacher-agent.ts');
const {learningPolicyResponse,learningTimelineResponse}=await import('../src/server/learning-policy-http.ts');
const {createFauxCore,fauxAssistantMessage,fauxToolCall,fauxText}=await import('@earendil-works/pi-ai');
const {runningTurn}=await import('../src/server/turn-runs.ts');

test('native lesson turn persists targets, decisions and actual learner evidence under its effective policy',async()=>{
 const chat=stores.chatStore.createChat('Mathematical understanding');stores.chatStore.saveSettings(chat.id,{model:{provider:'openrouter',id:'z-ai/glm-5.3-flash'}});
 stores.lessonStore.create(chat.id,initialLesson('Understand conditional expectation'));
 const faux=createFauxCore({});faux.setResponses([
  ()=>fauxAssistantMessage([fauxToolCall('set_learning_target',{id:'tower',revision:1,task:'Reconstruct the tower argument',criterion:'Justify nested conditioning under stated assumptions',importance:'central',topicIds:['topic_0'],conceptIds:[],prerequisites:[],sources:[]},{id:'target_call'})],{stopReason:'toolUse'}),
  ()=>fauxAssistantMessage([fauxToolCall('choose_learning_action',{targetId:'tower',intent:'auto',importance:'central',prerequisites:'ready',understanding:'uncertain',vulnerableAssumption:false,revisit:false,transferOpportunity:false,predictionUseful:false,reason:'An important reachable argument needs independent evidence.'},{id:'decision_call'})],{stopReason:'toolUse'}),
  ()=>{const id=stores.chatStore.getChat(chat.id)!.messages.find(m=>m.role==='user')!.id;return fauxAssistantMessage([fauxToolCall('record_learning_evidence',{id:'tower_attempt',targetId:'tower',kind:'explanation',messageIds:[id],finding:'Learner states a proposed argument; assumptions still need checking.',outcome:'uncertain',assistance:'none-observed',delayed:false},{id:'evidence_call'})],{stopReason:'toolUse'});},
  ()=>fauxAssistantMessage([fauxText('The decisive idea is nested conditioning. Here is the missing condition.')])
 ]);
 const response=await handleChatInput(chat.id,{type:'text',text:'I think nested conditioning gives the tower identity.'},opts=>createLearningAgent({chatId:chat.id,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}}));
 assert.equal(response.status,200);const handle=runningTurn(chat.id);if(handle)await new Response(handle.subscribe()).text();
 const record=stores.chatStore.getChat(chat.id)!,events=stores.learningPolicy.read(chat.id).events;
 for(const type of ['policy','turn','target','decision','evidence'])assert(events.some(e=>e.type===type),type);
 const policy=events.find(e=>e.type==='policy')!,evidence=events.find(e=>e.type==='evidence')!;
 assert.equal(evidence.policyId,policy.id);assert.equal(evidence.model?.id,faux.getModel().id);
 assert(record.messages.some(m=>m.role==='assistant'&&JSON.stringify(m).includes('decisive idea')));
 assert.equal(stores.lessonStore.read(chat.id)!.plan.nodes[0]!.progress,undefined);
 assert.equal(stores.atlasStore.retrieval.items().length,0);
 assert.equal(record.messages.some(m=>m.role==='assistant'&&m.content.some(p=>p.type==='toolCall'&&p.name==='quiz')),false);
 const report=await learningPolicyResponse(new Request('http://localhost/api'),chat.id);assert.equal(report.status,200);assert.match(report.headers.get('Cache-Control')!,/no-store/);
 assert((await report.json()).events.some((e:{type:string})=>e.type==='evidence'));
 const timeline=await learningTimelineResponse().json();assert(timeline.policies.some((p:{id:string})=>p.id===policy.id));
});

test('activity API rejects cross-origin, unknown sessions and payload content; preserves repeat receipts',async()=>{
 const chat=stores.chatStore.createChat('Activity');stores.lessonStore.create(chat.id,initialLesson('Activity'));
 const interval={id:'1',tabId:'test_tab',start:Date.now()-1000,end:Date.now(),state:'idle',surface:'chat'};
 const request=(id:string,origin?:string)=>learningPolicyResponse(new Request('http://localhost/api',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{origin}: {})},body:JSON.stringify({action:'activity',interval})}),id);
 assert.equal((await request(chat.id,'http://evil.example')).status,403);
 assert.equal((await request('chat_missing')).status,404);
 assert.equal((await request(chat.id)).status,200);const revision=stores.learningPolicy.read(chat.id).revision;
 assert.equal((await request(chat.id)).status,200);assert.equal(stores.learningPolicy.read(chat.id).revision,revision);
 const invalid=new Request('http://localhost/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'activity',interval:{...interval,keys:'private'}})});
 assert.equal((await learningPolicyResponse(invalid,chat.id)).status,400);
});

test('failure to persist policy releases the turn while preserving the learner input',async()=>{
 const chat=stores.chatStore.createChat('Storage failure');stores.chatStore.saveSettings(chat.id,{model:{provider:'openrouter',id:'z-ai/glm-5.3-flash'}});stores.lessonStore.create(chat.id,initialLesson('Storage'));
 const append=stores.learningPolicy.append;stores.learningPolicy.append=()=>{throw new Error('Injected learning ledger failure');};
 try{const faux=createFauxCore({}),response=await handleChatInput(chat.id,{type:'text',text:'Please explain this.'},opts=>createLearningAgent({chatId:chat.id,chatStore:stores.chatStore,jobStore:stores.jobStore,spawn:()=>{}},stores.lessonStore,()=>{},{...opts,engine:{model:faux.getModel(),streamFn:faux.streamSimple}}));assert.equal(response.status,500);assert(stores.chatStore.getChat(chat.id)!.messages.some(m=>m.role==='user'));const {isTurnRunning}=await import('../src/server/turn-liveness.ts');assert.equal(isTurnRunning(chat.id),false);}finally{stores.learningPolicy.append=append;}
});

test('learning exports reuse Challenge outcome references without revealing the committed solution',async()=>{
 const chat=stores.chatStore.createChat('Related challenge history'),concept='ac_11111111-1111-4111-8111-111111111111',plan=initialLesson('Related concept');
 stores.atlasStore.save({kind:'concept',id:concept,expectedRevision:0,title:'Tower property',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[]});plan.nodes[0]!.conceptId=concept;stores.lessonStore.create(chat.id,plan);
 const {problem}=stores.problemStore.create({title:'Tower challenge',statement:'Prove the conditional expectation identity.',modelSolution:'SECRET_COMMITTED_SOLUTION',source:{kind:'generated',citation:'Test fixture only'},checking:'Statement and solution were checked by the test fixture, not formally verified.',conceptIds:[concept],techniqueIds:[]},chat.id,'problem_call',45);
 const data=await(await learningPolicyResponse(new Request('http://localhost/api'),chat.id)).json(),encoded=JSON.stringify(data);
 assert(encoded.includes(problem.id));assert(!encoded.includes('SECRET_COMMITTED_SOLUTION'));assert(!encoded.includes('checking'));
});

test('passive intervals attach to saved focus as an explicitly estimated target association',async()=>{
 const chat=stores.chatStore.createChat('Target time'),plan=initialLesson('Independent argument');stores.lessonStore.create(chat.id,plan);
 const {createLearningPolicyService}=await import('../src/server/learning-policy.ts');const service=createLearningPolicyService(chat.id,'time_turn',{provider:'test',id:'model',thinking:'low'},{store:stores.learningPolicy,messages:()=>[],lesson:()=>stores.lessonStore.read(chat.id),documents:()=>[],scratchExists:()=>false});
 service.registerPrompt('timing test');service.target({id:'time_target',revision:1,task:'Reconstruct the argument',criterion:'State the key step',importance:'central',topicIds:['topic_0'],conceptIds:[],prerequisites:[],sources:[]});
 const interval={id:'time_1',tabId:'tab_time',start:Date.now()-500,end:Date.now(),state:'interaction',surface:'scratchpad'};
 const result=await learningPolicyResponse(new Request('http://localhost/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'activity',interval})}),chat.id);assert.equal(result.status,200);
 const data=await(await learningPolicyResponse(new Request('http://localhost/api'),chat.id)).json();assert.equal(data.summary.targetTime[0].time.milliseconds.interaction,500);assert.match(data.events.at(-1).context.basis,/Estimated/);assert.equal(data.events.filter((e:{type:string})=>e.type==='evidence').length,0);
});
