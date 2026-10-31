import assert from "node:assert/strict";
import test,{after} from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {gzipSync} from "node:zlib";
import {DatabaseSync,backup} from "node:sqlite";
import {createAtlasStore} from "../src/store/atlas.ts";
import {mapReviewReasons,type IntegrationChoices} from "../src/core/map-review.ts";
import {projectAtlas} from "../src/core/atlas.ts";
import {draftFixture,draftEvidence} from "./fixtures/map-draft.ts";
import type {MapProposal} from "../src/core/map-proposals.ts";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"atlas-map-review-"));after(()=>fs.rmSync(root,{recursive:true,force:true}));
function fixture(){
	const file=path.join(root,randomUUID(),"atlas.sqlite"),store=createAtlasStore(file),source=`mr_${randomUUID()}`;
	store.mindmaps.capture({id:`mm_${randomUUID()}`,captureId:source,expectedRevision:0,title:"Fixture",filename:"map.rnote",conceptIds:[],manualPreviewAcknowledged:false},gzipSync("fixture"),null,{validation:"unverified",previewKind:"none",notice:null});
	const empty:MapProposal={id:`mp_${randomUUID()}`,schemaVersion:2,sourceRevision:source,sourceHash:store.read().mindmaps![0]!.captures[0]!.hash,baseRevision:0,context:[],model:"fake:vision",status:"running",images:[],imageLayout:[],findings:null,digest:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:null};
	store.proposals.begin(empty);const image=store.proposals.retainImage(Buffer.from("fake image bytes")),layout=[{kind:"overview" as const,region:{x:0,y:0,w:1,h:1},width:1,height:1}];
	store.proposals.update({...empty,status:"prepared",images:[image],imageLayout:layout,findings:{transcription:"fixture",concepts:draftFixture.concepts.map(n=>({key:n.key,title:n.title,aliases:[],existingId:null,notes:"",evidence:draftEvidence,uncertainty:""})),relations:[],questions:[]}});
	const parent=store.proposals.read(empty.id)!;
	const p={...empty,id:`mp_${randomUUID()}`,schemaVersion:3 as const,refinement:{parentId:parent.id,parentDigest:parent.digest!},draft:null};store.proposals.begin(p);
	const draft=structuredClone(draftFixture);draft.connections[0]!.relationType="application";
	store.proposals.update({...p,status:"prepared",images:[image],imageLayout:layout,draft});
	const choices:IntegrationChoices={identities:{draft_a:"new",draft_b:"new"},subjectId:null,newSubject:{title:"Probability",color:"#65a3dc"},connections:["edge_qv"]};
	return {file,store,p:store.proposals.read(p.id)!,choices,review:store.reviews.read(p.id)};
}
test("editable reviews are versioned, source output immutable and conflicting windows cannot overwrite",()=>{
	const f=fixture(),before=f.store.read(),original=f.store.proposals.read(f.p.id),draft=structuredClone(f.review.draft);draft.concepts[1]!.title="Variation $[B]_t$";
	const saved=f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft});assert.equal(saved.revision,1);assert.deepEqual(f.store.proposals.read(f.p.id),original);assert.deepEqual(f.store.read(),before);
	assert.throws(()=>f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft}),/another window/);
	const broken=structuredClone(draft);broken.connections[0]!.target="draft_missing";assert.throws(()=>f.store.reviews.save({proposalId:f.p.id,expectedRevision:1,draft:broken}),/endpoints/);
	assert.deepEqual(createAtlasStore(f.file).reviews.read(f.p.id),saved);
});
test("exact approval integrates transactionally, retains provenance and uncertainty, retries once after restart and restores",async()=>{
	const f=fixture(),before=f.store.read(),source=f.store.mindmaps.asset(f.p.sourceRevision,"original").bytes,plan=f.store.reviews.prepare(f.p.id,0,f.choices);
	assert.deepEqual(f.store.read(),before);assert.throws(()=>f.store.reviews.commit(plan.id,"0".repeat(64)),/approval/);
	const receipt=f.store.reviews.commit(plan.id,plan.digest),snapshot=f.store.read();assert.equal(receipt.status,"committed");assert.equal(snapshot.concepts.length,2);assert.equal(snapshot.relations.length,1);
	assert.equal(snapshot.relations[0]!.claimStatus,"external-assertion");assert.equal(snapshot.relations[0]!.reviewStatus,"accepted");assert(snapshot.concepts.every(n=>n.markdown!.includes(f.p.sourceRevision)));assert(snapshot.concepts.some(n=>n.markdown!.includes("Assumptions:")));
	assert(projectAtlas(snapshot).nodes.every(n=>n.badgeColor==="#e6b35a"));assert.deepEqual(f.store.mindmaps.asset(f.p.sourceRevision,"original").bytes,source);
	assert.deepEqual(createAtlasStore(f.file).reviews.commit(plan.id,plan.digest),receipt);assert.deepEqual(f.store.read(),snapshot);
	assert.throws(()=>f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft:f.review.draft}),/integrated/);
	assert.throws(()=>f.store.reviews.prepare(f.p.id,0,f.choices),/integrated/);
	const dir=path.join(root,randomUUID());fs.cpSync(path.dirname(f.file),dir,{recursive:true});const db=new DatabaseSync(f.file);await backup(db,path.join(dir,"atlas.sqlite"));db.close();assert.deepEqual(createAtlasStore(path.join(dir,"atlas.sqlite")).read(),snapshot);
});
test("duplicate identities need an explicit reuse and preserve notes, positions, links and names",()=>{
	const f=fixture(),known=`ac_${randomUUID()}`;
	f.store.save({kind:"concept",id:known,expectedRevision:0,title:"Brownian motion",aliases:["Wiener"],subjectIds:[],preferredSubjectId:null,propositionIds:[],markdown:"Owner's prior notes."});
	assert.throws(()=>f.store.reviews.prepare(f.p.id,0,f.choices),/exact-name duplicate/);
	const choices={...f.choices,identities:{...f.choices.identities,draft_a:known}},before=f.store.read().concepts[0]!,plan=f.store.reviews.prepare(f.p.id,0,choices);f.store.reviews.commit(plan.id,plan.digest);
	const reused=f.store.read().concepts.find(n=>n.id===known)!;assert.equal(f.store.read().concepts.length,2);assert.equal(reused.title,before.title);assert.equal(reused.x,before.x);assert.equal(reused.y,before.y);assert(reused.markdown!.startsWith("Owner's prior notes."));assert.deepEqual(reused.aliases,["Wiener"]);
});
test("stale Atlas, edited draft and rewritten source reject prior approval",()=>{
	for(const change of ["atlas","draft","source"]){const f=fixture(),plan=f.store.reviews.prepare(f.p.id,0,f.choices);
		if(change==="atlas")f.store.save({kind:"concept",id:`ac_${randomUUID()}`,expectedRevision:0,title:"Other",aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[]});
		if(change==="draft")f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft:{...f.review.draft,overview:"Edited"}});
		if(change==="source"){const m=f.store.read().mindmaps![0]!;f.store.mindmaps.capture({id:m.id,captureId:`mr_${randomUUID()}`,expectedRevision:m.revision,title:m.title,filename:"map.rnote",conceptIds:[],manualPreviewAcknowledged:false},gzipSync("new"),null,{validation:"unverified",previewKind:"none",notice:null});}
		assert.throws(()=>f.store.reviews.commit(plan.id,plan.digest),/changed|rewritten/);assert.equal(f.store.read().relations.length,0);
	}
});
test("write failure after staged notes rolls back all SQL and exact retry leaves no duplicate",()=>{
	const f=fixture(),plan=f.store.reviews.prepare(f.p.id,0,f.choices),before=f.store.read();
	const db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER fail_map BEFORE INSERT ON relations BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");db.close();
	assert.throws(()=>f.store.reviews.commit(plan.id,plan.digest),/fixture failure/);assert.deepEqual(f.store.read(),before);assert(fs.readdirSync(path.join(path.dirname(f.file),"concepts")).some(p=>p.endsWith(".md")));
	const reset=new DatabaseSync(f.file);reset.exec("DROP TRIGGER fail_map");reset.close();
	f.store.reviews.commit(plan.id,plan.digest);assert.equal(f.store.read().concepts.length,2);assert.equal(f.store.read().relations.length,1);
});
test("untyped links, missing dependencies and identity collapse cannot be approved",()=>{
	const f=fixture(),draft=structuredClone(f.review.draft);draft.connections[0]!.relationType=null;
	f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft});assert.throws(()=>f.store.reviews.prepare(f.p.id,1,f.choices),/type and direction/);
	assert.throws(()=>f.store.reviews.prepare(f.p.id,1,{...f.choices,identities:{draft_a:null,draft_b:"new"}}),/excluded/);
	const plan=f.store.reviews.prepare(f.p.id,1,{...f.choices,connections:[]});f.store.reviews.commit(plan.id,plan.digest);assert.equal(f.store.read().relations.length,0);
});
test("review marker describes depth/uncertainty rather than equating a source label with proof",()=>{
	const node=structuredClone(draftFixture.concepts[0]!);node.notes=[{...node.notes[0]!,text:"A long enough literal transcription of a mathematical topic.",rationale:"Visible text.",uncertainty:"Expanded meaning is not written."}];assert(mapReviewReasons(node).includes("Explanation needs depth"));assert(mapReviewReasons(node).includes("Unresolved notation or meaning"));
});

