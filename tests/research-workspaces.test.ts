import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createResearchWorkspaceService} from '../src/server/research-workspaces.ts';
import type {ResearchStore, ResearchWorkspace, ResearchTrail, ResearchNode} from '../src/core/research-trails.ts';

test('workspace provisioning preserves edits, supports retries and verifies identity', async () => {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'research-workspaces-'));
 try {
  const project=path.join(temp,'project'); fs.mkdirSync(project); fs.writeFileSync(path.join(project,'source.py'),'owner');
  const trailId=`rt_${randomUUID()}`, nodeId=`rn_${randomUUID()}`;
  const trail:ResearchTrail={id:trailId,title:'Trail',rootNodeId:nodeId,status:'active',workspaceId:null,primaryConceptId:null,anchorConceptIds:[],origin:{kind:'manual'},revision:1,createdAt:'',updatedAt:'',archivedAt:null,missingConceptIds:[],linkedConceptIds:[]};
  const node:ResearchNode={id:nodeId,trailId,parentNodeId:null,kind:'question',title:'Question?',body:'Context',relatedConceptIds:[],revision:1,createdAt:'',updatedAt:'',missingConceptIds:[]};
  const workspaces:ResearchWorkspace[]=[];
  const store:ResearchStore={integration:{} as ResearchStore['integration'],list:()=>({trails:[trail],workspaces}),detail:()=>({trail,nodes:[node],workspace:workspaces[0] ?? null}),save(command) {
   if(command.kind==='workspace') { const old=workspaces.find(w=>w.id===command.id); if(old) { assert.equal(old.revision,command.expectedRevision); Object.assign(old,command,{revision:old.revision+1}); } else workspaces.push({id:command.id,label:command.label,localRoot:command.localRoot,revision:1,provision:command.provision,createdAt:'',updatedAt:''}); }
   return {};
  }};
  let fail=true, opened='';
  const service=createResearchWorkspaceService(store,path.join(temp,'data'),{openEditor:async root=>{opened=root;},onStep:step=>{if(step==='brief' && fail){fail=false;throw Error('crash');}}});
  const w=service.bindExisting({path:project,label:'Project',requestId:randomUUID()}); trail.workspaceId=w.id;
  assert.throws(()=>service.provision({workspaceId:w.id,trailId,requestId:randomUUID()}),/crash/);
  assert.equal(w.provision,'repair-needed');
  const brief=path.join(project,'.research-atlas','trails',trailId,'brief.md'); fs.writeFileSync(brief,'owner edits');
  service.provision({workspaceId:w.id,trailId,requestId:randomUUID()});
  assert.equal(w.provision,'ready'); assert.equal(fs.readFileSync(brief,'utf8'),'owner edits'); assert.equal(fs.readFileSync(path.join(project,'source.py'),'utf8'),'owner');
  const handoff=path.join(project,'.research-atlas','trails',trailId,'handoff.md'), index=path.join(project,'.research-atlas','trails',trailId,'runs','index.jsonl');
  fs.writeFileSync(handoff,'edited handoff'); fs.writeFileSync(index,'owner bytes\n');
  const manifest=fs.readFileSync(path.join(project,'.research-atlas','workspace.json'));
  service.provision({workspaceId:w.id,trailId,requestId:randomUUID()});
  assert.equal(fs.readFileSync(brief,'utf8'),'owner edits'); assert.equal(fs.readFileSync(handoff,'utf8'),'edited handoff'); assert.equal(fs.readFileSync(index,'utf8'),'owner bytes\n'); assert.deepEqual(fs.readFileSync(path.join(project,'.research-atlas','workspace.json')),manifest);
  fs.mkdirSync(path.join(project,'existing')); fs.writeFileSync(path.join(project,'existing','owner.txt'),'keep');
  assert.throws(()=>service.create({basePath:project,name:'existing',requestId:randomUUID()}),/already exists/); assert.equal(fs.readFileSync(path.join(project,'existing','owner.txt'),'utf8'),'keep');
  assert.throws(()=>service.bindExisting({path:'/',label:'root',requestId:randomUUID()}),/outside app data/);
  assert.throws(()=>service.bindExisting({path:os.homedir(),label:'home',requestId:randomUUID()}),/outside app data/);
  await service.open(w.id); assert.equal(opened,fs.realpathSync(project));
  const other=path.join(temp,'other'); fs.mkdirSync(other); fs.mkdirSync(path.join(other,'.research-atlas')); fs.writeFileSync(path.join(other,'.research-atlas','workspace.json'),JSON.stringify({schemaVersion:1,workspaceId:`rw_${randomUUID()}`,trails:[]}));
  assert.throws(()=>service.bindExisting({path:other,label:'foreign',requestId:randomUUID()}),/different/);
  assert.throws(()=>service.rebind({workspaceId:w.id,path:other,expectedRevision:w.revision,requestId:randomUUID()}),/different/);
  const moved=path.join(temp,'moved'); fs.renameSync(project,moved); service.rebind({workspaceId:w.id,path:moved,expectedRevision:w.revision,requestId:randomUUID()});
  service.provision({workspaceId:w.id,trailId,requestId:randomUUID()}); await service.open(w.id); assert.equal(opened,fs.realpathSync(moved));
  assert.throws(()=>service.bindExisting({path:temp,label:'data ancestor',requestId:randomUUID()}),/outside app data/);
  const evil=path.join(temp,'evil'); fs.mkdirSync(evil); fs.symlinkSync(other,path.join(evil,'.research-atlas')); assert.throws(()=>service.bindExisting({path:evil,label:'evil',requestId:randomUUID()}),/symlink/);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
