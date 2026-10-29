import assert from "node:assert/strict";
import test,{after} from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {crc32,deflateSync,gzipSync} from "node:zlib";
import {DatabaseSync,backup} from "node:sqlite";
import {createFauxCore,fauxAssistantMessage,fauxToolCall} from "@earendil-works/pi-ai";
import {createAtlasStore} from "../src/store/atlas.ts";
import {AtlasError} from "../src/core/atlas.ts";
import {validateMapFindings,type MapFindings} from "../src/core/map-proposals.ts";
import {interpretMap} from "../src/agent/subagents/map-interpretation.ts";

const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-proposals-'));
process.env.LH_DATA_DIR=root;process.env.LH_AUTH_FILE=path.join(root,'auth.json');process.env.RNOTE_CLI=path.join(root,'missing');
const {createMapProposalService,mapProposalResponse}=await import('../src/server/map-proposals.ts');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
function chunk(type:string,b:Buffer){const c=Buffer.alloc(b.length+12);c.writeUInt32BE(b.length);c.write(type,4);b.copy(c,8);c.writeUInt32BE(crc32(c.subarray(4,8+b.length)),8+b.length);return c;}
const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,255,255,255]))),chunk('IEND',Buffer.alloc(0))]);
const evidence={page:0,quote:'Brownian motion',region:{x:0.1,y:0.1,w:0.4,h:0.3}};
const findings:MapFindings={transcription:'Brownian motion',concepts:[{key:'draft_a',title:'Brownian motion',aliases:[],existingId:null,notes:'Visible label.',evidence,uncertainty:''}],relations:[],questions:['What assumptions does the arrow require?']};
function engine() {
 const faux=createFauxCore({models:[{id:'map-vision',input:['text','image'],maxTokens:9000}]});
 return {faux,engine:{model:faux.getModel(),streamFn:faux.streamSimple}};
}
function fixture(previewKind:'manual-png'|'rnote-thumbnail'='manual-png') {
 const file=path.join(root,randomUUID(),'atlas.sqlite'),store=createAtlasStore(file),id=`ac_${randomUUID()}`,mapId=`mm_${randomUUID()}`,source=`mr_${randomUUID()}`;
 store.save({kind:'concept',id,expectedRevision:0,title:'Brownian motion',aliases:['Wiener process'],subjectIds:[],preferredSubjectId:null,propositionIds:[]});
 store.mindmaps.capture({id:mapId,captureId:source,expectedRevision:0,title:'Fixture',filename:'source.rnote',conceptIds:[id],manualPreviewAcknowledged:previewKind==='manual-png'},gzipSync('opaque fixture'),png,{validation:'unverified',previewKind,notice:null});
 const pair=engine();return {file,store,id,source,...pair};
}
const command=(source:string,model:string,id=`mp_${randomUUID()}`)=>({id,sourceRevision:source,expectedModel:model,consent:true as const});

test('page export failure retains the attempt without invoking the model or changing the graph',async()=>{
 const f=fixture('rnote-thumbnail'),before=f.store.read();let calls=0;
 const service=createMapProposalService(f.store,()=>f.engine,async()=>{calls++;return findings;},async()=>{throw new AtlasError('Rnote page export timed out. No model request was made.',422);});
 const result=await service.generate(command(f.source,`${f.engine.model.provider}:${f.engine.model.id}`),new AbortController().signal);
 assert.equal(result?.status,'failed');assert.equal(calls,0);assert.deepEqual(result?.images,[]);assert.equal(result?.usage,undefined);
 assert.match(result!.error!,/page export timed out/);assert.deepEqual(f.store.read(),before);
});

test('image-aware submit reuses extraction runner, retains proposal/usage/pages, and never writes knowledge',async()=>{
 const f=fixture(),before=f.store.read();let calls=0,imageSeen=false;
 f.faux.setResponses([context=>{
  calls++;imageSeen=context.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image'));
  return fauxAssistantMessage([fauxToolCall('submit_map_proposal',findings)],{stopReason:'toolUse'});
 }]);
 const service=createMapProposalService(f.store,()=>f.engine),request=command(f.source,`${f.engine.model.provider}:${f.engine.model.id}`);
 const result=await service.generate(request,new AbortController().signal);
 assert.equal(result?.status,'prepared');assert.equal(calls,1);assert(imageSeen);assert(result?.digest);assert(result?.usage?.steps);
 assert.deepEqual(result.findings,findings);assert.deepEqual(f.store.read(),before);
 assert.deepEqual(f.store.proposals.image(result.images[0]!),png);
 assert.deepEqual(createAtlasStore(f.file).proposals.read(result.id)!.findings,findings);
 const restored=path.join(root,randomUUID());fs.mkdirSync(restored);const connection=new DatabaseSync(f.file);
 await backup(connection,path.join(restored,'atlas.sqlite'));connection.close();
 fs.cpSync(path.join(path.dirname(f.file),'mindmaps'),path.join(restored,'mindmaps'),{recursive:true});
 const copy=createAtlasStore(path.join(restored,'atlas.sqlite'));
 assert.equal(copy.proposals.read(result.id)!.digest,result.digest);assert.deepEqual(copy.proposals.image(result.images[0]!),png);
 await service.generate(request,new AbortController().signal);assert.equal(calls,1);
 await service.generate(command(f.source,request.expectedModel),new AbortController().signal);assert.equal(calls,1);
 assert.throws(()=>f.store.proposals.update({...f.store.proposals.read(result.id)!,status:'failed'}),/no longer running/);
 const db=new DatabaseSync(f.file),raw=db.prepare('SELECT record FROM map_proposals').get()!;
 db.prepare('UPDATE map_proposals SET record=?').run(JSON.stringify({...JSON.parse(String(raw.record)),findings:{...findings,transcription:'tampered'}}));
 assert.throws(()=>f.store.proposals.read(result.id),/changed outside/);db.close();
});