function reprocess(f:ReturnType<typeof fixture>,draft=f.review.draft){
	const p:MapProposal={...f.p,id:`mp_${randomUUID()}`,status:"running",images:[],imageLayout:[],draft:null,digest:null,baseRevision:f.store.read().layoutRevision!};
	f.store.proposals.begin(p);f.store.proposals.update({...p,status:"prepared",images:f.p.images,imageLayout:f.p.imageLayout,draft});return f.store.reviews.read(p.id);
}
test("map updates inherit identities, reuse unchanged notes/lines and retain exact retry receipts",()=>{
	const f=fixture(),first=f.store.reviews.prepare(f.p.id,0,{...f.choices,mapConnections:['edge_qv']}),receipt=f.store.reviews.commit(first.id,first.digest),before=f.store.read();
	const review=reprocess(f),choices={...f.choices,newSubject:undefined,subjectId:first.subject!.id,identities:review.priorIdentities!,mapConnections:['edge_qv']};
	assert.deepEqual(Object.values(review.priorIdentities!).sort(),first.concepts.map(n=>n.id).sort());
	const plan=f.store.reviews.prepare(review.proposalId,0,choices);
	assert.equal(plan.schemaVersion,4);assert.deepEqual(plan.updateOf,[receipt.id]);assert(plan.noteChanges!.every(c=>c.action==='unchanged'));assert.equal(plan.mapConnections!.length,0);assert.equal(plan.reusedMapConnections!.length,1);
	assert.deepEqual(f.store.reviews.read(review.proposalId).pendingIntegration?.choices.identities,choices.identities);
	f.store.reviews.commit(plan.id,plan.digest);const after=f.store.read();
	assert.equal(after.concepts.length,2);assert.equal(after.mapConnections!.length,1);assert.equal(after.relations.length,1);
	for(const old of before.concepts){const n=after.concepts.find(c=>c.id===old.id)!;assert.equal(n.markdown,old.markdown);assert.equal(n.x,old.x);assert.equal(n.y,old.y);}
	const committed=f.store.reviews.commit(plan.id,plan.digest);assert.equal(committed.id,plan.id);assert.equal(committed.digest,plan.digest);assert.equal(committed.status,'committed');
});
test("changed map notes append with history, rollback atomically, and never rewrite old receipts",()=>{
	const f=fixture(),first=f.store.reviews.prepare(f.p.id,0,f.choices),receipt=f.store.reviews.commit(first.id,first.digest),before=f.store.read();
	const draft=structuredClone(f.review.draft);draft.concepts[0]!.notes[0]!.text='A corrected source equation: $dX_t=aX_tdt+bX_tdB_t$.';
	const review=reprocess(f,draft),plan=f.store.reviews.prepare(review.proposalId,0,{...f.choices,newSubject:undefined,subjectId:first.subject!.id,identities:review.priorIdentities!});
	assert.equal(plan.noteChanges!.filter(c=>c.action==='updated').length,1);
	const db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER fail_update BEFORE INSERT ON map_concept_reviews BEGIN SELECT RAISE(ABORT,'update failure'); END;");db.close();
	assert.throws(()=>f.store.reviews.commit(plan.id,plan.digest),/update failure/);assert.deepEqual(f.store.read(),before);
	const reset=new DatabaseSync(f.file);reset.exec('DROP TRIGGER fail_update');reset.close();
	f.store.reviews.commit(plan.id,plan.digest);const notes=f.store.read().concepts.find(n=>n.id===first.concepts[0]!.id)!.markdown!;
	assert(notes.startsWith(before.concepts.find(n=>n.id===first.concepts[0]!.id)!.markdown!));assert(notes.includes('corrected source equation'));
	assert.deepEqual(f.store.reviews.commit(first.id,first.digest),receipt);
	const repeat=reprocess(f,draft),next=f.store.reviews.prepare(repeat.proposalId,0,{...f.choices,newSubject:undefined,subjectId:first.subject!.id,identities:repeat.priorIdentities!});
	assert(next.noteChanges!.every(c=>c.action==='unchanged'));f.store.reviews.commit(next.id,next.digest);
	assert.equal(f.store.read().concepts.find(n=>n.id===first.concepts[0]!.id)!.markdown,notes);
});
test("drawing reconciliation archives changed lines atomically, adds new lines and retries without duplication",()=>{
	const f=fixture(),first=f.store.reviews.prepare(f.p.id,0,{...f.choices,mapConnections:['edge_qv']}),receipt=f.store.reviews.commit(first.id,first.digest),before=f.store.read();
	const draft=structuredClone(f.review.draft);draft.connections[0]!.label='Corrected drawing label';
	draft.concepts.push({...structuredClone(draft.concepts[1]!),key:'draft_c',title:'Itô integral',sourceKeys:[]});
	draft.connections.push({...structuredClone(draft.connections[0]!),key:'edge_new',target:'draft_c'});
	const review=reprocess(f,draft),plan=f.store.reviews.prepare(review.proposalId,0,{identities:{...review.priorIdentities!,draft_c:'new'},subjectId:first.subject!.id,connections:[],mapConnections:['edge_qv','edge_new'],reconcile:true});
	assert.equal(plan.schemaVersion,5);assert.deepEqual(plan.lineChanges!.map(c=>c.kind),['changed','added']);assert.equal(plan.retiredMapConnections!.length,1);
	const db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER fail_line BEFORE INSERT ON map_connections BEGIN SELECT RAISE(ABORT,'line failure'); END;");db.close();
	assert.throws(()=>f.store.reviews.commit(plan.id,plan.digest),/line failure/);assert.deepEqual(f.store.read(),before);
	const reset=new DatabaseSync(f.file);assert.equal(reset.prepare("SELECT count(*) AS n FROM atlas_archive WHERE kind='map-connection'").get()!.n,0);reset.exec('DROP TRIGGER fail_line');reset.close();
	const committed=f.store.reviews.commit(plan.id,plan.digest),after=f.store.read();assert.equal(after.mapConnections!.length,2);assert.equal(after.concepts.length,3);assert.deepEqual(after.relations,before.relations);
	assert(after.mapConnections!.every(c=>c.label==='Corrected drawing label'));
	assert.deepEqual(f.store.reviews.commit(plan.id,plan.digest),committed);assert.deepEqual(f.store.reviews.commit(first.id,first.digest),receipt);
	const archived=new DatabaseSync(f.file);assert.equal(archived.prepare("SELECT count(*) AS n FROM atlas_archive WHERE kind='map-connection'").get()!.n,1);archived.close();
});
test("omitting a drawing node removes only its source reference and lines, preserving knowledge and typed claims",()=>{
	const f=fixture(),first=f.store.reviews.prepare(f.p.id,0,{...f.choices,mapConnections:['edge_qv']});f.store.reviews.commit(first.id,first.digest);const before=f.store.read();
	const draft=structuredClone(f.review.draft);draft.concepts=draft.concepts.slice(0,1);draft.connections=[];
	const review=reprocess(f,draft),plan=f.store.reviews.prepare(review.proposalId,0,{identities:review.priorIdentities!,subjectId:first.subject!.id,connections:[],mapConnections:[],reconcile:true});
	assert.equal(plan.lineChanges![0]!.kind,'removed');assert.equal(plan.removedMapConcepts!.length,1);
	f.store.reviews.commit(plan.id,plan.digest);const after=f.store.read();assert.equal(after.concepts.length,2);assert.equal(after.mapConnections!.length,0);assert.deepEqual(after.relations,before.relations);
	assert(after.concepts.every(n=>n.markdown===before.concepts.find(c=>c.id===n.id)!.markdown));
	assert.deepEqual(after.mindmaps![0]!.captures[0]!.conceptIds,[first.concepts[0]!.id]);
	assert.throws(()=>f.store.reviews.prepareConnections(f.p.id,after.layoutRevision!),/newer approved update/);
	assert.throws(()=>f.store.reviews.prepareConnections(review.proposalId,after.layoutRevision!),/reviewed removals/);
});
test("owners can retain the previous drawing instead of reconciling omissions",()=>{
	const f=fixture(),first=f.store.reviews.prepare(f.p.id,0,{...f.choices,mapConnections:['edge_qv']});f.store.reviews.commit(first.id,first.digest);
	const review=reprocess(f),plan=f.store.reviews.prepare(review.proposalId,0,{identities:review.priorIdentities!,subjectId:first.subject!.id,connections:[],mapConnections:[],reconcile:false});
	assert.equal(plan.lineChanges![0]!.kind,'removed');assert.equal(plan.retiredMapConnections!.length,0);
	f.store.reviews.commit(plan.id,plan.digest);assert.equal(f.store.read().mapConnections!.length,1);
});
test("a rewritten source reconciles old depictions without removing the previous revision or canonical knowledge",()=>{
	const f=fixture(),first=f.store.reviews.prepare(f.p.id,0,{...f.choices,mapConnections:['edge_qv']});f.store.reviews.commit(first.id,first.digest);
	const map=f.store.read().mindmaps![0]!,source=`mr_${randomUUID()}`;
	f.store.mindmaps.capture({id:map.id,captureId:source,expectedRevision:map.revision,title:map.title,filename:'revised.rnote',conceptIds:[],manualPreviewAcknowledged:false},gzipSync('revised original'),null,{validation:'unverified',previewKind:'none',notice:null});
	const hash=f.store.read().mindmaps![0]!.captures.find(c=>c.id===source)!.hash,oldParent=f.store.proposals.read(f.p.refinement!.parentId)!;
	const parent:MapProposal={...oldParent,id:`mp_${randomUUID()}`,sourceRevision:source,sourceHash:hash,baseRevision:f.store.read().layoutRevision!,status:'running',images:[],imageLayout:[],findings:null,digest:null};
	f.store.proposals.begin(parent);f.store.proposals.update({...parent,status:'prepared',images:f.p.images,imageLayout:f.p.imageLayout,findings:oldParent.findings});
	const draft=structuredClone(f.review.draft);draft.concepts=draft.concepts.slice(0,1);draft.connections=[];
	const p:MapProposal={...f.p,id:`mp_${randomUUID()}`,sourceRevision:source,sourceHash:hash,baseRevision:f.store.read().layoutRevision!,refinement:{parentId:parent.id,parentDigest:f.store.proposals.read(parent.id)!.digest!},status:'running',images:[],imageLayout:[],draft:null,digest:null};
	f.store.proposals.begin(p);f.store.proposals.update({...p,status:'prepared',images:f.p.images,imageLayout:f.p.imageLayout,draft});
	const review=f.store.reviews.read(p.id),plan=f.store.reviews.prepare(p.id,0,{identities:review.priorIdentities!,subjectId:first.subject!.id,connections:[],mapConnections:[],reconcile:true});
	assert.equal(plan.removedMapConcepts!.length,1);assert.equal(plan.retiredMapConnections!.length,1);
	f.store.reviews.commit(plan.id,plan.digest);const after=f.store.read();
	assert.equal(after.mindmaps![0]!.captures.length,2);assert.equal(after.concepts.length,2);assert.equal(after.relations.length,1);assert.equal(after.mapConnections!.length,0);
	assert.deepEqual(after.mindmaps![0]!.captures.find(c=>c.id===f.p.sourceRevision)!.conceptIds,first.concepts.map(c=>c.id));
	assert(f.store.mindmaps.asset(f.p.sourceRevision,'original').bytes.length>0);
});
test("process exits after file publication, before SQL commit and after SQL commit reconcile on retry",async()=>{
	const {spawnSync}=await import("node:child_process");
	for(const step of ["blob","before-commit","after-commit"]){const f=fixture(),plan=f.store.reviews.prepare(f.p.id,0,f.choices);
		const source=`import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {createAtlasStore} from ${JSON.stringify(new URL("../src/store/atlas.ts",import.meta.url).href)};
const [file,id,digest,step]=process.argv.slice(1);
if(step==='blob'){const link=fs.linkSync;fs.linkSync=(...args)=>{link(...args);process.exit(37);};}
const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const gate=sql.includes('UPDATE atlas_layout_version SET revision=revision+1; COMMIT');if(gate&&step==='before-commit')process.exit(38);const result=exec.call(this,sql);if(gate&&step==='after-commit')process.exit(39);return result;};
createAtlasStore(file).reviews.commit(id,digest);`;
		const child=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",source,f.file,plan.id,plan.digest,step],{encoding:"utf8",cwd:process.cwd()});
		assert.equal(child.status,step==="blob"?37:step==="before-commit"?38:39,child.stderr);
		const store=createAtlasStore(f.file);assert.equal(store.read().concepts.length,step==="after-commit"?2:0);
		store.reviews.commit(plan.id,plan.digest);assert.equal(store.read().concepts.length,2);assert.equal(store.read().relations.length,1);
	}
});
test("an existing accepted relation is reused without replacing evidence or duplicating its endpoints",()=>{
 const f=fixture(),a=`ac_${randomUUID()}`,b=`ac_${randomUUID()}`,id=`ar_${randomUUID()}`;
 for(const [key,title] of [[a,"Brownian motion"],[b,"Quadratic variation"]])f.store.save({kind:"concept",id:key!,expectedRevision:0,title:title!,aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[]});
 f.store.save({kind:"relation",id,expectedRevision:0,sourceId:a,targetId:b,relationType:"application",conditions:"",claimStatus:"hypothesis",reviewStatus:"accepted",evidence:[{citation:"Earlier source",locator:""}]});
 const relation=f.store.read().relations[0],plan=f.store.reviews.prepare(f.p.id,0,{...f.choices,identities:{draft_a:a,draft_b:b}});
 assert.equal(plan.relations.length,0);assert.deepEqual(plan.reusedRelations,[id]);f.store.reviews.commit(plan.id,plan.digest);assert.deepEqual(f.store.read().relations,[relation]);
});
test("new duplicate titles inside one proposal and a changed identity-review base are blocked",()=>{
 const f=fixture(),draft=structuredClone(f.review.draft);draft.concepts[1]!.title=draft.concepts[0]!.title;
 f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft});assert.throws(()=>f.store.reviews.prepare(f.p.id,1,f.choices),/Duplicate draft/);
 assert.throws(()=>f.store.reviews.prepare(f.p.id,1,f.choices,999),/Atlas changed/);
});
test("v8 upgrade backs up prior proposals and a migration error leaves its version and data intact",()=>{
 const f=fixture(),db=new DatabaseSync(f.file);db.exec("ALTER TABLE atlas_views DROP COLUMN emphasis; DROP TABLE lesson_reviews; DROP TABLE atlas_drawing_links; DROP TABLE atlas_associations; DROP TABLE atlas_learning_sessions; DROP TABLE atlas_sync_reviews; ALTER TABLE mindmaps DROP COLUMN subjectId; DROP TABLE map_connections; DROP TABLE map_concept_reviews; DROP TABLE map_integrations; DROP TABLE map_reviews; PRAGMA user_version=8");db.close();
 assert.equal(createAtlasStore(f.file).proposals.read(f.p.id)!.digest,f.p.digest);
 assert(fs.readdirSync(path.dirname(f.file)).some(p=>p.includes('.v8-')&&p.endsWith('.bak')));
 const broken=fixture(),old=new DatabaseSync(broken.file);old.exec("ALTER TABLE atlas_views DROP COLUMN emphasis; DROP TABLE lesson_reviews; DROP TABLE atlas_drawing_links; DROP TABLE atlas_associations; DROP TABLE atlas_learning_sessions; DROP TABLE atlas_sync_reviews; ALTER TABLE mindmaps DROP COLUMN subjectId; DROP TABLE map_connections; DROP TABLE map_concept_reviews; DROP TABLE map_integrations; DROP TABLE map_reviews; CREATE TABLE map_reviews(unrecognized TEXT); PRAGMA user_version=8");old.close();
 assert.throws(()=>createAtlasStore(broken.file).read(),/already exists/);
 const unchanged=new DatabaseSync(broken.file);assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version,8);assert.equal(unchanged.prepare('SELECT count(*) AS n FROM map_proposals').get()!.n,2);assert.equal(unchanged.prepare("SELECT name FROM sqlite_master WHERE name='map_integrations'").get(),undefined);unchanged.close();
});
test("unsupported review/approval envelopes and corrupted row identities are refused",()=>{
 const f=fixture();f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft:f.review.draft});
 const db=new DatabaseSync(f.file);db.prepare("UPDATE map_reviews SET record=json_set(record,'$.schemaVersion',2) WHERE proposalId=?").run(f.p.id);db.close();
 assert.throws(()=>f.store.reviews.read(f.p.id),/newer app/);
 const other=fixture(),plan=other.store.reviews.prepare(other.p.id,0,other.choices),changed=new DatabaseSync(other.file);changed.prepare("UPDATE map_integrations SET record=json_set(record,'$.schemaVersion',6) WHERE id=?").run(plan.id);changed.close();
 assert.throws(()=>other.store.reviews.commit(plan.id,plan.digest),/newer app/);assert.equal(other.store.read().concepts.length,0);
});

