import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createFauxCore,fauxAssistantMessage,fauxText} from '@earendil-works/pi-ai';
import {lessonSummary,validateLessonSummary,type LessonSummary} from '../src/core/lesson-integration.ts';
import {initialLesson} from '../src/core/learning-session.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-lesson-commit-'));
process.env.LH_DATA_DIR=root;process.env.LH_AUTH_FILE=path.join(root,'auth.json');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {stores}=await import('../src/server/stores.ts');
const {createLessonIntegrationService}=await import('../src/server/lesson-integration.ts');
const {graphView}=await import('../src/server/graph.ts');
const {createAtlasStore}=await import('../src/store/atlas.ts');
const {getGraph}=await import('../src/core/graph.ts');
const faux=createFauxCore({}),engine={model:faux.getModel(),streamFn:faux.streamSimple};
const signal=()=>new AbortController().signal;
function fixture(withConcept=true){
 const chat=stores.chatStore.createChat('A bounded proof');
 stores.chatStore.saveMessages(chat.id,[{...fauxAssistantMessage([fauxText('Assume A and B. Together they imply C under the stated conditions.')]),id:'message_proof'}]);
 const lesson=stores.lessonStore.create(chat.id,initialLesson('Understand a joint argument'));
 const subject=`as_${randomUUID()}`;
 stores.atlasStore.save({kind:'subject',id:subject,expectedRevision:0,title:'Subject',color:'#65a3dc',parentId:null});
 const draft:LessonSummary=lessonSummary.parse({overview:'A sourced proof and its conceptual role.',map:lesson.plan,
 concepts:withConcept?[{key:'object',title:`Object ${chat.id}`,notes:'Conditions and interpretation.',existingId:null,rationale:'Useful beyond this proof.',topicIds:['topic_0'],include:true}]:[],
 propositions:['a','b','c'].map((key,i)=>({key,name:key.toUpperCase(),statement:`${chat.id}: precise claim ${i}`,existingId:null,identityRationale:'',origin:'session',evidence:['message_proof'],uncertainty:''})),
 arguments:[{key:'joint',premises:['a','b'],conclusion:'c',rationale:'Both assumptions are required together.',origin:'session',evidence:['message_proof'],status:'inference',uncertainty:''},{key:'gap',premises:['a'],conclusion:'b',rationale:'This implication has not been established.',origin:'ai-explanation',evidence:[],status:'gap',uncertainty:'Missing proof'}],
 derivations:[{key:'proof',title:'Joint argument',topicId:'topic_0',start:'Assume A and B.',finish:'Show C.',root:'c',propositions:['a','b','c'],arguments:['joint','gap'],concepts:withConcept?['object']:[],include:true,gaps:[],assistance:'An AI explanation was used.'}]});
 let calls=0;const service=createLessonIntegrationService(()=>engine,async()=>{calls++;return structuredClone(draft);});
 const generate=()=>service.generate({action:'generate',id:`lr_${randomUUID()}`,chatId:chat.id,subjectId:subject,expectedModel:`${engine.model.provider}:${engine.model.id}`,consent:true},signal());
 return {chat,lesson,draft,service,generate,calls:()=>calls,subject};
}
test('single reviewed integration preserves joint premises and full explanations, hides proof steps, and retries without duplicates',async()=>{
 const f=fixture(),before=stores.graphStore.readNodes().length,r=await f.generate();
 assert.equal(r.status,'prepared');assert.deepEqual(r.problems,[]);assert(r.plan);assert.equal(stores.graphStore.readNodes().length,before);
 const result=await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});assert.equal(result.status,'committed');
 const graph=getGraph(stores.graphStore),plan=result.plan!,argument=graph.chains.find(c=>c.id===plan.chains[0]!.id)!;
 assert.equal(argument.premises.length,2);assert.equal(plan.chains.length,1);assert.equal(plan.artifact.derivations[0]!.gaps.length,1);
 assert.equal(result.draft!.arguments[0]!.rationale,'Both assumptions are required together.');
 const atlas=stores.atlasStore.read(),concept=atlas.concepts.find(c=>c.id===plan.concepts[0]!.id)!;
 assert(concept.propositionIds.includes(plan.artifact.derivations[0]!.rootId));assert(atlas.hiddenPropositionIds?.includes(plan.nodes[0]!.id));assert(atlas.lessonMaps?.some(m=>m.id===r.id));
 const bytes=JSON.stringify([stores.graphStore.readNodes(),stores.graphStore.readChains(),atlas]);
 await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});assert.equal(JSON.stringify([stores.graphStore.readNodes(),stores.graphStore.readChains(),stores.atlasStore.read()]),bytes);
 assert.equal((await f.generate()).id,r.id);assert.equal(f.calls(),1);
 await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:'0'.repeat(64),approve:true}),/differs/);
});
test('zero new concepts is valid; incomplete joint arguments and fabricated evidence are rejected',async()=>{
 const f=fixture(false),r=await f.generate();assert(r.plan);assert.equal(r.plan.concepts.length,0);
 const bad=structuredClone(f.draft);bad.derivations[0]!.propositions=['a','c'];assert.match(validateLessonSummary(bad,r.source)!,/joint premise/);
 const invented=structuredClone(f.draft);invented.propositions[0]!.evidence=['invented'];assert.match(validateLessonSummary(invented,r.source)!,/actual source/);
 await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});assert(stores.atlasStore.read().lessonMaps?.find(m=>m.id===r.id));
});
test('source and Atlas changes invalidate approval; edits replace the exact approved digest',async()=>{
 const f=fixture(),r=await f.generate(),draft=structuredClone(r.draft!);draft.propositions[0]!.name='Edited name';
 const edited=f.service.edit({action:'edit',id:r.id,digest:r.digest,draft,decisions:r.decisions,subjectId:f.subject});assert.notEqual(edited.digest,r.digest);
 await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true}),/exact preview/);
 stores.lessonStore.save(f.chat.id,{expectedRevision:1,status:'finished',plan:f.lesson.plan});
 await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:edited.digest,approve:true}),/changed/);
 const other=fixture(),next=await other.generate();stores.atlasStore.save({kind:'subject',id:other.subject,expectedRevision:1,title:'Changed',color:'#65a3dc',parentId:null});
 await assert.rejects(()=>other.service.commit({action:'commit',id:next.id,digest:next.digest,approve:true}),/changed/);
});
test('a partial canonical append stays hidden and resumes with reserved identities',async()=>{
 const f=fixture(),r=await f.generate(),append=stores.graphStore.appendNode;let writes=0;
 stores.graphStore.appendNode=n=>{append(n);if(++writes===1)throw new Error('Injected post-write failure');};
 try{await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true}),/Injected/);}finally{stores.graphStore.appendNode=append;}
 assert.equal(stores.atlasStore.lessonReviews.read(r.id)!.status,'applying');assert(!graphView().propositions.some(n=>n.id===r.plan!.nodes[0]!.id));
 await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:'f'.repeat(64),approve:true}),/Exact/);
 const saved=await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});assert.equal(saved.status,'committed');
 for(const n of r.plan!.nodes)assert.equal(stores.graphStore.readNodes().filter(p=>p.id===n.id).length,1);
});
test('metadata failure rolls back the Atlas transaction and resumes after canonical writes',async()=>{
 const f=fixture(),r=await f.generate(),finish=stores.atlasStore.lessonReviews.finish;
 stores.atlasStore.lessonReviews.finish=()=>{throw new Error('Injected metadata failure');};
 try{await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true}),/metadata/);}finally{stores.atlasStore.lessonReviews.finish=finish;}
 assert(!stores.atlasStore.read().concepts.some(c=>c.id===r.plan!.concepts[0]!.id));
 const count=stores.graphStore.readNodes().length;await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});assert.equal(stores.graphStore.readNodes().length,count);
});
test('v13 migration backs up original metadata and opens a durable review store',()=>{
 const file=path.join(root,'migration','atlas.sqlite');createAtlasStore(file).read();const db=new DatabaseSync(file);db.exec('DROP TABLE retrieval_events; DROP TABLE retrieval_activities; DROP TABLE retrieval_items; DROP TABLE retrieval_settings; DROP TABLE lesson_reviews; PRAGMA user_version=13');db.close();
 const store=createAtlasStore(file);assert.deepEqual(store.lessonReviews.list(),[]);assert(fs.readdirSync(path.dirname(file)).some(n=>n.includes('.v13-')&&n.endsWith('.bak')));
});
test('SQL failure rolls back notes, concept roots and receipt while retaining a resumable approval',async()=>{
 const f=fixture(),r=await f.generate(),file=path.join(root,'atlas.sqlite'),db=new DatabaseSync(file);
 db.exec("CREATE TRIGGER fail_lesson_concept BEFORE INSERT ON concepts BEGIN SELECT RAISE(ABORT,'injected SQL failure'); END;");db.close();
 try{await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true}),/injected SQL/);assert.equal(stores.atlasStore.lessonReviews.read(r.id)!.status,'applying');assert(!stores.atlasStore.read().lessonMaps?.some(m=>m.id===r.id));}
 finally{const reset=new DatabaseSync(file);reset.exec('DROP TRIGGER fail_lesson_concept');reset.close();}
 const count=stores.graphStore.readNodes().length;await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});assert.equal(stores.graphStore.readNodes().length,count);
});
test('a revised lesson reuses exact canonical claims and arguments without duplicating them',async()=>{
 const f=fixture(false),first=await f.generate();await f.service.commit({action:'commit',id:first.id,digest:first.digest,approve:true});
 stores.lessonStore.save(f.chat.id,{expectedRevision:1,status:'finished',plan:f.lesson.plan});const next=await f.generate();
 assert.notEqual(next.id,first.id);assert(next.plan!.nodes.every(n=>n.existing));assert(next.plan!.chains.every(a=>a.existing));
 const count=stores.graphStore.readNodes().length,chains=stores.graphStore.readChains().length;
 await f.service.commit({action:'commit',id:next.id,digest:next.digest,approve:true});assert.equal(stores.graphStore.readNodes().length,count);assert.equal(stores.graphStore.readChains().length,chains);
});

