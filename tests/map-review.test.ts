import assert from "node:assert/strict";
import test,{after} from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
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
	const choices:IntegrationChoices={identities:{draft_a:"new",draft_b:"new"},subjectId:null,connections:["edge_qv"]};
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
 const f=fixture(),db=new DatabaseSync(f.file);db.exec("DROP TABLE map_concept_reviews; DROP TABLE map_integrations; DROP TABLE map_reviews; PRAGMA user_version=8");db.close();
 assert.equal(createAtlasStore(f.file).proposals.read(f.p.id)!.digest,f.p.digest);
 assert(fs.readdirSync(path.dirname(f.file)).some(p=>p.includes('.v8-')&&p.endsWith('.bak')));
 const broken=fixture(),old=new DatabaseSync(broken.file);old.exec("DROP TABLE map_concept_reviews; DROP TABLE map_integrations; DROP TABLE map_reviews; CREATE TABLE map_reviews(unrecognized TEXT); PRAGMA user_version=8");old.close();
 assert.throws(()=>createAtlasStore(broken.file).read(),/already exists/);
 const unchanged=new DatabaseSync(broken.file);assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version,8);assert.equal(unchanged.prepare('SELECT count(*) AS n FROM map_proposals').get()!.n,2);assert.equal(unchanged.prepare("SELECT name FROM sqlite_master WHERE name='map_integrations'").get(),undefined);unchanged.close();
});
test("unsupported review/approval envelopes and corrupted row identities are refused",()=>{
 const f=fixture();f.store.reviews.save({proposalId:f.p.id,expectedRevision:0,draft:f.review.draft});
 const db=new DatabaseSync(f.file);db.prepare("UPDATE map_reviews SET record=json_set(record,'$.schemaVersion',2) WHERE proposalId=?").run(f.p.id);db.close();
 assert.throws(()=>f.store.reviews.read(f.p.id),/newer app/);
 const other=fixture(),plan=other.store.reviews.prepare(other.p.id,0,other.choices),changed=new DatabaseSync(other.file);changed.prepare("UPDATE map_integrations SET record=json_set(record,'$.schemaVersion',2) WHERE id=?").run(plan.id);changed.close();
 assert.throws(()=>other.store.reviews.commit(plan.id,plan.digest),/newer app/);assert.equal(other.store.read().concepts.length,0);
});