test("ordinary lines integrate without types or direction and do not enter mathematical path queries",async()=>{
 const {findAtlasPath}=await import('../src/core/atlas-query.ts'),f=fixture(),draft=structuredClone(f.review.draft);
 draft.connections[0]!.relationType=null;draft.connections[0]!.direction='unclear';f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft});
 const plan=f.store.reviews.prepare(f.p.id,1,{...f.choices,connections:[],mapConnections:['edge_qv']});assert.equal(plan.schemaVersion,3);assert.equal(plan.mapConnections!.length,1);assert.equal(plan.relations.length,0);
 f.store.reviews.commit(plan.id,plan.digest);const snapshot=f.store.read();assert.equal(snapshot.relations.length,0);assert.equal(projectAtlas(snapshot).mapEdges.length,1);
 assert.equal(findAtlasPath(snapshot,snapshot.concepts[0]!.id,snapshot.concepts[1]!.id).status,'no-path');assert.equal(snapshot.mapConnections![0]!.uncertainty,draft.connections[0]!.uncertainty);
 const dir=path.join(root,randomUUID());fs.cpSync(path.dirname(f.file),dir,{recursive:true});const db=new DatabaseSync(f.file);await backup(db,path.join(dir,'atlas.sqlite'));db.close();assert.deepEqual(createAtlasStore(path.join(dir,'atlas.sqlite')).read(),snapshot);
});
function legacyIntegration(){
 const f=fixture(),plan=f.store.reviews.prepare(f.p.id,0,{...f.choices,connections:[]}),receipt=f.store.reviews.commit(plan.id,plan.digest);
 // The owner's existing integration is envelope v1; retain its old digest shape.
 const {mapConnections:_lines,digest:_digest,status:_status,committedAt,...content}=receipt;void _lines;void _digest;void _status;
 const old={...content,schemaVersion:1 as const,status:'prepared' as const},digest=createHash('sha256').update(JSON.stringify(old)).digest('hex');
 const record={...old,digest,status:'committed',committedAt},db=new DatabaseSync(f.file);db.prepare('UPDATE map_integrations SET record=? WHERE id=?').run(JSON.stringify(record),receipt.id);db.close();
 return {...f,original:record};
}
test("legacy repair restores missing lines using saved identities, preserving original receipt, nodes and notes",()=>{
 const f=legacyIntegration(),before=f.store.read(),review=f.store.reviews.read(f.p.id),plan=f.store.reviews.prepareConnections(f.p.id,before.layoutRevision!);
 assert.equal(plan.repairOf,f.original.id);assert.equal(plan.concepts.length,0);assert.equal(plan.relations.length,0);assert.equal(plan.mapConnections!.length,1);assert.deepEqual(f.store.read(),before);
 assert.throws(()=>f.store.reviews.commit(plan.id,'0'.repeat(64)),/approval/);
 const competing=f.store.reviews.prepareConnections(f.p.id,before.layoutRevision!),receipt=f.store.reviews.commit(plan.id,plan.digest),after=f.store.read();
 assert.deepEqual(after.concepts,before.concepts);assert.deepEqual(after.relations,before.relations);assert.deepEqual(after.mindmaps,before.mindmaps);assert.equal(after.mapConnections!.length,1);assert.equal(projectAtlas(after).mapEdges.length,1);
 assert.deepEqual(createAtlasStore(f.file).reviews.commit(plan.id,plan.digest),receipt);assert.throws(()=>f.store.reviews.commit(competing.id,competing.digest),/changed/);
 assert.deepEqual(f.store.reviews.read(f.p.id),review);const db=new DatabaseSync(f.file);assert.deepEqual(JSON.parse(String(db.prepare('SELECT record FROM map_integrations WHERE id=?').get(f.original.id)!.record)),f.original);db.close();
 assert.equal(f.store.reviews.prepareConnections(f.p.id,after.layoutRevision!).mapConnections!.length,0);
});
test("repair skips excluded/removed endpoints; removal archives associations instead of stranding references",()=>{
 const f=fixture(),plan=f.store.reviews.prepare(f.p.id,0,{...f.choices,connections:[],mapConnections:['edge_qv']});f.store.reviews.commit(plan.id,plan.digest);
 const concept=f.store.read().concepts[1]!;f.store.save({kind:'concept-delete',id:concept.id,expectedRevision:concept.revision});
 assert.equal(f.store.read().mapConnections!.length,0);const repair=f.store.reviews.prepareConnections(f.p.id,f.store.read().layoutRevision!);assert.equal(repair.mapConnections!.length,0);assert.deepEqual(repair.skippedConnections,['edge_qv']);
 const db=new DatabaseSync(f.file),archive=JSON.parse(String(db.prepare("SELECT record FROM atlas_archive WHERE kind='concept' AND id=?").get(concept.id)!.record));assert.equal(archive.history.length,1);db.close();
 const other=fixture(),excluded=other.store.reviews.prepare(other.p.id,0,{...other.choices,connections:[],identities:{draft_a:'new',draft_b:null}});other.store.reviews.commit(excluded.id,excluded.digest);
 assert.deepEqual(other.store.reviews.prepareConnections(other.p.id,other.store.read().layoutRevision!).skippedConnections,['edge_qv']);
});
test("archived/rewritten sources stop projection and invalidate pending repair",()=>{
 const f=legacyIntegration(),plan=f.store.reviews.prepareConnections(f.p.id,f.store.read().layoutRevision!),map=f.store.read().mindmaps![0]!;
 f.store.mindmaps.setArchived(map.id,map.revision,true);assert.throws(()=>f.store.reviews.commit(plan.id,plan.digest),/archived/);
 assert.throws(()=>f.store.reviews.prepareConnections(f.p.id,f.store.read().layoutRevision!),/archived/);
});
test("a failed repair is atomic and exact retry cannot duplicate nodes or lines",()=>{
 const f=legacyIntegration(),before=f.store.read(),plan=f.store.reviews.prepareConnections(f.p.id,before.layoutRevision!),db=new DatabaseSync(f.file);
 db.exec("CREATE TRIGGER fail_connection BEFORE INSERT ON map_connections BEGIN SELECT RAISE(ABORT,'fixture line failure'); END;");db.close();
 assert.throws(()=>f.store.reviews.commit(plan.id,plan.digest),/fixture line failure/);assert.deepEqual(f.store.read(),before);
 const reset=new DatabaseSync(f.file);reset.exec('DROP TRIGGER fail_connection');reset.close();f.store.reviews.commit(plan.id,plan.digest);assert.equal(f.store.read().concepts.length,2);assert.equal(f.store.read().mapConnections!.length,1);
});
test("v9 upgrade preserves old integration records and creates a recoverable backup",()=>{
 const f=legacyIntegration(),db=new DatabaseSync(f.file);db.exec("ALTER TABLE atlas_views DROP COLUMN emphasis; DROP TABLE lesson_reviews; DROP TABLE atlas_drawing_links; DROP TABLE atlas_associations; DROP TABLE atlas_learning_sessions; DROP TABLE atlas_sync_reviews; ALTER TABLE mindmaps DROP COLUMN subjectId; DROP TABLE map_connections; DROP INDEX one_map_commit; CREATE UNIQUE INDEX one_map_commit ON map_integrations(proposalId) WHERE status='committed'; PRAGMA user_version=9");db.close();
 const store=createAtlasStore(f.file);assert.equal(store.reviews.read(f.p.id).integration!.id,f.original.id);assert.deepEqual(store.read().mapConnections,[]);assert(fs.readdirSync(path.dirname(f.file)).some(p=>p.includes('.v9-')&&p.endsWith('.bak')));
});
test("projection deduplicates repeated drawings, prioritizes typed lines, and hides archived/replaced depictions",()=>{
 const f=fixture(),draft=structuredClone(f.review.draft);draft.connections.push({...draft.connections[0]!,key:'edge_other',source:'draft_b',target:'draft_a'});
 f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft});const plan=f.store.reviews.prepare(f.p.id,1,{...f.choices,connections:[],mapConnections:['edge_qv','edge_other']});f.store.reviews.commit(plan.id,plan.digest);
 const snapshot=f.store.read();assert.equal(snapshot.mapConnections!.length,2);assert.equal(projectAtlas(snapshot).mapEdges.length,1);
 const m=snapshot.mindmaps![0]!;assert.equal(projectAtlas({...snapshot,mindmaps:[{...m,archived:true}]}).mapEdges.length,0);
 assert.equal(projectAtlas({...snapshot,mindmaps:[{...m,currentRevision:'mr_00000000-0000-4000-8000-000000000099'}]}).mapEdges.length,0);
 f.store.save({kind:'relation',id:`ar_${randomUUID()}`,sourceId:snapshot.concepts[0]!.id,targetId:snapshot.concepts[1]!.id,expectedRevision:0,relationType:'application',conditions:'',claimStatus:'external-assertion',reviewStatus:'accepted',evidence:[{citation:'Reviewed separately',locator:''}]});
 assert.equal(projectAtlas(f.store.read()).mapEdges.length,0);assert.equal(projectAtlas(f.store.read()).semanticEdges.length,1);assert.equal(f.store.read().mapConnections!.length,2);
});
test("ordinary connection tampering and future envelopes are refused",()=>{
 const f=fixture(),plan=f.store.reviews.prepare(f.p.id,0,{...f.choices,connections:[],mapConnections:['edge_qv']});f.store.reviews.commit(plan.id,plan.digest);
 const db=new DatabaseSync(f.file);db.exec("UPDATE map_connections SET record=json_set(record,'$.label','Changed outside Atlas')");db.close();assert.throws(()=>f.store.read(),/provenance/);
 const future=new DatabaseSync(f.file);future.exec("UPDATE map_connections SET record=json_set(record,'$.schemaVersion',2)");future.close();assert.throws(()=>f.store.read(),/newer app/);
});

