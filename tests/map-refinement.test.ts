import assert from "node:assert/strict";
import test,{after} from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {gzipSync,crc32,deflateSync} from "node:zlib";
import {DatabaseSync,backup} from "node:sqlite";
import {createFauxCore,fauxAssistantMessage,fauxToolCall} from "@earendil-works/pi-ai";
import {createAtlasStore} from "../src/store/atlas.ts";
import {mapDraft,validateMapDraft,validateMapDraftCoverage,projectMapDraft} from "../src/core/map-draft.ts";
import {draftFixture,draftEvidence} from "./fixtures/map-draft.ts";
import type {MapFindings} from "../src/core/map-proposals.ts";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"atlas-refinement-"));
process.env.LH_DATA_DIR=root;process.env.LH_AUTH_FILE=path.join(root,"auth.json");process.env.RNOTE_CLI=path.join(root,"missing");
const {createMapProposalService}=await import("../src/server/map-proposals.ts");
after(()=>fs.rmSync(root,{recursive:true,force:true}));
function chunk(type:string,b:Buffer){const out=Buffer.alloc(b.length+12);out.writeUInt32BE(b.length);out.write(type,4);b.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,8+b.length)),8+b.length);return out;}
const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),chunk("IHDR",header),chunk("IDAT",deflateSync(Buffer.from([0,255,255,255,255]))),chunk("IEND",Buffer.alloc(0))]);
const reading:MapFindings & {depictions:[]}={transcription:"Brownian motion and an unclear formula",concepts:draftFixture.concepts.map(n=>({key:n.key,title:n.key==="draft_b"?"Q [unclear]":n.title,aliases:[],existingId:null,notes:"First reading.",evidence:draftEvidence,uncertainty:"Formula unclear."})),relations:[],depictions:[],questions:["What is the notation?"]};
function fixture(){
	const file=path.join(root,randomUUID(),"atlas.sqlite"),store=createAtlasStore(file),source=`mr_${randomUUID()}`;
	store.mindmaps.capture({id:`mm_${randomUUID()}`,captureId:source,expectedRevision:0,title:"Fixture",filename:"source.rnote",conceptIds:[],manualPreviewAcknowledged:true},gzipSync("opaque fixture"),png,{validation:"unverified",previewKind:"manual-png",notice:null});
	const faux=createFauxCore({models:[{id:"vision",input:["text","image"],maxTokens:12000}]}),engine={model:faux.getModel(),streamFn:faux.streamSimple};
	return {file,store,source,faux,engine,model:`${engine.model.provider}:${engine.model.id}`};
}
const command=(f:ReturnType<typeof fixture>,parentId?:string)=>({id:`mp_${randomUUID()}`,sourceRevision:f.source,expectedModel:f.model,consent:true,...(parentId?{parentId}:{})});
const signal=()=>new AbortController().signal;

test("second pass retains source/parent, notes and usage; reopening, idempotency and backup never change Atlas",async()=>{
	const f=fixture();let calls=0;
	f.faux.setResponses([()=>{calls++;return fauxAssistantMessage(fauxToolCall("submit_map_proposal",reading),{stopReason:"toolUse"});},context=>{
		calls++;const content=context.messages.filter(m=>m.role==="user").flatMap(m=>Array.isArray(m.content)?m.content:[]);
		assert(content.some(c=>c.type==="image"));assert(content.some(c=>c.type==="text"&&c.text.includes("Formula unclear.")));
		return fauxAssistantMessage(fauxToolCall("submit_map_draft",draftFixture),{stopReason:"toolUse"});
	}]);
	const service=createMapProposalService(f.store,()=>f.engine),before=f.store.read(),parent=await service.generate(command(f),signal());
	assert.equal(parent?.status,"prepared");const retained=f.store.proposals.read(parent!.id),request=command(f,parent!.id),result=await service.generate(request,signal());
	assert.equal(result?.status,"prepared");assert.equal(result?.schemaVersion,3);assert.deepEqual(result?.draft,draftFixture);assert.equal(result?.findings,null);
	assert.deepEqual(result?.refinement,{parentId:parent!.id,parentDigest:parent!.digest});assert.equal(result?.usage?.steps,1);assert.deepEqual(result?.images,parent?.images);
	assert.deepEqual(f.store.proposals.read(parent!.id),retained);assert.deepEqual(f.store.read(),before);
	assert.equal((await service.generate(request,signal()))?.id,result?.id);assert.equal((await service.generate(command(f,parent!.id),signal()))?.id,result?.id);assert.equal(calls,2);
	await assert.rejects(()=>service.generate({...request,parentId:result!.id},signal()),/token/);
	await assert.rejects(()=>service.generate(command(f,result!.id),signal()),/prepared first reading/);
	await assert.rejects(()=>service.generate(command(f,`mp_${randomUUID()}`),signal()),/prepared first reading/);
	assert.equal(service.read(f.source,parent!.id)?.findings?.transcription,reading.transcription);assert.equal(service.read(f.source)?.attempts?.[1]?.kind,"refinement");
	const target=path.join(root,randomUUID());fs.mkdirSync(target);const db=new DatabaseSync(f.file);await backup(db,path.join(target,"atlas.sqlite"));db.close();
	fs.cpSync(path.join(path.dirname(f.file),"mindmaps"),path.join(target,"mindmaps"),{recursive:true});const copy=createAtlasStore(path.join(target,"atlas.sqlite"));
	assert.deepEqual(copy.proposals.read(result!.id)?.draft,draftFixture);assert.deepEqual(copy.proposals.image(result!.images[0]!),png);
	const edit=new DatabaseSync(f.file),row=edit.prepare("SELECT record FROM map_proposals WHERE id=?").get(result!.id)!;const raw=JSON.parse(String(row.record));raw.draft.concepts[0].notes[1].origin="source";
	edit.prepare("UPDATE map_proposals SET record=? WHERE id=?").run(JSON.stringify(raw),result!.id);assert.throws(()=>f.store.proposals.read(result!.id),/changed outside/);edit.close();
});

