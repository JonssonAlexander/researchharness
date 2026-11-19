import test,{after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {initialLesson,lessonPlan} from "../src/core/learning-session.ts";
import {applyLessonEdit} from "../src/core/lesson-edits.ts";
import {lessonMapLayers} from "../src/core/lesson-map-layout.ts";
import {createLearningSessionStore} from "../src/store/learning-session.ts";
import {lessonTools} from "../src/agent/tools/lesson.ts";
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lesson-edits-'));after(()=>fs.rmSync(root,{recursive:true,force:true}));
function plan(){const p=initialLesson('Understand covariance structure');p.nodes[0]!.notes='Existing intuition: $B_{tt}A$ scales the within-time sensor covariance.';p.nodes[0]!.progress='explored';p.nodes.push({id:'next',title:'Estimation',conceptId:null,tangent:false,notes:'Keep this equation: $\\widehat A$.'},{id:'side',title:'A tangent',conceptId:null,tangent:true});p.connections=[{from:'topic_0',to:'side'},{from:'topic_0',to:'next'}];p.derivations=[{id:'proof',nodeId:'topic_0',title:'A retained proof',start:'Known assumptions',finish:'The target equation',status:'working'}];p.activeDerivationId='proof';return p;}
const parsed=(result:{content:unknown[];details:unknown})=>JSON.parse(JSON.stringify(result.details));
test('live map reads are compact, topic reads expose whole notes and neighbours, and neither changes state',async()=>{
 const store=createLearningSessionStore(path.join(root,'reads')),first=store.create('chat',plan()),tools=lessonTools('chat',store,()=>assert.fail('read notified'));
 const overview=parsed(await tools.read_lesson!.execute('read',{},undefined));assert.deepEqual(overview.route,['topic_0','next']);assert.equal(overview.topics[0].hasNotes,true);assert(!JSON.stringify(overview).includes('within-time'));
 const detail=parsed(await tools.read_lesson!.execute('topic',{topicId:'topic_0'},undefined));assert.equal(detail.topic.notes,first.plan.nodes[0]!.notes);assert.deepEqual(detail.neighbours.map((n:{id:string})=>n.id),['next','side']);assert.equal(detail.derivations[0].finish,'The target equation');assert.deepEqual(store.read('chat'),first);
 await assert.rejects(()=>tools.read_lesson!.execute('missing',{topicId:'unknown'},undefined),/Unknown lesson topic/);
 store.save('chat',{expectedRevision:1,status:'finished',plan:first.plan});assert.equal(parsed(await tools.read_lesson!.execute('finished',{},undefined)).status,'finished');
});
test('a local edit retains unrelated content, publishes only after save, persists and rejects stale writes',async()=>{
 const dir=path.join(root,'writes'),store=createLearningSessionStore(dir),first=store.create('chat',plan());let notifications=0;
 const tools=lessonTools('chat',store,()=>notifications++),notes=first.plan.nodes[0]!.notes+' In our example, $B_{11}A$ sets the strength within time 1.';
 const result=parsed(await tools.edit_lesson!.execute('edit',{expectedRevision:1,topics:[{id:'topic_0',notes}],currentNodeId:'next'},undefined));
 const saved=createLearningSessionStore(dir).read('chat')!;assert.equal(result.revision,2);assert.deepEqual(result.changedTopicIds,["topic_0"]);assert(!JSON.stringify(result).includes(notes));assert.equal(saved.plan.activeDerivationId,null);assert.deepEqual(saved.plan.derivations,first.plan.derivations);assert.deepEqual(saved.plan.nodes.slice(1),first.plan.nodes.slice(1));assert.equal(saved.plan.nodes[0]!.progress,'explored');assert.deepEqual(saved.plan.connections,first.plan.connections);assert.equal(notifications,1);
 await assert.rejects(()=>tools.edit_lesson!.execute('stale',{expectedRevision:1,topics:[{id:'topic_0',notes:'Lost update'}]},undefined),/read_lesson/);assert.deepEqual(store.read('chat'),saved);assert.equal(notifications,1);
 store.save('chat',{expectedRevision:2,status:'finished',plan:saved.plan});await assert.rejects(()=>tools.edit_lesson!.execute('finished',{expectedRevision:3,currentNodeId:'topic_0'},undefined),/reopen/);assert.equal(notifications,1);
});
test('topic/order/association edits validate as one atomic plan without touching the original',()=>{
 const original=plan(),before=structuredClone(original),edited=applyLessonEdit(original,{expectedRevision:1,newTopics:[{id:'new',title:'Applications',conceptId:null,tangent:false}],topics:[{id:'next',title:'Covariance estimation',progress:'revisit'}],topicOrder:['topic_0','new','side','next'],addConnections:[{from:'new',to:'next'},{from:'next',to:'new'}],removeConnections:[{from:'side',to:'topic_0'}]});
 assert.deepEqual(lessonMapLayers(edited).order,['topic_0','new','next']);assert.equal(edited.connections.length,2);assert(edited.connections.some(e=>[e.from,e.to].includes('new')));assert.deepEqual(original,before);assert.deepEqual(edited.derivations,original.derivations);
 for(const edit of [{topics:[{id:'unknown',notes:'x'}]},{newTopics:[{...original.nodes[0]!}]},{topicOrder:['next','topic_0']},{addConnections:[{from:'next',to:'absent'}]},{addConnections:[{from:'next',to:'side'}],removeConnections:[{from:'side',to:'next'}]},{topics:[{id:'next',notes:'x'},{id:'next',notes:'y'}]},{topics:[{id:'next',conceptId:'ac_00000000-0000-4000-8000-000000000000'}]},{status:'finished'}])assert.throws(()=>applyLessonEdit(original,{expectedRevision:1,...edit} as never));
 assert.deepEqual(original,before);
});
test('new topics obey Atlas identity guards and failed persistence never notifies',async()=>{
 const store=createLearningSessionStore(path.join(root,'guards')),first=store.create('chat',plan());let notifications=0;
 const tools=lessonTools('chat',store,()=>notifications++,{read:()=>({atlas:{concepts:[]}})} as never);
 await assert.rejects(()=>tools.edit_lesson!.execute('bad-id',{expectedRevision:1,newTopics:[{id:'new',title:'New',conceptId:'ac_00000000-0000-4000-8000-000000000000',tangent:false}]},undefined),/existing Atlas/);assert.deepEqual(store.read('chat'),first);
 const failed=lessonTools('chat',{...store,save:()=>{throw new Error('Save failed');}},()=>notifications++);
 await assert.rejects(()=>failed.edit_lesson!.execute('failure',{expectedRevision:1,currentNodeId:'next'},undefined),/Save failed/);assert.equal(notifications,0);assert.deepEqual(store.read('chat'),first);
});
test('lesson route is view-only: tangents stay off it and no association is created',()=>{
 const p=plan(),before=JSON.stringify(p),layers=lessonMapLayers(p);assert.deepEqual(layers.route,[{from:'topic_0',to:'next'}]);assert.deepEqual(layers.branches,[{from:'topic_0',to:'side'}]);assert.deepEqual(layers.associations,[]);
 p.connections=[];assert.equal(lessonMapLayers(p).route.length,1);assert.equal(p.connections.length,0);assert.equal(lessonPlan.parse(JSON.parse(before)).nodes.length,3);
});

test('conversation fallback follows successful targeted focus edits, never failed edits or inspection',async()=>{
 const {fauxAssistantMessage,fauxToolCall,fauxText}=await import('@earendil-works/pi-ai');
 const {lessonTopicDetail}=await import('../src/core/lesson-topic.ts');
 const {learningSession}=await import('../src/core/learning-session.ts');
 const p=plan();delete p.nodes[0]!.notes;delete p.nodes[1]!.notes;
 const lesson=learningSession.parse({schemaVersion:1,revision:1,status:'active',plan:p});
 const call=(name:string,args:Parameters<typeof fauxToolCall>[1],id:string)=>({...fauxAssistantMessage([fauxToolCall(name,args,{id})],{stopReason:'toolUse'}),id:`msg-${id}`});
 const result=(name:string,id:string,isError=false)=>({id:`result-${id}`,role:'toolResult' as const,toolCallId:id,toolName:name,isError,content:[{type:'text' as const,text:'Result'}],details:null,timestamp:Date.now()});
 const messages=[call('update_lesson',{plan:p},'init'),result('update_lesson','init'),call('read_lesson',{topicId:'next'},'inspect'),result('read_lesson','inspect'),call('edit_lesson',{currentNodeId:'next'},'failed'),result('edit_lesson','failed',true),{...fauxAssistantMessage([fauxText('Original topic explanation.')]),id:'first'},call('edit_lesson',{currentNodeId:'next'},'focus'),result('edit_lesson','focus'),{...fauxAssistantMessage([fauxText('New topic equation: $$x=1.$$')]),id:'second'}];
 assert.equal(lessonTopicDetail(lesson,messages,'topic_0')!.text,'Original topic explanation.');assert.equal(lessonTopicDetail(lesson,messages,'next')!.text,'New topic equation: $$x=1.$$');
});

test('hierarchy and equation edits validate parents and preserve metadata on later full updates',async()=>{
 const store=createLearningSessionStore(path.join(root,'hierarchy')),original=store.create('chat',plan()),tools=lessonTools('chat',store,()=>{});
 await tools.edit_lesson!.execute('hierarchy',{expectedRevision:1,topics:[{id:'side',kind:'detail',parentId:'topic_0',formula:'B_{11}A'}]},undefined);
 const tree=parsed(await tools.read_lesson!.execute('family',{topicId:'topic_0'},undefined));assert.equal(tree.children[0].id,'side');const batch=parsed(await tools.read_lesson!.execute('batch',{topicIds:['side','topic_0']},undefined));assert.equal(batch.selected[0].topic.formula,'B_{11}A');
 const saved=store.read('chat')!,full=structuredClone(saved.plan);delete full.nodes[2]!.kind;delete full.nodes[2]!.parentId;delete full.nodes[2]!.formula;
 await tools.update_lesson!.execute('preserve',{expectedRevision:2,plan:full},undefined);assert.deepEqual(store.read('chat')!.plan.nodes[2],saved.plan.nodes[2]);assert.deepEqual(saved.plan.derivations,original.plan.derivations);
 for(const topics of [[{id:'side',parentId:'absent'}],[{id:'side',parentId:'side'}],[{id:'side',parentId:'next'},{id:'next',parentId:'side'}],[{id:'next',kind:'detail'}]])await assert.rejects(()=>tools.edit_lesson!.execute('bad',{expectedRevision:3,topics},undefined));
 assert.equal(store.read('chat')!.revision,3);
});

test('current/batched reads retain complete notes while edit receipts stay small',async()=>{
 const store=createLearningSessionStore(path.join(root,'lean')),initial=store.create('chat',plan()),tools=lessonTools('chat',store,()=>{});
 const current=parsed(await tools.read_lesson!.execute('current',{scope:'current'},undefined));assert.equal(current.topic.id,'topic_0');assert.equal(current.topic.notes,initial.plan.nodes[0]!.notes);assert.equal(current.activeDerivationId,'proof');
 const batch=parsed(await tools.read_lesson!.execute('batch',{topicIds:['topic_0','next']},undefined));assert.equal(batch.selected.length,2);assert.equal(batch.selected[1].topic.notes,initial.plan.nodes[1]!.notes);
 await assert.rejects(()=>tools.read_lesson!.execute('mixed',{topicId:'next',topicIds:['next']},undefined),/not both/);
 const notes='A complete saved mathematical explanation. '.repeat(35),receipt=parsed(await tools.edit_lesson!.execute('edit',{expectedRevision:1,topics:[{id:'topic_0',notes}]},undefined));
 assert(JSON.stringify(receipt).length<500);assert(!JSON.stringify(receipt).includes(notes));assert.equal(store.read('chat')!.plan.nodes[0]!.notes,notes.trim());
});
