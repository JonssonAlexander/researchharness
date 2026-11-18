import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
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

test('event conflicts and transactional failures preserve the prior ledger',()=>{
 const f=temporaryStore();try{
  f.store.append('chat_1',event('decision_1'));
  assert.throws(()=>f.store.append('chat_1',{...event('decision_1'),data:{action:'connect'}}),/identity conflict/);
  const db=new DatabaseSync(path.join(f.root,'learning.sqlite'));db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END");db.close();
  assert.throws(()=>f.store.append('chat_1',event('decision_2')),/simulated disk failure/);
  assert.equal(f.store.read('chat_1').revision,1);
 }finally{f.cleanup();}
});

test('legacy import resumes after failure, preserves source and survives backup and deletion',async()=>{
 const f=temporaryStore();try{
  const events=[event('decision_1'),{...event('activity_a'),type:'activity' as const,data:{id:'a',tabId:'tab',start:0,end:1000,state:'idle',surface:'chat'}}];
  const original=JSON.stringify({schemaVersion:1,revision:2,events});fs.writeFileSync(path.join(f.root,'chat_1.json'),original);
  f.store.read('initialize');let db=new DatabaseSync(path.join(f.root,'learning.sqlite'));
  db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'interrupted import'); END");db.close();
  assert.throws(()=>f.store.read('chat_1'),/interrupted import/);assert.equal(fs.readFileSync(path.join(f.root,'chat_1.json'),'utf8'),original);
  db=new DatabaseSync(path.join(f.root,'learning.sqlite'));db.exec('DROP TRIGGER fail_import');db.close();
  assert.deepEqual(f.store.read('chat_1').events,events);assert.deepEqual(createLearningPolicyStore(f.root).read('chat_1').events,events);
  const restored=path.join(f.root,'restore');fs.mkdirSync(restored);db=new DatabaseSync(path.join(f.root,'learning.sqlite'));await backup(db,path.join(restored,'learning.sqlite'));db.close();
  assert.deepEqual(createLearningPolicyStore(restored).read('chat_1').events,events);
  f.store.remove('chat_1');assert.equal(f.store.read('chat_1').revision,0);assert(!fs.existsSync(path.join(f.root,'chat_1.json')));
 }finally{f.cleanup();}
});

test('corrupt legacy and future database schemas fail without replacing data',()=>{
 const f=temporaryStore();try{
  const file=path.join(f.root,'chat_1.json');fs.writeFileSync(file,'{"schemaVersion":2,"revision":0,"events":[]}');
  assert.throws(()=>f.store.read('chat_1'),/Unsupported learning ledger/);assert.match(fs.readFileSync(file,'utf8'),/schemaVersion/);
  const db=new DatabaseSync(path.join(f.root,'learning.sqlite'));db.exec('PRAGMA user_version=2');db.close();
  assert.throws(()=>f.store.read('chat_1'),/Unsupported learning database version/);
 }finally{f.cleanup();}
});

test('failed deletion preserves recoverable legacy or migrated history',()=>{
 const f=temporaryStore();try{
  f.store.read('initialize');
  const file=path.join(f.root,'chat_1.json'),original=JSON.stringify({schemaVersion:1,revision:1,events:[event('decision_1')]});
  fs.writeFileSync(file,original);
  const db=new DatabaseSync(path.join(f.root,'learning.sqlite'));db.exec('BEGIN IMMEDIATE');
  try{assert.throws(()=>f.store.remove('chat_1'),/locked/);assert.equal(fs.readFileSync(file,'utf8'),original);}finally{db.exec('ROLLBACK');db.close();}
  const remove=fs.rmSync;fs.rmSync=((name,...args)=>{if(name===file)throw new Error('unlink failed');return remove(name,...args);}) as typeof fs.rmSync;
  try{assert.throws(()=>f.store.remove('chat_1'),/unlink failed/);}finally{fs.rmSync=remove;}
  assert.equal(fs.readFileSync(file,'utf8'),original);
  assert.deepEqual(createLearningPolicyStore(f.root).read('chat_1').events,[event('decision_1')]);
 }finally{f.cleanup();}
});

test('database permissions are private and corrupt databases fail closed',()=>{
 const f=temporaryStore();try{
  f.store.append('chat_1',event('decision_1'));
  const file=path.join(f.root,'learning.sqlite');
  assert.equal(fs.statSync(f.root).mode & 0o777,0o700);
  assert.equal(fs.statSync(file).mode & 0o777,0o600);
  fs.writeFileSync(file,'damaged database');
  assert.throws(()=>f.store.read('chat_1'));
  assert.equal(fs.readFileSync(file,'utf8'),'damaged database');
 }finally{f.cleanup();}
});

test('activity receipt is idempotent and rejects a conflicting payload',async()=>{
 const {saveLearningActivity}=await import('../src/server/learning-policy.ts');const f=temporaryStore();try{
  const activity={id:'a',tabId:'tab',start:1000,end:2000,state:'idle',surface:'chat'};
  const read=f.store.read;f.store.read=()=>{throw new Error('Activity must not read the ledger');};
  saveLearningActivity(f.store,'chat_1',activity,new Date(2000));f.store.read=read;
  saveLearningActivity(f.store,'chat_1',activity,new Date(2000));
  assert.equal(f.store.read('chat_1').revision,1);
  assert.throws(()=>saveLearningActivity(f.store,'chat_1',{...activity,state:'interaction'},new Date(2000)),/receipt conflict/);
  assert.equal(f.store.read('chat_1').revision,1);
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