test('lesson approval retains editable drafts and attempt previews on matching concepts and proof roots, independently of chat deletion',async()=>{
 const {Resvg}=await import('@resvg/resvg-js'),{lessonScratchTarget}=await import('../src/core/scratchpad.ts'),{scratchworkResponse}=await import('../src/server/scratchpad.ts');
 const f=fixture(),target=lessonScratchTarget(f.lesson),scene={type:'excalidraw' as const,version:2 as const,elements:[{id:'stroke',type:'freedraw',isDeleted:false,points:[[0,0],[10,10]]}],appState:{},files:{}};
 const first=stores.scratchpadStore.save(f.chat.id,target.id,0,{scene,text:'First try.',target}),image=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M0 0L10 10"/></svg>').render().asPng();
 stores.scratchpadStore.capture(f.chat.id,target.id,`sa_${randomUUID()}`,first.revision,image);
 stores.scratchpadStore.save(f.chat.id,target.id,1,{scene,text:'A useful unsent correction.',target});
 const r=await f.generate(),notes=r.plan!.artifact.scratchwork!;
 assert.equal(notes.length,2);assert.equal(notes.filter(n=>n.imageHash).length,1);
 for(const note of notes){assert.deepEqual(note.topicIds,['topic_0']);assert.deepEqual(note.conceptIds,[r.plan!.concepts[0]!.id]);assert.deepEqual(note.propositionIds,[r.plan!.artifact.derivations[0]!.rootId]);}
 const sourceBytes=JSON.stringify(r.source);assert(!sourceBytes.includes('"elements"'));assert(!sourceBytes.includes(Buffer.from(image).toString('base64')));
 await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});
 const before=JSON.stringify(stores.atlasStore.read().lessonMaps);await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});assert.equal(JSON.stringify(stores.atlasStore.read().lessonMaps),before);
 stores.scratchpadStore.remove(f.chat.id);stores.lessonStore.remove(f.chat.id);stores.chatStore.deleteChat(f.chat.id);
 const get=(note:typeof notes[number],format='')=>scratchworkResponse(new Request(`http://local/scratchwork?review=${r.id}&id=${note.id}&format=${format}`));
 const preview=await get(notes.find(n=>n.imageHash)!,'image');assert.equal(preview.status,200);assert.deepEqual(Buffer.from(await preview.arrayBuffer()),image);
 const draft=notes.find(n=>!n.attemptId)!,editable=await get(draft,'scene');assert.match(editable.headers.get('Content-Disposition')!,/\.excalidraw/);assert.deepEqual(await editable.json(),scene);
 assert.equal((await (await get(draft)).json()).draft.text,'A useful unsent correction.');
 const other=await fixture().generate();assert.equal((await scratchworkResponse(new Request(`http://local/scratchwork?review=${other.id}&id=${draft.id}`))).status,404);
});

