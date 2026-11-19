import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createAtlasStore} from '../src/store/atlas.ts';
import {createResearchIntegrationService} from '../src/server/research-integration.ts';
import type {ResearchStore,ResearchTrail,ResearchNode,ResearchWorkspace} from '../src/core/research-trails.ts';
import type {ResearchIntegrationStore,PreparedResearch,ResearchCheckpoint} from '../src/core/research-integration.ts';

const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
test('bounded source review preserves batches, rejects stale files and gates artifacts',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'research-integration-'));
 try {
  fs.mkdirSync(path.join(temp,'project')); const root=fs.realpathSync(path.join(temp,'project'));
  const trailId=`rt_${randomUUID()}`, nodeId=`rn_${randomUUID()}`, workspaceId=`rw_${randomUUID()}`, now=new Date().toISOString();
  const trail:ResearchTrail={id:trailId,title:'Trail',rootNodeId:nodeId,status:'active',workspaceId,primaryConceptId:null,anchorConceptIds:[],linkedConceptIds:[],origin:{kind:'manual'},revision:1,createdAt:now,updatedAt:now,archivedAt:null,missingConceptIds:[]};
  const node:ResearchNode={id:nodeId,trailId,parentNodeId:null,kind:'question',title:'Question?',body:'',relatedConceptIds:[],revision:1,createdAt:now,updatedAt:now,missingConceptIds:[]};
  const workspace:ResearchWorkspace={id:workspaceId,label:'Project',localRoot:root,revision:1,provision:'ready',createdAt:now,updatedAt:now};
  const dir=path.join(root,'.research-atlas','trails',trailId); fs.mkdirSync(path.join(dir,'runs'),{recursive:true});
  fs.writeFileSync(path.join(root,'.research-atlas','workspace.json'),JSON.stringify({schemaVersion:1,workspaceId,trails:[{trailId,relativePath:`trails/${trailId}`}]}));
  fs.writeFileSync(path.join(dir,'brief.md'),'question'); fs.writeFileSync(path.join(dir,'handoff.md'),'handoff'); fs.writeFileSync(path.join(root,'result.txt'),'result');
  const entries:string[]=[];
  for(let i=0;i<40;i++) { const runId=`run_${i}`, data=JSON.stringify({schemaVersion:1,runId,trailId,outcome:'completed',artifacts:i===0?[{path:'result.txt',hash:hash('result'),mime:'text/plain'}]:[]}); fs.writeFileSync(path.join(dir,'runs',`${runId}.json`),data); entries.push(JSON.stringify({schemaVersion:1,runId,path:`${runId}.json`,hash:hash(data)})); }
  const interruptedRun=path.join(dir,'runs','run_1.json'), restored=fs.readFileSync(interruptedRun);
  fs.unlinkSync(interruptedRun);
  entries.push('{bad json'); fs.writeFileSync(path.join(dir,'runs','index.jsonl'),entries.join('\n'));
  const reviews=new Map<string,PreparedResearch>(); let checkpoint:ResearchCheckpoint|null=null;
  const integration:ResearchIntegrationStore={checkpoint:()=>checkpoint,reviews:()=>[],review(id){const value=reviews.get(id);if(!value)throw Error('missing');return value;},prepare(value){reviews.set(value.id,value);return value;},apply(input){const value=this.review(input.reviewId); value.status=input.dismiss?'dismissed':'applied';checkpoint={trailId,workspaceId,fileHashes:value.fileHashes,runHashes:{...checkpoint?.runHashes,...value.runHashes},git:value.git,runCursor:value.runCursor,receipt:value.id,updatedAt:now};return {reviewId:value.id,status:value.status,evidenceIds:[]};},evidence:()=>[]};
  const store:ResearchStore & {integration:ResearchIntegrationStore}={integration,list:()=>({trails:[trail],workspaces:[workspace]}),detail:()=>({trail,nodes:[node],workspace}),save:()=>({})};
  const service=createResearchIntegrationService(store,path.join(temp,'data'));
  const review=service.prepare(trailId); assert.equal(review.sources.filter(s=>s.kind==='run').length,19); assert.equal(review.remaining,21); assert(review.warnings.some(w=>w.includes('reproducibility'))); assert(review.warnings.some(w=>w.includes('Run run_1 is unavailable'))); assert.equal(checkpoint,null);
  const run=review.sources.find(s=>s.run?.runId==='run_0')!; assert.equal(service.inspect({reviewId:review.id,sourceId:run.id,artifactIndex:0,approve:true}).content,'result');
  fs.unlinkSync(path.join(root,'result.txt')); fs.symlinkSync('/etc/passwd',path.join(root,'result.txt')); assert.throws(()=>service.inspect({reviewId:review.id,sourceId:run.id,artifactIndex:0,approve:true}),/symlink/);
  fs.writeFileSync(path.join(dir,'handoff.md'),'changed'); assert.throws(()=>service.apply({reviewId:review.id,digest:review.digest,decisions:[],dismiss:true}),/changed/);
  fs.writeFileSync(path.join(dir,'handoff.md'),'handoff'); service.apply({reviewId:review.id,digest:review.digest,decisions:[],dismiss:true});
  fs.writeFileSync(interruptedRun,restored);
  const next=service.prepare(trailId);
  assert.deepEqual(next.sources.flatMap(s=>s.run?[s.run.runId]:[]).sort(),['run_1',...Array.from({length:19},(_,i)=>`run_${i+20}`)]);
  assert.equal(next.remaining,2);
  service.apply({reviewId:next.id,digest:next.digest,decisions:[],dismiss:true});
  const last=service.prepare(trailId);
  assert.deepEqual(last.sources.flatMap(s=>s.run?[s.run.runId]:[]),['run_39']);
  assert.equal(last.remaining,0); assert(last.warnings.some(w=>w.includes('invalid')));
  const huge=JSON.stringify({schemaVersion:1,runId:'huge',trailId,outcome:'completed',objective:'x'.repeat(70000)}); fs.writeFileSync(path.join(dir,'runs','huge.json'),huge);
  const invalid=Array.from({length:21},()=>'{bad json'); invalid.push(JSON.stringify({schemaVersion:1,runId:'escape',path:'../secret.json',hash:hash('secret')}),JSON.stringify({schemaVersion:1,runId:'huge',path:'huge.json',hash:hash(huge)}));
  fs.writeFileSync(path.join(dir,'runs','index.jsonl'),invalid.join('\n')); const first=service.prepare(trailId); assert.equal(first.remaining,3); assert.equal(first.runCursor,20);
  service.apply({reviewId:first.id,digest:first.digest,decisions:[],dismiss:true}); const second=service.prepare(trailId); assert.equal(second.remaining,0); assert(second.warnings.some(w=>w.includes('huge'))); assert(second.warnings.some(w=>w.includes('invalid')));
  fs.writeFileSync(path.join(root,'.research-atlas','workspace.json'),JSON.stringify({schemaVersion:1,workspaceId:`rw_${randomUUID()}`,trails:[]})); assert.throws(()=>service.prepare(trailId),/does not match/);

 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('prepared snapshots persist and commit through the real Atlas store',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'research-integration-sql-'));
 try {
  const project=path.join(temp,'project'); fs.mkdirSync(project); const root=fs.realpathSync(project), data=path.join(temp,'data');
  const git=(...args:string[])=>{const result=spawnSync('/usr/bin/git',args,{cwd:root,encoding:'utf8'}); assert.equal(result.status,0,result.stderr);};
  git('init','-q'); git('config','user.email','test@example.invalid'); git('config','user.name','Test'); fs.writeFileSync(path.join(root,'tracked.txt'),'one\n'); git('add','tracked.txt'); git('commit','-qm','baseline');
  git('config','filter.evil.clean','touch FILTER_RAN'); fs.writeFileSync(path.join(root,'.gitattributes'),'tracked.txt filter=evil\n'); fs.writeFileSync(path.join(root,'tracked.txt'),'modified\n');
  const store=createAtlasStore(path.join(data,'atlas.sqlite')).research, trailId=`rt_${randomUUID()}`, nodeId=`rn_${randomUUID()}`, workspaceId=`rw_${randomUUID()}`;
  store.save({kind:'create',requestId:randomUUID(),id:trailId,rootNodeId:nodeId,title:'Trail',question:'Question?',anchorConceptIds:[],primaryConceptId:null,origin:{kind:'manual'}});
  store.save({kind:'workspace',requestId:randomUUID(),id:workspaceId,label:'Project',localRoot:root,expectedRevision:0,provision:'ready'});
  store.save({kind:'bind',requestId:randomUUID(),trailId,workspaceId,expectedRevision:1});
  const dir=path.join(root,'.research-atlas','trails',trailId); fs.mkdirSync(path.join(dir,'runs'),{recursive:true});
  fs.writeFileSync(path.join(root,'.research-atlas','workspace.json'),JSON.stringify({schemaVersion:1,workspaceId,trails:[{trailId,relativePath:`trails/${trailId}`}]}));
  fs.writeFileSync(path.join(dir,'brief.md'),'question'); fs.writeFileSync(path.join(dir,'handoff.md'),'handoff'); fs.writeFileSync(path.join(dir,'runs','index.jsonl'),'');
  const service=createResearchIntegrationService(store,data), review=service.prepare(trailId);
  assert.equal(store.integration.review(review.id).digest,review.digest); assert.equal(review.git?.dirty,true); assert.equal(fs.existsSync(path.join(root,'FILTER_RAN')),false);
  const input={reviewId:review.id,digest:review.digest,decisions:[],dismiss:true}; assert.equal(service.apply(input).status,'dismissed');
  fs.writeFileSync(path.join(dir,'brief.md'),'later edit'); assert.equal(service.apply(input).status,'dismissed');
  const next=service.prepare(trailId); assert.deepEqual(next.sources.map(s=>s.kind),['brief']);
  fs.writeFileSync(path.join(root,'tracked.txt'),'one\ntwo\n'); assert.throws(()=>service.apply({reviewId:next.id,digest:next.digest,decisions:[],dismiss:true}),/Git state changed/); assert.equal(fs.existsSync(path.join(root,'FILTER_RAN')),false);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