test('strict matching, evidence pages and relation endpoints block hallucinated identity and invalid references',()=>{
 const context=[{id:`ac_${randomUUID()}`,title:'Brownian motion',aliases:['Wiener process'],revision:1}];
 assert.equal(validateMapFindings({...findings,concepts:[{...findings.concepts[0]!,title:'Wiener process',existingId:context[0]!.id}]},context,1),null);
 for(const value of [
  {...findings,concepts:[{...findings.concepts[0]!,existingId:`ac_${randomUUID()}`}]},
  {...findings,concepts:[{...findings.concepts[0]!,title:'Unrelated idea',existingId:context[0]!.id}]},
  {...findings,concepts:[{...findings.concepts[0]!,evidence:{...evidence,page:1}}]},
  {...findings,relations:[{source:'missing',target:'draft_a',type:'analogy' as const,conditions:'',uncertainty:'',evidence}]},
 ])assert(validateMapFindings(value,context,1));
});

test('schema repair is bounded, records both calls, and invalid findings cannot become a prepared proposal',async()=>{
 const f=fixture(),service=createMapProposalService(f.store,()=>f.engine);let calls=0;
 f.faux.setResponses([()=>{calls++;return fauxAssistantMessage(fauxToolCall('submit_map_proposal',{...findings,concepts:[{...findings.concepts[0]!,existingId:`ac_${randomUUID()}`}]}),{stopReason:'toolUse'});},()=>{calls++;return fauxAssistantMessage(fauxToolCall('submit_map_proposal',findings),{stopReason:'toolUse'});}]);
 const p=await service.generate(command(f.source,`${f.engine.model.provider}:${f.engine.model.id}`),new AbortController().signal);
 assert.equal(calls,2);assert.equal(p?.status,'prepared');assert.equal(p?.usage?.steps,2);
 const bad=fixture();bad.faux.setResponses([fauxAssistantMessage('no submission'),fauxAssistantMessage('still no submission')]);
 const failed=await createMapProposalService(bad.store,()=>bad.engine).generate(command(bad.source,`${bad.engine.model.provider}:${bad.engine.model.id}`),new AbortController().signal);
 assert.equal(failed?.status,'failed');assert.equal(failed?.findings,null);assert(failed?.error);
});

test('model destination consent, export limits and missing configuration refuse before sending source images',async()=>{
 const f=fixture();let calls=0;
 const service=createMapProposalService(f.store,()=>f.engine,async()=>{calls++;return findings;});
 await assert.rejects(()=>service.generate({...command(f.source,'changed:model')},new AbortController().signal),/model changed/);
 await assert.rejects(()=>service.generate({...command(f.source,'x'),consent:false},new AbortController().signal),/Invalid/);
 assert.equal(calls,0);assert.equal(f.store.proposals.history(f.source).length,0);
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>service.generate(command(f.source,`${f.engine.model.provider}:${f.engine.model.id}`),controller.signal),/cancelled/);
 assert.equal(calls,0);
 const response=await mapProposalResponse(new Request('http://localhost/api/atlas/proposals?config=1'));
 assert.equal(response.status,503);
});

test('concurrent generation is refused, cancellation persists, and explicit retry keeps earlier attempt accounting',async()=>{
 const f=fixture();let started!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>started=resolve),hold=new Promise<void>(resolve=>release=resolve);
 const service=createMapProposalService(f.store,()=>f.engine,async(_e,_p,_c,signal)=>{started();await hold;if(signal.aborted)throw Error('aborted');return findings;});
 const controller=new AbortController(),model=`${f.engine.model.provider}:${f.engine.model.id}`;
 const first=service.generate(command(f.source,model),controller.signal);await entered;
 await assert.rejects(()=>service.generate(command(f.source,model),new AbortController().signal),/already/);
 controller.abort();release();assert.equal((await first)?.status,'cancelled');
 const retry=createMapProposalService(f.store,()=>f.engine,async()=>findings);
 assert.equal((await retry.generate(command(f.source,model),new AbortController().signal))?.status,'prepared');
 assert.equal(retry.read(f.source)?.attempts?.length,2);
});

test('restart leaves an interrupted attempt without auto retry; v7 migration and future proposal versions are guarded',async()=>{
 const f=fixture(),db=new DatabaseSync(f.file),source=f.store.read().mindmaps![0]!.captures[0]!;
 const at=new Date().toISOString(),record={schemaVersion:1 as const,id:`mp_${randomUUID()}`,sourceRevision:f.source,sourceHash:source.hash,baseRevision:f.store.read().layoutRevision!,context:[],model:'fake:vision',status:'running' as const,images:[],findings:null,digest:null,createdAt:at,updatedAt:at,error:null};
 assert(f.store.proposals.begin(record));db.prepare("UPDATE map_proposals SET owner='previous process'").run();
 assert.equal(createAtlasStore(f.file).proposals.latest(f.source)?.status,'failed');
 const row=db.prepare('SELECT record FROM map_proposals').get()!;
 db.prepare('UPDATE map_proposals SET record=?').run(JSON.stringify({...JSON.parse(String(row.record)),schemaVersion:2}));
 assert.throws(()=>f.store.proposals.latest(f.source),/newer app/);
 db.exec('DROP TABLE map_proposals; PRAGMA user_version=7');db.close();
 const before=f.store.read();assert.deepEqual(createAtlasStore(f.file).read(),before);
 assert(fs.readdirSync(path.dirname(f.file)).some(n=>n.includes('.v7-')));
});