test('repair explicitly reconnects excluded nodes to existing identities and keeps their notes and positions',()=>{
 const f=fixture(),originalPlan=f.store.reviews.prepare(f.p.id,0,{...f.choices,connections:[],identities:{draft_a:null,draft_b:'new'}}),original=f.store.reviews.commit(originalPlan.id,originalPlan.digest),known=`ac_${randomUUID()}`;
 f.store.save({kind:'concept',id:known,expectedRevision:0,title:'Brownian motion',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[],markdown:'Existing owner explanation'});
 const before=f.store.read(),node=before.concepts.find(c=>c.id===known)!,plan=f.store.reviews.prepareConnections(f.p.id,before.layoutRevision!,{draft_a:known});
 assert.deepEqual(plan.relinkedConcepts,[{key:'draft_a',id:known}]);assert.equal(plan.mapConnections!.length,1);assert.equal(plan.skippedConnections!.length,0);assert.equal(plan.concepts.length,0);assert.equal(plan.relations.length,0);assert.deepEqual(f.store.read(),before);
 const receipt=f.store.reviews.commit(plan.id,plan.digest),after=f.store.read(),reused=after.concepts.find(c=>c.id===known)!;
 assert.equal(after.concepts.length,2);assert.equal(after.mapConnections!.length,1);assert.equal(reused.markdown,node.markdown);assert.equal(reused.x,node.x);assert.equal(reused.y,node.y);assert(reused.subjectIds.includes(original.subject!.id));assert(after.mindmaps![0]!.captures[0]!.conceptIds.includes(known));
 assert.deepEqual(f.store.reviews.commit(plan.id,plan.digest),receipt);
 const next=f.store.reviews.prepareConnections(f.p.id,after.layoutRevision!);assert.equal(next.mapConnections!.length,0);assert.equal(next.skippedConnections!.length,0);assert.equal(next.choices.identities.draft_a,known);
 const db=new DatabaseSync(f.file);assert.deepEqual(JSON.parse(String(db.prepare('SELECT record FROM map_integrations WHERE id=?').get(original.id)!.record)),original);db.close();
});
test('relink repair rejects invented endpoints, remapping kept identities and collapsing draft identities',()=>{
 const f=fixture(),original=f.store.reviews.prepare(f.p.id,0,{...f.choices,connections:[],identities:{draft_a:null,draft_b:'new'}});f.store.reviews.commit(original.id,original.digest);const snapshot=f.store.read(),id=snapshot.concepts[0]!.id;
 for(const ids of [{draft_a:`ac_${randomUUID()}`},{unknown:id},{draft_b:id},{draft_a:id}] as Record<string,string>[])assert.throws(()=>f.store.reviews.prepareConnections(f.p.id,snapshot.layoutRevision!,ids),/existing|excluded|one identity/);
});
test('failed relink repair rolls back source memberships and capture references with the lines',()=>{
 const f=fixture(),original=f.store.reviews.prepare(f.p.id,0,{...f.choices,connections:[],identities:{draft_a:null,draft_b:'new'}});f.store.reviews.commit(original.id,original.digest);const known=`ac_${randomUUID()}`;f.store.save({kind:'concept',id:known,expectedRevision:0,title:'Brownian motion',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[]});const before=f.store.read(),plan=f.store.reviews.prepareConnections(f.p.id,before.layoutRevision!,{draft_a:known}),db=new DatabaseSync(f.file);
 db.exec("CREATE TRIGGER fail_relink BEFORE INSERT ON map_connections BEGIN SELECT RAISE(ABORT,'fixture relink failure'); END;");db.close();assert.throws(()=>f.store.reviews.commit(plan.id,plan.digest),/fixture relink failure/);assert.deepEqual(f.store.read(),before);
 const reset=new DatabaseSync(f.file);reset.exec('DROP TRIGGER fail_relink');reset.close();f.store.reviews.commit(plan.id,plan.digest);assert.equal(f.store.read().mapConnections!.length,1);
});