test('changing scratchwork invalidates stale lesson approval; missing retained sources block writes',async()=>{
 const {lessonScratchTarget}=await import('../src/core/scratchpad.ts');
 const f=fixture(),target=lessonScratchTarget(f.lesson),scene={type:'excalidraw' as const,version:2 as const,elements:[],appState:{},files:{}};
 stores.scratchpadStore.save(f.chat.id,target.id,0,{scene,text:'First draft.',target});const r=await f.generate();
 stores.scratchpadStore.save(f.chat.id,target.id,1,{scene,text:'Changed after review.',target});
 await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true}),/changed/);
 const next=await f.generate(),note=next.plan!.artifact.scratchwork![0]!;
 fs.rmSync(path.join(root,'scratchpads','_retained',`${note.id}.json`));
 // Prepared validation recaptures from the still-existing draft, repairing an interrupted archive write.
 await f.service.commit({action:'commit',id:next.id,digest:next.digest,approve:true});assert(stores.scratchpadStore.retained(note.id));
});

test('zero-new-concept reviews attach saved notes to the existing topic concept without rewriting it',async()=>{
 const {lessonScratchTarget}=await import('../src/core/scratchpad.ts');const f=fixture(false),conceptId=`ac_${randomUUID()}`;
 stores.atlasStore.save({kind:'concept',id:conceptId,expectedRevision:0,title:'Existing topic',aliases:[],subjectIds:[f.subject],preferredSubjectId:f.subject,propositionIds:[]});
 const plan=structuredClone(f.lesson.plan);plan.nodes[0]!.conceptId=conceptId;
 const lesson=stores.lessonStore.save(f.chat.id,{expectedRevision:1,status:'active',plan}),target=lessonScratchTarget(lesson);
 stores.scratchpadStore.save(f.chat.id,target.id,0,{scene:{type:'excalidraw',version:2,elements:[],appState:{},files:{}},text:'My notes on the existing concept.',target});
 // A generated lesson may omit the concept pointer; the original saved topic remains authoritative for the attachment.
 f.draft.map.nodes[0]!.conceptId=null;const r=await f.generate();assert.equal(r.plan!.concepts.length,0);
 assert.deepEqual(r.plan!.artifact.scratchwork![0]!.conceptIds,[conceptId]);
 await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});assert.equal(stores.atlasStore.read().concepts.find(c=>c.id===conceptId)!.revision,1);
});