test("refinement validation blocks invented grounding, identities, endpoints and unlabelled inference",()=>{
	assert.equal(validateMapDraft(mapDraft.parse(draftFixture),reading,[],1),null);
	const bad=()=>structuredClone(draftFixture);
	let d=bad();d.concepts[0]!.sourceKeys=["draft_fake"];assert.match(validateMapDraft(d,reading,[],1)!,/Source keys/);
	d=bad();d.concepts[0]!.notes[0]!.evidence=[];assert.match(validateMapDraft(d,reading,[],1)!,/visible image/);
	d=bad();d.concepts[1]!.rationale="";assert.match(validateMapDraft(d,reading,[],1)!,/rationale/);
	d=bad();d.connections[0]!.target="draft_fake";assert.match(validateMapDraft(d,reading,[],1)!,/endpoints/);
	d=bad();d.connections[0]!.evidence[0]!.page=7;assert.match(validateMapDraft(d,reading,[],1)!,/image does not/);
	d=bad();d.concepts[0]!.existingId=`ac_${randomUUID()}`;assert.match(validateMapDraft(d,reading,[],1)!,/identities/);
});

test("private projection is deterministic, preserves origin/direction and does not mutate the draft",()=>{
	const draft=structuredClone(draftFixture),before=JSON.stringify(draft),a=projectMapDraft(draft),b=projectMapDraft(draft);
	assert.deepEqual(a,b);assert.equal(JSON.stringify(draft),before);assert(a.nodes.every(n=>Number.isFinite(n.x+n.y)&&n.id.startsWith("draft_")));
	assert.equal(a.edges.length,1);draft.connections[0]!.direction="unclear";assert.equal(projectMapDraft(draft).semanticEdges.length,1);
	draft.connections[0]!.direction="both";assert.equal(projectMapDraft(draft).edges.length,2);assert.equal(projectMapDraft(draft).nodes[1]!.color,"#e6b35a");
});

test("generation accounts for every reading and formula, while owner edits remain possible",()=>{
	const source=structuredClone(reading),draft=structuredClone(draftFixture),formula="dX_t=\\theta(\\mu-X_t)dt+\\sigma dB_t";
	source.concepts[0]!.formulas=[formula];
	assert.match(validateMapDraftCoverage(draft,source)!,/Retain the first-reading formula/);
	draft.concepts[0]!.notes[0]!.text=`Earlier, possibly incorrect reading: \\[${formula}\\]`;
	assert.equal(validateMapDraftCoverage(draft,source),null);
	draft.concepts[1]!.sourceKeys=[];
	assert.match(validateMapDraftCoverage(draft,source)!,/Account for first-reading concept/);
	// The strict coverage gate applies to model generation, not deliberate owner edits.
	assert.equal(validateMapDraft(draft,source,[],1),null);
});

test("refinement retries omitted formulas, preserves the inventory and leaves prior records unchanged",async()=>{
	const f=fixture(),source=structuredClone(reading),formula="dX_t=aX_tdt+bX_tdB_t";
	source.concepts[0]!.formulas=[formula];source.concepts[0]!.notes=`\\[${formula}\\]`;
	const service=createMapProposalService(f.store,()=>f.engine,async()=>source);
	const parent=await service.generate(command(f),signal()),before=f.store.proposals.read(parent!.id),draft=structuredClone(draftFixture);
	draft.concepts[0]!.notes[0]!.text=`Earlier reading: \\[${formula}\\]`;
	f.faux.setResponses([
		fauxAssistantMessage(fauxToolCall("submit_map_draft",draftFixture),{stopReason:"toolUse"}),
		fauxAssistantMessage(fauxToolCall("submit_map_draft",draft),{stopReason:"toolUse"}),
	]);
	const result=await service.generate(command(f,parent!.id),signal());
	assert.equal(result?.status,"prepared");assert.equal(result?.usage?.steps,2);
	assert(result?.draft?.concepts[0]!.notes[0]!.text.includes(formula));
	assert.deepEqual(f.store.proposals.read(parent!.id),before);
});

test("failed and cancelled refinement preserve the reading; explicit retry retains separate attempts",async()=>{
	const f=fixture(),base=createMapProposalService(f.store,()=>f.engine,async()=>reading),parent=await base.generate(command(f),signal()),before=f.store.read();
	const failed=createMapProposalService(f.store,()=>f.engine,undefined,undefined,undefined,async()=>{throw Error("raw provider secret");});
	const result=await failed.generate(command(f,parent!.id),signal());assert.equal(result?.status,"failed");assert(!result?.error?.includes("secret"));assert.equal(result?.draft,null);
	const controller=new AbortController(),cancelled=createMapProposalService(f.store,()=>f.engine,undefined,undefined,undefined,async()=>{controller.abort();throw Error("abort");});
	assert.equal((await cancelled.generate(command(f,parent!.id),controller.signal))?.status,"cancelled");
	const retry=createMapProposalService(f.store,()=>f.engine,undefined,undefined,undefined,async()=>draftFixture);
	assert.equal((await retry.generate(command(f,parent!.id),signal()))?.status,"prepared");assert.equal(f.store.proposals.read(parent!.id)?.status,"prepared");assert.deepEqual(f.store.read(),before);
	assert.equal(f.store.proposals.history(f.source).length,4);
});
