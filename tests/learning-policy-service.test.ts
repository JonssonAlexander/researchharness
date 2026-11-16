import test from 'node:test';
import assert from 'node:assert/strict';
import type {LhMessage} from '../src/core/native-messages.ts';
import type {LearningSession} from '../src/core/learning-session.ts';
import type {LessonDocument} from '../src/core/lesson-documents.ts';
import type {LearningEvent,LearningLedger,LearningPolicyStore} from '../src/core/learning-policy.ts';
import {createLearningPolicyService,learningReport,learningTimeline,saveLearningActivity} from '../src/server/learning-policy.ts';
import {activityStateAt,interactionExpiryCut} from '../components/use-learning-activity.ts';

function memoryStore():LearningPolicyStore{
 const ledgers=new Map<string,LearningLedger>();
 return {list:()=>[...ledgers.keys()],remove:id=>{ledgers.delete(id);},read:id=>structuredClone(ledgers.get(id)??{schemaVersion:1,revision:0,events:[]}),append(id,event){const old=ledgers.get(id)??{schemaVersion:1 as const,revision:0,events:[]};const prior=old.events.find(e=>e.id===event.id);if(prior){if(JSON.stringify(prior)!==JSON.stringify(event))throw new Error('identity conflict');return structuredClone(old);}const next={...old,revision:old.revision+1,events:[...old.events,structuredClone(event)]};ledgers.set(id,next);return structuredClone(next);}};
}
const concept='ac_11111111-1111-4111-8111-111111111111';
const lesson=():LearningSession=>({schemaVersion:1,revision:1,status:'active',plan:{objective:'Understand the theorem',nodes:[{id:'topic_1',title:'The theorem',conceptId:concept,tangent:false}],connections:[],currentNodeId:'topic_1',derivations:[{id:'deriv_1',nodeId:'topic_1',title:'Main argument',start:'Assume x > 0.',finish:'Show the inequality.',status:'working'}],activeDerivationId:'deriv_1'}});
const doc:LessonDocument={version:1,id:`ls_${'a'.repeat(64)}`,name:'notes.pdf',hash:'b'.repeat(64),kind:'pdf',size:1200,pages:4,createdAt:'2026-11-01T00:00:00.000Z'};
const user=(id:string):LhMessage=>({id,role:'user',content:[{type:'text',text:'I derived the inequality from the assumptions.'}],timestamp:Date.parse('2026-11-15T10:00:00Z')} as unknown as LhMessage);
const assistant=(id:string):LhMessage=>({id,role:'assistant',content:[{type:'text',text:'The proof follows by convexity.'}],timestamp:Date.parse('2026-11-15T10:01:00Z')} as unknown as LhMessage);
function fixture(){
 const store=memoryStore(),messages=[user('msg_user_1')],state:{lesson:LearningSession|null;messages:LhMessage[];docs:LessonDocument[];scratch:Set<string>;concepts:Set<string>;now:Date}={lesson:lesson(),messages:messages as LhMessage[],docs:[doc],scratch:new Set<string>(),concepts:new Set([concept]),now:new Date('2026-11-15T10:00:00.000Z')};
 const service=(turn='turn_1',model={provider:'openrouter',id:'model-a',thinking:'high'})=>createLearningPolicyService('chat_1',turn,model,{store,messages:()=>state.messages,lesson:()=>state.lesson,documents:()=>state.docs,scratchExists:id=>state.scratch.has(id),conceptExists:id=>state.concepts.has(id),clock:()=>state.now});
 const target=(id:string,revision:number,prerequisites:string[]=[],changes:Record<string,unknown>={})=>({id,revision,task:`Understand ${id}`,criterion:'Derive the claim from its assumptions.',importance:'central' as const,topicIds:['topic_1'],conceptIds:[concept],prerequisites,derivationIds:['deriv_1'],sources:[{documentId:doc.id,page:2}],...changes});
 const evidence=(id:string,changes:Record<string,unknown>={})=>({id,targetId:'target_a',kind:'derivation' as const,messageIds:['msg_user_1'],finding:'The learner justified each step.',outcome:'supported' as const,assistance:'none-observed' as const,delayed:false,...changes});
 return {store,state,service,target,evidence};
}