test('interrupted approval requires its exact retained scratchwork before resuming canonical writes',async()=>{
 const {lessonScratchTarget}=await import('../src/core/scratchpad.ts'),f=fixture(),target=lessonScratchTarget(f.lesson);
 stores.scratchpadStore.save(f.chat.id,target.id,0,{scene:{type:'excalidraw',version:2,elements:[],appState:{},files:{}},text:'Preserve this argument.',target});
 const r=await f.generate(),note=r.plan!.artifact.scratchwork![0]!,append=stores.graphStore.appendNode;
 stores.graphStore.appendNode=n=>{append(n);throw new Error('Injected interruption');};
 try{await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true}),/Injected/);}finally{stores.graphStore.appendNode=append;}
 const file=path.join(root,'scratchpads','_retained',`${note.id}.json`),bytes=fs.readFileSync(file);fs.rmSync(file);
 const count=stores.graphStore.readNodes().length;
 await assert.rejects(()=>f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true}),/Scratchwork attachment/);assert.equal(stores.graphStore.readNodes().length,count);
 fs.writeFileSync(file,bytes);assert.equal((await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true})).status,'committed');
});

test('Atlas-aware lessons retrieve reviewed rationale and gaps without sending saved scratchwork or raw transcripts',async()=>{
 const {readLessonAtlas}=await import('../src/core/atlas-lesson-context.ts');const f=fixture(),r=await f.generate();await f.service.commit({action:'commit',id:r.id,digest:r.digest,approve:true});
 const value=readLessonAtlas({read:()=>({atlas:stores.atlasStore.read(),propositions:getGraph(stores.graphStore).nodes,chains:getGraph(stores.graphStore).chains}),lesson:id=>stores.atlasStore.lessonReviews.read(id)},'lesson',r.id);
 assert(value.kind==='lesson');assert(JSON.stringify(value).includes('Both assumptions are required together.'));assert(JSON.stringify(value).includes('This implication has not been established.'));assert(!('transcript' in value));
 const argument=value.arguments.items.find(a=>a.key==='joint')!;assert.deepEqual(argument.premises,r.plan!.chains[0]!.premises);assert.equal(argument.canonicalId,r.plan!.chains[0]!.id);
 const focused=readLessonAtlas({read:()=>({atlas:stores.atlasStore.read(),propositions:[],chains:[]}),lesson:id=>stores.atlasStore.lessonReviews.read(id)},'lesson',r.id,argument.canonicalId!);assert(focused.kind==='lesson');assert.equal(focused.arguments.items.length,1);assert.equal(focused.arguments.items[0]!.rationale,'Both assumptions are required together.');
});

