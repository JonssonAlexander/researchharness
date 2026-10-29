import assert from "node:assert/strict";
import test, {after} from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {gzipSync, deflateSync, crc32} from "node:zlib";
import {DatabaseSync, backup} from "node:sqlite";
import {createAtlasStore} from "../src/store/atlas.ts";
import {mindmapInput, MINDMAP_LIMITS, type MindmapInput} from "../src/core/mindmaps.ts";

const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-mindmaps-test-'));
process.env.LH_DATA_DIR=root; process.env.LH_AUTH_FILE=path.join(root,'auth.json');
process.env.RNOTE_CLI=path.join(root,'not-installed'); // no native processes in deterministic tests
const {createMindmapService,importMindmapResponse,archiveMindmapResponse,mindmapAssetResponse}=await import('../src/server/mindmaps.ts');
const {prepareRnote,validateMindmapPng}=await import('../src/server/rnote.ts');
const {stores}=await import('../src/server/stores.ts');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const original=gzipSync('opaque source fixture, not a claim of native Rnote validity');
function chunk(type:string,data:Buffer) {
 const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);
 out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);return out;
}
function png(raw=Buffer.from([0,255,255,255,255])) {
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const preview=png();
const input=():MindmapInput=>({id:`mm_${randomUUID()}`,captureId:`mr_${randomUUID()}`,expectedRevision:0,title:'A map',filename:'a.rnote',conceptIds:[],manualPreviewAcknowledged:false});
function fixture() {
 const file=path.join(root,randomUUID(),'atlas.sqlite');const store=createAtlasStore(file);store.read();
 return {file,store,service:createMindmapService(store)};
}
const info={validation:'unverified' as const,previewKind:'none' as const,notice:'Fixture'};

test('immutable revisions preserve exact original bytes, source links and history through reopen and backup restore',async()=>{
 const {store,file}=fixture();const id=`ac_${randomUUID()}`;
 store.save({kind:'concept',id,expectedRevision:0,title:'Brownian motion',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[]});
 const before=store.read(),a={...input(),conceptIds:[id]};
 store.mindmaps.capture(a,original,null,info);
 const second={...a,captureId:`mr_${randomUUID()}`,expectedRevision:1,title:'Rewritten map',conceptIds:[]};
 const changed=gzipSync('replacement handwriting');
 store.mindmaps.capture(second,changed,preview,{...info,previewKind:'rnote-thumbnail'});
 const snapshot=createAtlasStore(file).read(),map=snapshot.mindmaps![0]!;
 assert.equal(map.captures.length,2);assert.equal(map.id,a.id);assert.deepEqual(map.captures[0]!.conceptIds,[id]);
 assert.deepEqual(store.mindmaps.asset(a.captureId,'original').bytes,original);
 assert.deepEqual(store.mindmaps.asset(second.captureId,'original').bytes,changed);
 assert.deepEqual(store.mindmaps.asset(second.captureId,'preview').bytes,preview);
 assert.deepEqual(snapshot.concepts,before.concepts);assert.equal(snapshot.layoutRevision,before.layoutRevision);
 const restored=path.join(root,randomUUID());fs.mkdirSync(restored);
 const db=new DatabaseSync(file);await backup(db,path.join(restored,'atlas.sqlite'));db.close();
 fs.cpSync(path.join(path.dirname(file),'mindmaps'),path.join(restored,'mindmaps'),{recursive:true});
 const copy=createAtlasStore(path.join(restored,'atlas.sqlite'));
 assert.deepEqual(copy.read(),snapshot);assert.deepEqual(copy.mindmaps.asset(a.captureId,'original').bytes,original);
});

test('an interrupted metadata commit leaves only reusable blobs; retries are idempotent and conflicting tokens are refused',()=>{
 const {store,file}=fixture(),a=input();
 const db=new DatabaseSync(file);
 db.exec("CREATE TRIGGER reject_capture BEFORE INSERT ON mindmap_captures BEGIN SELECT RAISE(ABORT,'injected interruption'); END");
 assert.throws(()=>store.mindmaps.capture(a,original,null,info),/interruption/);
 assert.deepEqual(store.read().mindmaps,[]);assert.equal(fs.readdirSync(path.join(path.dirname(file),'mindmaps','revisions')).length,1);
 db.exec('DROP TRIGGER reject_capture');db.close();
 store.mindmaps.capture(a,original,null,info);const before=store.read();
 store.mindmaps.capture(a,original,null,info);assert.deepEqual(store.read(),before);
 assert.throws(()=>store.mindmaps.capture({...a,title:'Changed payload'},original,null,info),/token/);
 assert.throws(()=>store.mindmaps.capture({...a,captureId:`mr_${randomUUID()}`},original,null,info),/changed/);
 assert.deepEqual(store.read(),before);
});

test('stale links are refused; archive and restore preserve every revision; missing/corrupt/symlinked assets fail visibly',()=>{
 const {store,file}=fixture(),a=input();
 assert.throws(()=>store.mindmaps.capture({...a,conceptIds:[`ac_${randomUUID()}`]},original,null,info),/removed/);
 store.mindmaps.capture(a,original,null,info);store.mindmaps.setArchived(a.id,1,true);
 assert.equal(store.read().mindmaps![0]!.archived,true);
 assert.deepEqual(store.mindmaps.asset(a.captureId,'original').bytes,original);
 assert.throws(()=>store.mindmaps.setArchived(a.id,1,false),/changed/);
 assert.throws(()=>store.mindmaps.capture({...a,captureId:`mr_${randomUUID()}`,expectedRevision:2},original,null,info),/archived/);
 store.mindmaps.setArchived(a.id,2,false);assert.equal(store.read().mindmaps![0]!.archived,false);
 const capture=store.read().mindmaps![0]!.captures[0]!,folder=path.join(path.dirname(file),'mindmaps','revisions');
 const target=path.join(folder,`${capture.hash}.rnote`);fs.writeFileSync(target,'changed');
 assert.throws(()=>store.mindmaps.asset(a.captureId,'original'),/changed outside/);
 fs.unlinkSync(target);const external=path.join(root,'external');fs.writeFileSync(external,original);fs.symlinkSync(external,target);
 assert.throws(()=>store.mindmaps.asset(a.captureId,'original'),/ELOOP/);
 fs.unlinkSync(target);assert.throws(()=>store.mindmaps.asset(a.captureId,'original'),/ENOENT/);
 fs.rmSync(folder,{recursive:true});fs.symlinkSync(path.dirname(external),folder);
 assert.throws(()=>store.mindmaps.capture({...a,captureId:`mr_${randomUUID()}`,expectedRevision:3},original,null,info),/regular directory/);
 assert.deepEqual(fs.readFileSync(external),original);
});

test('PNG validation rejects corruption, scripts, decompression overflow and bad scanlines; missing exporter is honest',async()=>{
 validateMindmapPng(preview);
 for(const bytes of [Buffer.from('<svg/>'),preview.subarray(0,-1),Buffer.from(preview),png(Buffer.alloc(4096)),png(Buffer.from([5,1,2,3,4]))]) {
  if(bytes.length===preview.length) bytes[bytes.length-1]=bytes[bytes.length-1]!^1;
  assert.throws(()=>validateMindmapPng(bytes),/PNG/);
 }
 assert.throws(()=>mindmapInput.parse({...input(),filename:'../map.rnote'}));
 assert.throws(()=>mindmapInput.parse({...input(),filename:'map.svg'}));
 const prepared=await prepareRnote(original,preview);assert.equal(prepared.info.validation,'unverified');assert.equal(prepared.info.previewKind,'manual-png');
 await assert.rejects(()=>prepareRnote(Buffer.from('bad'),null),/\.rnote/);
 await assert.rejects(()=>prepareRnote(Buffer.from([0x1f,0x8b,8,0]),null),/damaged/);
});

function request(a:MindmapInput,source:Buffer=original,png?:Buffer) {
 const form=new FormData();form.set('metadata',JSON.stringify(a));form.set('original',new File([new Uint8Array(source)],a.filename));
 if(png)form.set('preview',new File([new Uint8Array(png)],'preview.png'));
 return new Request('http://localhost/api/atlas/mindmaps',{method:'POST',body:form});
}
test('bounded HTTP import binds preview to an exact revision, serves safe downloads, and never changes canonical ledgers',async()=>{
 const before=stores.atlasStore.read(),a={...input(),manualPreviewAcknowledged:true};
 const response=await importMindmapResponse(request(a,original,preview));assert.equal(response.status,200);
 const state=await response.json();assert.equal(state.mindmaps.length,1);assert.deepEqual(state.concepts,before.concepts);
 assert.equal(state.layoutRevision,before.layoutRevision);
 const download=mindmapAssetResponse(new Request(`http://localhost/api/atlas/mindmaps?revision=${a.captureId}&kind=original`));
 assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')!,/attachment/);
 assert.equal(download.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await download.arrayBuffer()),original);
 assert.equal(mindmapAssetResponse(new Request(`http://localhost/api/atlas/mindmaps?revision=../../etc/passwd&kind=preview`)).status,400);
 assert.equal((await importMindmapResponse(request({...input(),manualPreviewAcknowledged:false},original,preview))).status,400);
 assert.equal((await importMindmapResponse(request(input(),Buffer.from('invalid')))).status,400);
 assert.equal((await importMindmapResponse(new Request('http://localhost',{method:'POST',body:'x'}))).status,415);
 assert.equal((await importMindmapResponse(new Request('http://localhost',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=x','content-length':String(MINDMAP_LIMITS.request+1)},body:'x'}))).status,413);
 const archived=await archiveMindmapResponse(new Request('http://localhost',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:a.id,expectedRevision:1,archived:true})}));
 assert.equal(archived.status,200);assert.equal((await archived.json()).mindmaps[0].archived,true);
 assert.deepEqual(stores.graphStore.readNodes(),[]);
});

test('schema v6 upgrade preserves metadata, creates a backup and rolls back a failed migration',()=>{
 const {store,file}=fixture(),before=store.read(),db=new DatabaseSync(file);
 db.exec('DROP TABLE map_connections; DROP TABLE map_concept_reviews; DROP TABLE map_integrations; DROP TABLE map_reviews; DROP TABLE map_proposals; DROP TABLE mindmap_captures; DROP TABLE mindmaps; PRAGMA user_version=6');db.close();
 assert.deepEqual(createAtlasStore(file).read(),before);
 const old=fs.readdirSync(path.dirname(file)).find(f=>f.includes('.v6-'))!;
 const saved=new DatabaseSync(path.join(path.dirname(file),old));assert.equal(saved.prepare('PRAGMA user_version').get()!.user_version,6);saved.close();
 const broken=new DatabaseSync(file);broken.exec('PRAGMA user_version=6');broken.close();
 assert.throws(()=>createAtlasStore(file).read(),/already exists/);
 const unchanged=new DatabaseSync(file);assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version,6);unchanged.close();
});

test('unsupported source envelopes and mismatched capture identities are refused without repair',()=>{
 const {store,file}=fixture(),a=input();store.mindmaps.capture(a,original,null,info);
 const db=new DatabaseSync(file),row=db.prepare('SELECT record FROM mindmap_captures').get()!;
 const record=JSON.parse(String(row.record));
 db.prepare('UPDATE mindmap_captures SET record=?').run(JSON.stringify({...record,schemaVersion:2}));
 assert.throws(()=>store.read(),/newer app/);
 db.prepare('UPDATE mindmap_captures SET record=?').run(JSON.stringify({...record,id:`mr_${randomUUID()}`}));
 assert.throws(()=>store.read(),/identity|references/);db.close();
});