test('targets validate real lesson topics, canonical concepts, derivations and source page ranges',()=>{
 const f=fixture(),s=f.service();
 assert.deepEqual(s.target(f.target('target_a',1)),{id:'target_a',revision:1});
 assert.throws(()=>s.target(f.target('bad_topic',1,[],{topicIds:['imaginary']})),/actual saved lesson topic IDs/);
 assert.throws(()=>s.target(f.target('bad_concept',1,[],{conceptIds:['ac_22222222-2222-4222-8222-222222222222']})),/canonical concept IDs/);
 assert.throws(()=>s.target(f.target('bad_derivation',1,[],{derivationIds:['missing']})),/saved derivation IDs/);
 assert.throws(()=>s.target(f.target('bad_page',1,[],{sources:[{documentId:doc.id,page:5}]})),/actual page range/);
 const provenance=f.store.read('chat_1').events.find(e=>e.id==='target_target_a_1')!;
 assert.equal(provenance.sources?.[0]?.sha256,doc.hash);
});

test('target revisions increase monotonically and prerequisite graph remains acyclic',()=>{
 const f=fixture(),s=f.service();s.target(f.target('target_a',1));s.target(f.target('target_b',1,['target_a']));
 assert.throws(()=>s.target(f.target('target_a',2,['target_b'])),/acyclic/);
 assert.throws(()=>s.target(f.target('target_a',3)),/revision conflict/);
 assert.throws(()=>s.target(f.target('target_c',1,['missing'])),/Prerequisites/);
});

test('evidence accepts submitted learner work only and records stable reference hashes',()=>{
 const f=fixture(),s=f.service();s.target(f.target('target_a',1));
 assert.throws(()=>s.evidence(f.evidence('ev_assistant',{messageIds:['msg_assistant_1']})),/actual submitted learner work/);
 f.state.messages.push(assistant('msg_assistant_1'));
 assert.throws(()=>s.evidence(f.evidence('ev_assistant_2',{messageIds:['msg_assistant_1']})),/actual submitted learner work/);
 const first=f.state.messages[0]!;const result=s.evidence(f.evidence('ev_1')) as {id:string;assistance:string};
 assert.equal(result.id,'ev_1');
 const stored=f.store.read('chat_1').events.find(e=>e.id==='ev_1')!;
 const refs=(stored.data as {refs:{messageId:string;sha256:string;kind:string}[]}).refs;
 assert.equal(refs[0]!.messageId,'msg_user_1');assert.equal(refs[0]!.kind,'learner-message');
 assert.equal(refs[0]!.sha256,createHashForTest(first));
});

import {createHash as createHashImpl} from 'node:crypto';
function createHashForTest(value:unknown){return createHashImpl('sha256').update(JSON.stringify(value)).digest('hex');}

test('activity state expires interaction at ten seconds and preserves waiting/hidden distinctions',()=>{
 assert.equal(activityStateAt(9999,0,false,false),'interaction');
 assert.equal(activityStateAt(10000,0,false,false),'idle');
 assert.equal(activityStateAt(5000,0,true,false),'waiting');
 assert.equal(activityStateAt(5000,0,true,true),'hidden');
 assert.equal(interactionExpiryCut(0,90000,0),10000);
});

test('corrections append history while report summarizes only the superseding outcome',()=>{
 const f=fixture(),s=f.service();s.target(f.target('target_a',1));s.evidence(f.evidence('ev_1'));
 f.state.now=new Date('2026-11-15T10:05:00Z');
 s.evidence(f.evidence('ev_2',{kind:'correction',finding:'Correction: a hidden assumption was used.',outcome:'gap',assistance:'hint',supersedes:'ev_1'}));
 const events=f.store.read('chat_1').events.filter(e=>e.type==='evidence');assert.equal(events.length,2);
 const summary=learningReport(f.store,'chat_1').summary.evidence;
 assert.deepEqual(summary,{observations:1,independentSupported:0,delayedObservations:0});
});

test('stable evidence receipt is returned before rechecking changed context',()=>{
 const f=fixture(),s=f.service();s.target(f.target('target_a',1));const input=f.evidence('ev_1');const first=s.evidence(input);
 f.state.messages=[];f.state.lesson=null;
 assert.deepEqual(s.evidence(input),first);
 assert.throws(()=>s.evidence({...input,finding:'Different assessment'}),/receipt conflict/);
});

