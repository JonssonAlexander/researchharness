import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activityInput, decideLearning, decisionContext, evidenceInput, learningTarget, summarizeActivity, type DecisionContext, type LearningEvent } from '../src/core/learning-policy.ts';
import { createLearningPolicyStore } from '../src/store/learning-policy.ts';

const context=(overrides:Partial<DecisionContext>={}):DecisionContext=>({intent:'auto',importance:'central',prerequisites:'ready',understanding:'uncertain',vulnerableAssumption:false,revisit:false,transferOpportunity:false,predictionUseful:false,reason:'Need independent evidence.',...overrides});

test('learning decisions honor explicit intent before policy priorities',()=>{
 assert.equal(decideLearning(context({intent:'explain',prerequisites:'gap'})).action,'explain');
 assert.equal(decideLearning(context({intent:'continue',importance:'peripheral'})).action,'continue');
 assert.equal(decideLearning(context({intent:'connect',vulnerableAssumption:true})).action,'connect');
 assert.equal(decideLearning(context({intent:'work'})).action,'reconstruct');
 assert.equal(decideLearning(context({intent:'work',prerequisites:'unknown'})).action,'explain');
});

test('automatic policy covers prerequisite, priority, challenge, transfer, retrieval and pacing branches',()=>{
 const cases:[Partial<DecisionContext>,string][]=[
  [{prerequisites:'gap'},'explain'],[{importance:'peripheral',vulnerableAssumption:true},'continue'],
  [{vulnerableAssumption:true,transferOpportunity:true},'challenge'],[{transferOpportunity:true,revisit:true},'connect'],
  [{revisit:true,understanding:'assisted'},'retrieve'],[{understanding:'independent',predictionUseful:true},'continue'],
  [{predictionUseful:true},'predict'],[{},'reconstruct']
 ];
 for(const [input,action] of cases)assert.equal(decideLearning(context(input)).action,action);
 assert.equal(decisionContext.parse(context({intent:'auto'})).intent,'auto');
});

test('target, evidence and activity schemas reject malformed IDs, references and intervals',()=>{
 const target={id:'target_1',revision:1,task:'Derive the identity',criterion:'State assumptions and justify each step',importance:'central',topicIds:['topic_1'],conceptIds:['concept_1'],prerequisites:[],sources:[{documentId:'paper_1',page:2}]};
 assert.equal(learningTarget.parse(target).id,'target_1');
 assert(!learningTarget.safeParse({...target,id:'bad id'}).success);
 assert(!learningTarget.safeParse({...target,sources:[{documentId:'paper_1',page:0}]}).success);
 const evidence={id:'ev_1',targetId:'target_1',kind:'derivation',messageIds:['msg_1'],finding:'The argument omits a boundary case.',outcome:'gap',assistance:'none-observed',delayed:false};
 assert.equal(evidenceInput.parse(evidence).outcome,'gap');
 assert(!evidenceInput.safeParse({...evidence,messageIds:[]}).success);
 assert(!evidenceInput.safeParse({...evidence,unreviewed:true}).success);
 const activity={id:'act_1',tabId:'tab_1',start:100,end:500,state:'interaction',surface:'chat'};
 assert(activityInput.safeParse(activity).success);
 assert(!activityInput.safeParse({...activity,end:100}).success);
 assert(!activityInput.safeParse({...activity,end:36000}).success);
 assert(!activityInput.safeParse({...activity,extra:'field'}).success);
});

test('activity intervals union overlapping tabs with conservative state precedence',()=>{
 const result=summarizeActivity([
  {id:'a',tabId:'one',start:0,end:10000,state:'interaction',surface:'chat'},
  {id:'b',tabId:'two',start:5000,end:15000,state:'idle',surface:'reading'},
  {id:'c',tabId:'three',start:8000,end:12000,state:'waiting',surface:'review'},
  {id:'d',tabId:'four',start:12000,end:20000,state:'hidden',surface:'scratchpad'}
 ]);
 assert.deepEqual(result.milliseconds,{interaction:10000,waiting:2000,hidden:5000,idle:3000});
 assert.match(result.interpretation,/not measured thinking or mastery/);
});

const event=(id:string):LearningEvent=>({id,at:'2026-11-15T10:00:00.000Z',type:'decision',policyId:'policy_1',data:{action:'explain'}});
function temporaryStore(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'learning-policy-'));return {root,store:createLearningPolicyStore(root),cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};}

test('learning ledger survives restart and identical event append is idempotent',()=>{
 const f=temporaryStore();try{
  const first=f.store.append('chat_1',event('decision_1'));
  assert.equal(first.revision,1);
  const restarted=createLearningPolicyStore(f.root);
  assert.deepEqual(restarted.read('chat_1'),first);
  assert.deepEqual(restarted.append('chat_1',event('decision_1')),first);
  assert.equal(restarted.read('chat_1').revision,1);
  assert.throws(()=>restarted.read('../escape'),/Invalid learning session ID/);
 }finally{f.cleanup();}
});

test('event identity conflicts fail and atomic write failure preserves the prior ledger',()=>{
 const f=temporaryStore();try{
  f.store.append('chat_1',event('decision_1'));
  assert.throws(()=>f.store.append('chat_1',{...event('decision_1'),data:{action:'connect'}}),/identity conflict/);
  const before=fs.readFileSync(path.join(f.root,'chat_1.json'),'utf8');
  const original=fs.renameSync;
  fs.renameSync=function(from,to){if(to===path.join(f.root,'chat_1.json'))throw Object.assign(new Error('simulated disk failure'),{code:'EIO'});return original.call(fs,from,to);};
  try{assert.throws(()=>f.store.append('chat_1',event('decision_2')),/simulated disk failure/);}finally{fs.renameSync=original;}
  assert.equal(fs.readFileSync(path.join(f.root,'chat_1.json'),'utf8'),before);
  assert.equal(f.store.read('chat_1').revision,1);
  assert.deepEqual(fs.readdirSync(f.root),['chat_1.json']);
 }finally{f.cleanup();}
});

test('activity crossing a policy change retains exact spans without retroactive attribution',async()=>{
 const {saveLearningActivity,learningTimeline}=await import('../src/server/learning-policy.ts');const f=temporaryStore();try{
  f.store.append('chat_1',{id:'p1',at:new Date(1000).toISOString(),type:'policy',policyId:'p1',data:{version:'one'}});
  f.store.append('chat_1',{id:'t1',at:new Date(1000).toISOString(),type:'turn',policyId:'p1',data:{}});
  f.store.append('chat_1',{id:'p2',at:new Date(2000).toISOString(),type:'policy',policyId:'p2',data:{version:'two'}});
  f.store.append('chat_1',{id:'t2',at:new Date(2000).toISOString(),type:'turn',policyId:'p2',data:{}});
  saveLearningActivity(f.store,'chat_1',{id:'span',tabId:'tab',start:500,end:3000,state:'interaction',surface:'chat'},new Date(3000));
  const event=f.store.read('chat_1').events.at(-1)!;assert.equal(event.policyId,null);assert.deepEqual(event.policySpans,[{start:500,end:1000,policyId:null},{start:1000,end:2000,policyId:'p1'},{start:2000,end:3000,policyId:'p2'}]);
  const timeline=learningTimeline(f.store);assert.equal(timeline.comparison[0]!.time.milliseconds.interaction,1000);assert.equal(timeline.comparison[1]!.time.milliseconds.interaction,1000);
 }finally{f.cleanup();}
});
