import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createAtlasStore} from '../src/store/atlas.ts';
import {reviewDeck,reviewColour,retentionColour,reviewEdgeColour,reviewInterval,studyDay,nextReviewChange,REVIEW_LIMIT,publicReviewActivity,type ReviewItem,type ReviewHelpProposal} from '../src/core/retrieval.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-retrieval-'));process.env.LH_DATA_DIR=path.join(root,'profile');process.env.LH_AUTH_FILE=path.join(root,'auth.json');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {createRetrievalService}=await import('../src/server/retrieval.ts');
const {stores}=await import('../src/server/stores.ts');
const {createFauxCore}=await import('@earendil-works/pi-ai');
function fixture(count=1, help?:Parameters<typeof createRetrievalService>[5]){
 const file=path.join(root,randomUUID(),'atlas.sqlite'),atlas=createAtlasStore(file),ids=Array.from({length:count},()=>`ac_${randomUUID()}`);
 for(const [i,id] of ids.entries())atlas.save({kind:'concept',id,expectedRevision:0,title:`Concept ${i}`,aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[],markdown:`Source definition and assumptions ${i}.`});
 let now=new Date('2026-10-31T10:00:00Z'),calls=0;const faux=createFauxCore({});
 const service=createRetrievalService(atlas.retrieval,()=>atlas.read(),()=>new Date(now),()=>({model:faux.getModel(),streamFn:faux.streamSimple}),async(_engine,items)=>{calls++;return {front:'Explain the basic relationship between these objects.',back:'A concise symbolic explanation with essential assumptions.',criteria:items.map(i=>({itemId:i.id,text:`Explain ${i.title} independently.`}))};},help);
 const command=(raw:unknown)=>service.command(raw,new AbortController().signal);
 const enrol=async()=>{for(const id of ids)await command({action:'enrol',conceptId:id,expectedRevision:0,front:`Recall the key idea of ${id}.`,back:'The definition, conditions and a short symbolic argument.',paused:false});};
 const start=async(itemIds=atlas.retrieval.items().slice(0,1).map(i=>i.id))=>command({action:'start',id:`ra_${randomUUID()}`,itemIds,...itemIds.length>1?{consent:true,expectedModel:`${faux.getModel().provider}:${faux.getModel().id}`}:{}});
 return {file,atlas,ids,service,command,enrol,start,model:`${faux.getModel().provider}:${faux.getModel().id}`,calls:()=>calls,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
test('a real FSRS-7 review is durable, hidden until reveal, idempotent and never changes Atlas geometry or notes',async()=>{
 const f=fixture();await f.enrol();const before=JSON.stringify(f.atlas.read()),item=f.atlas.retrieval.items()[0]!,a=await f.start() as {id:string;revision:number;back?:string;items:unknown[]};
 assert.equal(a.back,undefined);assert(!JSON.stringify(a.items).includes(item.back));assert.equal(item.card.reps,0);
 await assert.rejects(()=>f.command({action:'rate',id:a.id,revision:a.revision,ratings:{[item.id]:3}}),/Attempt and reveal/);
 const shown=await f.command({action:'reveal',id:a.id,revision:a.revision,answer:'My independent reconstruction.',attempted:true}) as typeof a;assert.equal(shown.back,item.back);
 const rated=await f.command({action:'rate',id:a.id,revision:shown.revision,ratings:{[item.id]:3}}) as typeof a;
 const next=f.atlas.retrieval.items()[0]!;assert.equal(next.card.reps,1);assert(Date.parse(next.card.dueAt)>Date.parse(item.card.dueAt));assert.equal(next.config.model,'FSRS-7');assert.equal(next.config.library,'ts-fsrs@6.0.0');
 await f.command({action:'rate',id:a.id,revision:shown.revision,ratings:{[item.id]:3}});assert.equal(f.atlas.retrieval.events(item.id).length,1);assert.deepEqual(createAtlasStore(f.file).retrieval.items()[0],next);assert.equal(JSON.stringify(f.atlas.read()),before);assert.equal(f.calls(),0);
 assert.equal((await f.service.snapshot()).active,null);assert.equal((await f.service.snapshot()).last!.id,rated.id);
});
test('rating corrections replay effective history once and preserve the original event record',async()=>{
 const f=fixture();await f.enrol();const item=f.atlas.retrieval.items()[0]!,a=await f.start() as {id:string;revision:number};const shown=await f.command({action:'reveal',id:a.id,revision:a.revision,answer:'Attempt',attempted:true}) as typeof a;
 const first=await f.command({action:'rate',id:a.id,revision:shown.revision,ratings:{[item.id]:3}}) as typeof a;
 const oldDue=f.atlas.retrieval.items()[0]!.card.dueAt;await f.command({action:'rate',id:a.id,revision:first.revision,ratings:{[item.id]:1}});
 const corrected=f.atlas.retrieval.items()[0]!;assert.equal(corrected.card.reps,1);assert(Date.parse(corrected.card.dueAt)<Date.parse(oldDue));assert.deepEqual(f.atlas.retrieval.events(item.id).map(e=>e.rating),[3,1]);
});
test('connected reviews use real links, keep separate schedules and leave untested targets unscheduled',async()=>{
 const f=fixture(3);await f.enrol();const items=f.atlas.retrieval.items();
 await assert.rejects(()=>f.start(items.map(i=>i.id)),/actual Atlas links/);
 for(let i=1;i<3;i++)f.atlas.save({kind:'drawing-link',expectedRevision:f.atlas.read().layoutRevision??0,id:`dl_${randomUUID()}`,sourceId:f.ids[0]!,targetId:f.ids[i]!,label:'Related ideas',direction:'unclear',notes:'Association, not implication',replaces:null,removed:false});
 const a=await f.start(items.map(i=>i.id)) as {id:string;revision:number;front:string;back?:string};assert.equal(f.calls(),1);assert.equal(a.back,undefined);
 const shown=await f.command({action:'reveal',id:a.id,revision:a.revision,answer:'I recalled the first two ideas.',attempted:true}) as typeof a;
 await f.command({action:'rate',id:a.id,revision:shown.revision,ratings:{[items[0]!.id]:3,[items[1]!.id]:1,[items[2]!.id]:null}});
 const next=f.atlas.retrieval.items();assert.equal(next[0]!.card.reps,1);assert.equal(next[1]!.card.reps,1);assert.equal(next[2]!.card.reps,0);assert.equal((await f.service.snapshot()).used,1);
});
test('daily activity and time limits are server enforced, and missed days do not produce failures',async()=>{
 const f=fixture(3);await f.enrol();const settings=f.atlas.retrieval.settings();await f.command({action:'settings',settings:{...settings,dailyGoal:1}});
 const a=await f.start() as {id:string;revision:number};await f.command({action:'skip',id:a.id,revision:a.revision});await assert.rejects(()=>f.start([f.atlas.retrieval.items()[1]!.id]),/limit/);
 assert.equal(f.atlas.retrieval.events(f.atlas.retrieval.items()[0]!.id).length,0);f.advance(48*3600000);const state=await f.service.snapshot();assert.equal(state.used,0);assert.equal(state.deck.due,3);assert.equal(f.atlas.retrieval.items()[0]!.card.reps,0);
 await assert.rejects(()=>f.command({action:'settings',settings:{...state.settings,dailyGoal:21}}));assert.equal(REVIEW_LIMIT,20);
});
test('stale source cards wait for explicit confirmation; rewriting a target starts a new version',async()=>{
 const f=fixture();await f.enrol();const c=f.atlas.read().concepts[0]!,old=f.atlas.retrieval.items()[0]!;f.atlas.save({kind:'concept',id:c.id,expectedRevision:c.revision,title:c.title,aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[],markdown:'Corrected source.'});
 assert.equal((await f.service.snapshot()).items[0]!.stale,true);await assert.rejects(()=>f.start(),/Targets changed/);
 await f.command({action:'enrol',conceptId:c.id,expectedRevision:old.revision,front:old.front,back:'A corrected target answer.',paused:false});assert.equal(f.atlas.retrieval.items()[0]!.targetVersion,2);assert.equal(f.atlas.retrieval.items()[0]!.card.reps,0);
});
test('study days and one-shot refresh boundaries respect Stockholm DST and UTC storage',()=>{
 assert.equal(studyDay(new Date('2026-10-31T23:30:00Z'),'Europe/Stockholm'),'2026-11-01');
 assert.equal(studyDay(new Date('2026-10-25T01:30:00Z'),'Europe/Stockholm'),'2026-10-25');
 const n=new Date('2026-10-24T22:00:00Z'),boundary=Date.parse(nextReviewChange(n,'Europe/Stockholm',[]));assert.equal(studyDay(new Date(boundary),'Europe/Stockholm'),'2026-10-26');assert.equal(Math.round((boundary-n.getTime())/3600000),25);
});
test('v14 migration keeps a backup and scheduler data refuses external corruption',async()=>{
 const f=fixture();const db=new DatabaseSync(f.file);db.exec('DROP TABLE retrieval_items; DROP TABLE retrieval_events; DROP TABLE retrieval_activities; DROP TABLE retrieval_settings; PRAGMA user_version=14');db.close();
 await f.enrol();assert(fs.readdirSync(path.dirname(f.file)).some(n=>n.includes('.v14-')&&n.endsWith('.bak')));
 const edit=new DatabaseSync(f.file);edit.exec("UPDATE retrieval_items SET record=json_set(record,'$.front','Tampered')");edit.close();assert.throws(()=>f.atlas.retrieval.items(),/changed outside Atlas/);
});

test('the absolute daily ceiling is twenty, including skips, even when requests bypass the suggested deck',async()=>{
 const f=fixture(21);await f.enrol();await f.command({action:'settings',settings:{...f.atlas.retrieval.settings(),dailyGoal:20,minutes:60}});
 const items=f.atlas.retrieval.items();for(const item of items.slice(0,20)){const a=await f.start([item.id]) as {id:string;revision:number};await f.command({action:'skip',id:a.id,revision:a.revision});}
 await assert.rejects(()=>f.start([items[20]!.id]),/limit/);assert.equal((await f.service.snapshot()).used,20);assert.equal(f.atlas.retrieval.events(items[0]!.id).length,0);
});
test('one active activity, exact start tokens and stale target revisions prevent double reviews across windows',async()=>{
 const f=fixture(2);await f.enrol();const items=f.atlas.retrieval.items(),a=await f.start() as {id:string;revision:number};
 const again=await f.command({action:'start',id:a.id,itemIds:[items[0]!.id]}) as typeof a;assert.equal(again.id,a.id);assert.equal((await f.service.snapshot()).used,1);
 await assert.rejects(()=>f.start([items[1]!.id]),/active review/);await assert.rejects(()=>f.command({action:'start',id:a.id,itemIds:[items[1]!.id]}),/other targets/);
 const draft=await f.command({action:'draft',id:a.id,revision:a.revision,answer:'A saved reasoning trace.'}) as typeof a;
 await assert.rejects(()=>f.command({action:'draft',id:a.id,revision:a.revision,answer:'Stale window.'}),/another window/);
 assert.equal(f.atlas.retrieval.activity(a.id)!.answer,'A saved reasoning trace.');assert.equal(createAtlasStore(f.file).retrieval.activity(a.id)!.revision,draft.revision);
});
test('a failed connected question preserves usage/source snapshots and schedules nothing',async()=>{
 const f=fixture(3);await f.enrol();for(let i=1;i<3;i++)f.atlas.save({kind:'drawing-link',expectedRevision:f.atlas.read().layoutRevision??0,id:`dl_${randomUUID()}`,sourceId:f.ids[0]!,targetId:f.ids[i]!,label:'Association',direction:'unclear',notes:'',replaces:null,removed:false});
 const engine=createFauxCore({}),service=createRetrievalService(f.atlas.retrieval,()=>f.atlas.read(),()=>new Date('2026-10-31T10:00:00Z'),()=>({model:engine.getModel(),streamFn:engine.streamSimple}),async()=>{throw new Error('Injected provider error');});
 const failed=await service.command({action:'start',id:`ra_${randomUUID()}`,itemIds:f.atlas.retrieval.items().map(i=>i.id),consent:true,expectedModel:`${engine.getModel().provider}:${engine.getModel().id}`},new AbortController().signal) as {status:string};
 assert.equal(failed.status,'failed');assert.equal((await service.snapshot()).used,0);assert(f.atlas.retrieval.items().every(i=>i.card.reps===0));assert(f.atlas.retrieval.activities()[0]!.items.every(i=>i.back));
});
test('SQLite failure rolls back scheduling and event receipt together',async()=>{
 const f=fixture();await f.enrol();const item=f.atlas.retrieval.items()[0]!,a=await f.start() as {id:string;revision:number},shown=await f.command({action:'reveal',id:a.id,revision:a.revision,answer:'My reasoning.',attempted:true}) as typeof a;
 const db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER fail_schedule BEFORE UPDATE ON retrieval_items BEGIN SELECT RAISE(ABORT,'injected schedule failure'); END;");db.close();
 await assert.rejects(()=>f.command({action:'rate',id:a.id,revision:shown.revision,ratings:{[item.id]:3}}),/injected schedule/);assert.equal(f.atlas.retrieval.events(item.id).length,0);assert.equal(f.atlas.retrieval.items()[0]!.card.reps,0);assert.equal(f.atlas.retrieval.activity(a.id)!.status,'revealed');
 const reset=new DatabaseSync(f.file);reset.exec('DROP TRIGGER fail_schedule');reset.close();await f.command({action:'rate',id:a.id,revision:shown.revision,ratings:{[item.id]:3}});assert.equal(f.atlas.retrieval.items()[0]!.card.reps,1);
});
test('the FSRS colour is separate from concept geometry and pausing does not erase memory',async()=>{
 const f=fixture();await f.enrol();const item=f.atlas.retrieval.items()[0]!,before=JSON.stringify(f.atlas.read());assert.equal(reviewColour(undefined,null),'#606976');const newColour=reviewColour(item,null);assert.notEqual(newColour,'#606976');
 await f.command({action:'enrol',conceptId:item.conceptId,expectedRevision:item.revision,front:item.front,back:item.back,paused:true});assert.equal((await f.service.snapshot()).deck.due,0);assert.equal(JSON.stringify(f.atlas.read()),before);assert.equal(f.atlas.retrieval.items()[0]!.targetVersion,item.targetVersion);
});
test('review drawings use existing durable scratchpad snapshots without sending images to a model',async()=>{
 const f=fixture();await f.enrol();const a=await f.start() as {id:string;revision:number};
 const {Resvg}=await import('@resvg/resvg-js'),image=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M1 1L10 10"/></svg>').render().asPng();
 const scene={type:'excalidraw' as const,version:2 as const,elements:[{id:'stroke',type:'freedraw',isDeleted:false,points:[[0,0],[10,10]]}],appState:{},files:{}};
 await f.command({action:'drawing',id:a.id,revision:a.revision,expectedRevision:0,scene});
 assert.deepEqual(stores.scratchpadStore.read(a.id,'review')!.scene,scene);
 await assert.rejects(()=>f.command({action:'reveal',id:a.id,revision:a.revision,answer:'A symbolic derivation.',attempted:true}),/Export your drawing/);
 await f.command({action:'reveal',id:a.id,revision:a.revision,answer:'A symbolic derivation.',attempted:true,drawingRevision:1,image:`data:image/png;base64,${Buffer.from(image).toString('base64')}`});
 const saved=f.atlas.retrieval.activity(a.id)!;assert(saved.scratchwork);assert.equal(stores.scratchpadStore.retained(saved.scratchwork.id)!.draft.text,'A symbolic derivation.');assert.equal(f.calls(),0);assert.equal(f.atlas.retrieval.items()[0]!.card.reps,0);
});

test('the native question generator submits a precommitted basic solution and exact target criteria',async()=>{
 const {makeReviewQuestion}=await import('../src/agent/subagents/retrieval.ts'),{fauxAssistantMessage,fauxToolCall}=await import('@earendil-works/pi-ai'),f=fixture(3);await f.enrol();const items=f.atlas.retrieval.items(),faux=createFauxCore({});let calls=0;
 faux.setResponses([context=>{calls++;assert(JSON.stringify(context.messages).includes('No numerical plug-and-chug'));return fauxAssistantMessage([fauxToolCall('submit_basic_review',{front:'Explain these basic objects together.',back:'A checked symbolic argument with the essential assumptions.',criteria:items.map(i=>({itemId:i.id,text:'Recall the definition and explain its role.'}))},{id:'prepared_review'})],{stopReason:'toolUse'});}]);
 const proposal=await makeReviewQuestion({model:faux.getModel(),streamFn:faux.streamSimple},items,new AbortController().signal,()=>{});assert.equal(calls,1);assert.equal(proposal.criteria.length,3);assert(proposal.back.includes('essential assumptions'));
});

test('approved map notes auto-enrol once, preserve existing targets and skip empty labels',async()=>{
 const f=fixture(3),before=f.atlas.read();
 for(const [index,c] of before.concepts.entries())f.atlas.save({kind:'concept',id:c.id,expectedRevision:c.revision,title:c.title,aliases:c.aliases,subjectIds:c.subjectIds,preferredSubjectId:c.preferredSubjectId,propositionIds:c.propositionIds,markdown:index===2?'<!-- atlas-update:approved:key --> Short label':`<!-- atlas-update:approved:key --> The essential definition and conditions for concept ${index}.`});
 await Promise.all([f.service.snapshot(),f.service.snapshot()]);const items=f.atlas.retrieval.items();assert.equal(items.length,2);assert(!items[0]!.back.includes('<!--'));assert.equal(f.calls(),0);
 const saved=JSON.stringify(items);await f.service.snapshot();assert.equal(JSON.stringify(f.atlas.retrieval.items()),saved);
 const item=items[0]!;await f.command({action:'enrol',conceptId:item.conceptId,expectedRevision:item.revision,front:'My edited question',back:'My chosen reference answer.',paused:true});await f.service.snapshot();const kept=f.atlas.retrieval.items().find(i=>i.id===item.id)!;assert.equal(kept.front,'My edited question');assert.equal(kept.paused,true);
});

test('review colours use recall probability and edge means, not scheduled urgency',()=>{
 assert.equal(retentionColour(1),'#559cb5');assert.equal(retentionColour(.9),'#559cb5');assert.equal(retentionColour(.899),'#dab860');assert.equal(retentionColour(.8),'#dab860');assert.equal(retentionColour(.3),'#dab860');assert.equal(retentionColour(.299),'#ff3737');assert.equal(retentionColour(0),'#ff3737');
 assert.equal(reviewEdgeColour(.8,1),retentionColour(.9));assert.equal(reviewEdgeColour(null,1),retentionColour(null));
 assert.equal(reviewInterval('2026-10-31T11:00:00Z','2026-10-31T10:00:00Z'),'1h');
});
test('rating previews match the actual FSRS due date and do not advance memory',async()=>{
 const f=fixture();await f.enrol();const item=f.atlas.retrieval.items()[0]!,a=await f.start() as {id:string;revision:number};
 const shown=await f.command({action:'reveal',id:a.id,revision:a.revision,answer:'Attempt',attempted:true}) as typeof a;
 const snapshot=await f.service.snapshot(),due=snapshot.intervals[item.id]![2];assert(due);assert.equal(f.atlas.retrieval.items()[0]!.card.reps,0);
 await f.command({action:'rate',id:a.id,revision:shown.revision,ratings:{[item.id]:3}});assert.equal(f.atlas.retrieval.items()[0]!.card.dueAt,due);
 assert.equal((await f.service.snapshot()).deck.groups.length,0);
});

const repaired:ReviewHelpProposal={cardStatus:'flawed',answerStatus:'partial',feedback:'The key omitted the essential condition.',replacement:{front:'State the source definition and its condition.',back:'The source definition holds under the supplied condition.'}};
test('card help checks the attempt, previews repairs without scheduling, and applies once while preserving history',async()=>{
 let calls=0;const f=fixture(1,async(_e,input)=>{calls++;assert.equal(input.answer,'');assert(input.sources[0]!.notes.includes('Source definition'));return repaired;});await f.enrol();const item=f.atlas.retrieval.items()[0]!,start=await f.start() as ReturnType<typeof publicReviewActivity>;
 await assert.rejects(()=>f.command({action:'assist',id:start.id,revision:start.revision,mode:'repair',expectedModel:f.model,consent:true}),/Reveal/);
 const shown=await f.command({action:'reveal',id:start.id,revision:start.revision,answer:'My attempt',attempted:true}) as ReturnType<typeof publicReviewActivity>;
 const cmd={action:'assist',id:start.id,revision:shown.revision,mode:'repair',expectedModel:f.model,consent:true},checked=await f.command(cmd) as ReturnType<typeof publicReviewActivity>;
 assert.equal(checked.help?.result?.replacement?.front,repaired.replacement!.front);assert.deepEqual(f.atlas.retrieval.items()[0],item);assert.equal(f.atlas.retrieval.events(item.id).length,0);
 await f.command(cmd);assert.equal(calls,1);const apply={action:'apply-help',id:start.id,revision:checked.revision,mode:'repair',approve:true},done=await f.command(apply) as ReturnType<typeof publicReviewActivity>;
 assert.equal(done.status,'skipped');assert.equal(f.atlas.retrieval.activity(done.id)!.back,item.back);assert.equal(done.answer,'My attempt');assert.equal(done.help?.applied,true);const next=f.atlas.retrieval.items()[0]!;assert.equal(next.front,repaired.replacement!.front);assert.equal(next.targetVersion,item.targetVersion+1);assert.equal(next.card.reps,0);await f.command(apply);assert.deepEqual(f.atlas.retrieval.items()[0],next);assert.equal(f.atlas.retrieval.events(item.id).length,0);assert.equal(createAtlasStore(f.file).retrieval.activity(done.id)!.help?.applied,true);
});
test('untaught cards can be paused without changing FSRS; checks never automatically rate',async()=>{
 const f=fixture(1,async()=>({cardStatus:'not-covered',answerStatus:'not-assessable',feedback:'This topic was deferred.',replacement:null}));await f.enrol();const item=f.atlas.retrieval.items()[0]!,start=await f.start() as ReturnType<typeof publicReviewActivity>,shown=await f.command({action:'reveal',id:start.id,revision:start.revision,answer:'',attempted:true}) as ReturnType<typeof publicReviewActivity>;
 const checked=await f.command({action:'assist',id:start.id,revision:shown.revision,mode:'check',expectedModel:f.model,consent:true}) as ReturnType<typeof publicReviewActivity>;
 await assert.rejects(()=>f.command({action:'apply-help',id:start.id,revision:checked.revision,mode:'repair',approve:true}),/no supported replacement/);
 await f.command({action:'apply-help',id:start.id,revision:checked.revision,mode:'pause',approve:true});const next=f.atlas.retrieval.items()[0]!;assert.equal(next.paused,true);assert.deepEqual(next.card,item.card);assert.equal(next.targetVersion,item.targetVersion);assert.equal(f.atlas.retrieval.events(item.id).length,0);
});
test('repair refuses changed source notes and failed checks retain the card and learner answer',async()=>{
 let fail=false;const f=fixture(1,async()=>{if(fail)throw new Error('private provider failure');return repaired;});await f.enrol();const item=f.atlas.retrieval.items()[0]!,start=await f.start() as ReturnType<typeof publicReviewActivity>,shown=await f.command({action:'reveal',id:start.id,revision:start.revision,answer:'Attempt',attempted:true}) as ReturnType<typeof publicReviewActivity>;
 const checked=await f.command({action:'assist',id:start.id,revision:shown.revision,mode:'repair',expectedModel:f.model,consent:true}) as ReturnType<typeof publicReviewActivity>;
 const concept=f.atlas.read().concepts[0]!;f.atlas.save({kind:'concept',id:concept.id,title:concept.title,aliases:concept.aliases,subjectIds:concept.subjectIds,preferredSubjectId:concept.preferredSubjectId,propositionIds:concept.propositionIds,expectedRevision:concept.revision,markdown:'Changed source definition.'});
 await assert.rejects(()=>f.command({action:'apply-help',id:start.id,revision:checked.revision,mode:'repair',approve:true}),/source notes changed/);fail=true;
 const failed=await f.command({action:'assist',id:start.id,revision:checked.revision,mode:'check',expectedModel:f.model,consent:true}) as ReturnType<typeof publicReviewActivity>;
 assert.equal(failed.help?.state,'failed');assert(!JSON.stringify(failed).includes('private provider'));assert.equal(failed.answer,'Attempt');assert.deepEqual(f.atlas.retrieval.items()[0],item);assert.equal(f.atlas.retrieval.events(item.id).length,0);
});

test('Fix card can propose untaught AI-authored content, preserving provenance without grading the old attempt',async()=>{
 const proposal:ReviewHelpProposal={cardStatus:'not-covered',answerStatus:'not-assessable',feedback:'AI-authored definition under the explicitly stated assumptions; not taught in the notes.',replacement:{basis:'ai-authored',front:'State the definition under these assumptions.',back:'A self-contained mathematical definition with its assumptions.'}};
 const f=fixture(1,async(_engine,input)=>{assert.equal(input.answer,'');assert.equal(input.drawing,undefined);return proposal;});await f.enrol();const item=f.atlas.retrieval.items()[0]!,a=await f.start() as ReturnType<typeof publicReviewActivity>,shown=await f.command({action:'reveal',id:a.id,revision:a.revision,answer:'Original attempt',attempted:true}) as ReturnType<typeof publicReviewActivity>;
 const checked=await f.command({action:'assist',id:a.id,revision:shown.revision,mode:'repair',expectedModel:f.model,consent:true}) as ReturnType<typeof publicReviewActivity>;
 assert.equal(checked.help?.state,'ready');assert.equal(checked.help.result?.replacement?.basis,'ai-authored');assert.deepEqual(f.atlas.retrieval.items()[0],item);
 await f.command({action:'apply-help',id:a.id,revision:checked.revision,mode:'repair',approve:true});const next=f.atlas.retrieval.items()[0]!;
 assert.equal(next.repairProvenance?.basis,'ai-authored');assert.equal(next.repairProvenance?.model,f.model);assert.equal(next.repairProvenance?.notes,proposal.feedback);assert.equal(next.card.reps,0);assert.equal(f.atlas.retrieval.events(item.id).length,0);assert.equal(f.atlas.retrieval.activity(a.id)!.answer,'Original attempt');
});