test('lesson review ranks relevant full claims into bounded context without integrating them',async()=>{
 const f=fixture(false);
 for(let i=0;i<100;i++)stores.graphStore.appendNode({id:`n_filler_${i}`,name:`Unrelated label ${i}`,statement:`Irrelevant combinatorial filler ${i}.`,aliases:[],createdAt:new Date().toISOString(),provenance:[]});
 const target={id:'n_ranked_target',name:'Different terminology',statement:'Anisotropic elliptic operators admit resolvents under coercivity.',aliases:[],createdAt:new Date().toISOString(),provenance:[]};
 stores.graphStore.appendNode(target);
 stores.chatStore.saveMessages(f.chat.id,[...stores.chatStore.getChat(f.chat.id)!.messages,{...fauxAssistantMessage([fauxText(target.statement)]),id:'message_context'}]);
 const before=JSON.stringify([stores.graphStore.readNodes(),stores.graphStore.readChains(),stores.atlasStore.read()]);let seen=false;
 const service=createLessonIntegrationService(()=>engine,async(_engine,input)=>{
  seen=true;assert(input.graph.nodes.some(n=>n.id===target.id));assert(input.graph.nodes.length<=80);assert(JSON.stringify(input.graph.nodes).length<=61000);
  return structuredClone(f.draft);
 });
 const r=await service.generate({action:'generate',id:`lr_${randomUUID()}`,chatId:f.chat.id,subjectId:f.subject,expectedModel:`${engine.model.provider}:${engine.model.id}`,consent:true},signal());
 assert(seen);assert.equal(r.status,'prepared');assert.equal(JSON.stringify([stores.graphStore.readNodes(),stores.graphStore.readChains(),stores.atlasStore.read()]),before);
 assert.equal(r.plan!.chains[0]!.premises.length,2,'retrieval leaves joint inference semantics intact');
});