test('a current prepared repair resumes after reload and a stale one is not offered as current',()=>{
 const f=legacyIntegration(),plan=f.store.reviews.prepareConnections(f.p.id,f.store.read().layoutRevision!);assert.equal(createAtlasStore(f.file).reviews.read(f.p.id).connectionRepair!.id,plan.id);
 f.store.save({kind:'concept',id:`ac_${randomUUID()}`,expectedRevision:0,title:'Another concept',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[]});assert.equal(f.store.reviews.read(f.p.id).connectionRepair,undefined);
});

test("editing an imported line overlays its depiction while preserving source, receipt, notes and typed claims",()=>{
 const f=fixture(),plan=f.store.reviews.prepare(f.p.id,0,{...f.choices,connections:[],mapConnections:["edge_qv"]});f.store.reviews.commit(plan.id,plan.digest);
 const before=f.store.read(),line=before.mapConnections![0]!,original=f.store.mindmaps.asset(f.p.sourceRevision,"original").bytes;
 const edit={kind:"drawing-link" as const,id:`dl_${randomUUID()}`,sourceId:line.sourceId,targetId:line.targetId,label:"My link",direction:"both" as const,notes:"Owner context",replaces:line.id,removed:false,expectedRevision:before.layoutRevision!};
 f.store.save(edit);let after=f.store.read();assert.equal(projectAtlas(after).mapEdges.length,1);assert.deepEqual(after.mapConnections,before.mapConnections);assert.deepEqual(after.concepts,before.concepts);assert.deepEqual(after.relations,before.relations);assert.deepEqual(after.mindmaps,before.mindmaps);assert.deepEqual(f.store.reviews.read(f.p.id).integration!.id,plan.id);
 f.store.save({...edit,removed:true,expectedRevision:after.layoutRevision!});after=f.store.read();assert.equal(projectAtlas(after).mapEdges.length,0);assert.equal(after.mapConnections!.length,1);
 assert.deepEqual(f.store.mindmaps.asset(f.p.sourceRevision,"original").bytes,original);
 const map=after.mindmaps![0]!;assert.equal(projectAtlas({...after,mindmaps:[{...map,archived:true}]}).mapEdges.length,0);
 f.store.save({...edit,expectedRevision:after.layoutRevision!});assert.equal(projectAtlas(f.store.read()).mapEdges.length,1);
});