test('an explanation decision downgrades later claimed independence to unknown assistance',()=>{
 const f=fixture(),s=f.service();s.target(f.target('target_a',1));
 s.decide({targetId:'target_a',importance:'central',prerequisites:'ready',understanding:'uncertain',intent:'explain',vulnerableAssumption:false,revisit:false,transferOpportunity:false,predictionUseful:false,reason:'Learner asked for an explanation.'});
 const result=s.evidence(f.evidence('ev_after_explanation')) as {assistance:string};
 assert.equal(result.assistance,'unknown');
 assert.equal((f.store.read('chat_1').events.find(e=>e.id==='ev_after_explanation')!.data as {assistance:string}).assistance,'unknown');
});

test('delayed evidence requires a prior target observation at least one day old',()=>{
 const f=fixture(),s=f.service();s.target(f.target('target_a',1));
 assert.throws(()=>s.evidence(f.evidence('ev_early',{delayed:true})),/at least a day ago/);
 s.evidence(f.evidence('ev_1'));
 f.state.now=new Date('2026-11-16T10:00:01.000Z');
 f.state.messages.push({...user('msg_user_2'),timestamp:f.state.now.getTime()});
 assert.equal((s.evidence(f.evidence('ev_delayed',{delayed:true,messageIds:['msg_user_2']})) as {id:string}).id,'ev_delayed');
});

test('prompt, model and tool lineage is recorded across turns and service restarts',()=>{
 const f=fixture(),one=f.service('turn_1',{provider:'openrouter',id:'model-a',thinking:'high'});one.registerPrompt('teacher prompt A',undefined,'tools A');
 const second=f.service('turn_2',{provider:'anthropic',id:'model-b',thinking:'low'});second.registerPrompt('teacher prompt B',undefined,'tools B');
 const restarted=f.service('turn_3',{provider:'openrouter',id:'model-c',thinking:'medium'});restarted.registerPrompt('teacher prompt B',undefined,'tools B');
 const events=f.store.read('chat_1').events,policies=events.filter(e=>e.type==='policy'),turns=events.filter(e=>e.type==='turn');
 assert.equal(policies.length,2);assert.equal(turns.length,3);
 assert.equal(learningTimeline(f.store).versions.length,1);assert.equal(learningTimeline(f.store).versions[0]!.turns,3);
 assert.notEqual(policies[0]!.id,policies[1]!.id);
 assert.equal(turns[1]!.policyId,policies[1]!.id);assert.equal(turns[2]!.policyId,policies[1]!.id);
 assert.deepEqual(events.find(e=>e.type==='turn'&&e.turnId==='turn_2')?.model,{provider:'anthropic',id:'model-b',thinking:'low'});
 assert.deepEqual(policies[1]!.model,{provider:'anthropic',id:'model-b',thinking:'low'});
 assert.notEqual((policies[0]!.data as {promptHash:string}).promptHash,(policies[1]!.data as {promptHash:string}).promptHash);
 assert.match((policies[1]!.data as {toolsHash:string}).toolsHash,/^[a-f0-9]{64}$/);
 assert.equal((policies[1]!.data as {effectivePrompt:string}).effectivePrompt,'teacher prompt B');
});

test('activity intervals reject stale events and deduplicate or conflict by stable receipt',()=>{
 const store=memoryStore(),base={id:'1',tabId:'tab_1',start:Date.now()-1000,end:Date.now()-500,state:'interaction',surface:'chat'};
 const at=new Date(base.end);saveLearningActivity(store,'chat_1',base,at);
 const first=store.read('chat_1');saveLearningActivity(store,'chat_1',base,at);assert.deepEqual(store.read('chat_1'),first);
 assert.throws(()=>saveLearningActivity(store,'chat_1',{...base,state:'idle'},at),/receipt conflict/);
 assert.throws(()=>saveLearningActivity(store,'chat_1',{...base,id:'2'},new Date(base.end+121000)),/stale/);
 assert.equal(learningReport(store,'chat_1').summary.time.milliseconds.interaction,500);
});
