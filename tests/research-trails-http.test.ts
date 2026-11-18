import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'research-http-'));
process.env.LH_DATA_DIR=path.join(root,'data');
const {researchTrailsResponse}=await import('../src/server/research-trails.ts');
const {stores}=await import('../src/server/stores.ts');
const {initialLesson}=await import('../src/core/learning-session.ts');
const id=(prefix:string)=>`${prefix}_${randomUUID()}`;
const url='http://localhost/api/research';
const post=(body:unknown,headers:Record<string,string>={})=>researchTrailsResponse(new Request(url,{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost',...headers},body:JSON.stringify(body)}));
const get=(query='')=>researchTrailsResponse(new Request(`${url}${query}`));
const create=(origin:unknown={kind:'manual'})=>({kind:'create',requestId:randomUUID(),id:id('rt'),rootNodeId:id('rn'),title:'Trail',question:'Why?',anchorConceptIds:[],primaryConceptId:null,origin});

test('research API validates origins, boundaries and workspace binding',async()=>{
 try {
  const chat=stores.chatStore.createChat('Research source');
  stores.chatStore.saveMessages(chat.id,[{id:'message-1',role:'user',content:[{type:'text',text:'Explore this'}],timestamp:Date.now()}]);
  stores.lessonStore.create(chat.id,initialLesson('Understand this'));
  const chatTrail=create({kind:'chat',chatId:chat.id,messageId:'message-1'});
  const lessonTrail=create({kind:'lesson',chatId:chat.id,lessonNodeId:'topic_0'});
  assert.equal((await post(chatTrail)).status,200);assert.equal((await post(lessonTrail)).status,200);
  assert.equal((await post({...create(),origin:undefined})).status,400);
  assert.equal((await post(create({kind:'chat'}))).status,400);
  assert.equal((await post(create({kind:'chat',chatId:'chat_missing',messageId:'x'}))).status,404);
  assert.equal((await post(create({kind:'chat',chatId:chat.id,messageId:'forged'}))).status,404);
  assert.equal((await post(create({kind:'lesson',chatId:chat.id,lessonNodeId:'forged'}))).status,404);
  for(const origin of [{kind:'manual',messageId:'message-1'},{kind:'atlas',chatId:chat.id},{kind:'chat',chatId:chat.id,lessonNodeId:'topic_0'}])assert.equal((await post(create(origin))).status,400);
  const noLesson=stores.chatStore.createChat('No lesson');
  assert.equal((await post(create({kind:'lesson',chatId:noLesson.id}))).status,404);
  const concept=id('ac');stores.atlasStore.save({kind:'concept',id:concept,expectedRevision:0,title:'Concept',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[]});
  assert.equal((await post({kind:'add-node',requestId:randomUUID(),id:id('rn'),trailId:chatTrail.id,parentNodeId:chatTrail.rootNodeId,nodeKind:'approach',title:'Approach',body:'',relatedConceptIds:[concept]})).status,200);
  const filtered=await (await get(`?conceptId=${concept}`)).json();assert.deepEqual(filtered.trails.map((t:{id:string})=>t.id),[chatTrail.id]);
  assert.equal((await post(create(),{origin:'https://elsewhere.example'})).status,403);
  assert.equal((await researchTrailsResponse(new Request(url,{method:'POST',headers:{'content-type':'text/plain'},body:'{}'}))).status,415);
  assert.equal((await researchTrailsResponse(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:'{' }))).status,400);
  assert.equal((await researchTrailsResponse(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payload:'x'.repeat(65536)})}))).status,413);
  assert.equal((await post({kind:'workspace',requestId:randomUUID(),id:id('rw'),label:'Unsafe',localRoot:root,expectedRevision:0,provision:'ready'})).status,400);
  assert.equal((await post({kind:'workspace-open',approve:true,requestId:randomUUID(),path:root})).status,400);
  const project=path.join(root,'project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'owner.txt'),'keep');
  const bind={kind:'workspace-bind',approve:true,requestId:randomUUID(),trailId:chatTrail.id,expectedRevision:1,path:project,label:'Project'};
  let response=await post(bind);assert.equal(response.status,200,await response.text());
  const handoff=path.join(project,'.research-atlas','trails',chatTrail.id,'handoff.md');fs.writeFileSync(handoff,'owner edits');
  response=await post(bind);assert.equal(response.status,200,await response.text());assert.equal(fs.readFileSync(handoff,'utf8'),'owner edits');
  const detail=await (await get(`?trailId=${chatTrail.id}`)).json();const workspace=detail.workspace;
  assert.equal(workspace.provision,'ready');assert.equal(workspace.localRoot,fs.realpathSync(project));
  assert.equal(fs.readFileSync(path.join(project,'owner.txt'),'utf8'),'keep');
  const second={kind:'bind',requestId:randomUUID(),trailId:lessonTrail.id,workspaceId:workspace.id,expectedRevision:1};
  response=await post(second);assert.equal(response.status,200,await response.text());
  response=await post(second);assert.equal(response.status,200,await response.text());
  const manifest=JSON.parse(fs.readFileSync(path.join(project,'.research-atlas','workspace.json'),'utf8'));
  assert.equal(manifest.workspaceId,workspace.id);assert.deepEqual(new Set(manifest.trails.map((t:{trailId:string})=>t.trailId)),new Set([chatTrail.id,lessonTrail.id]));
  assert.equal(fs.readFileSync(path.join(project,'.research-atlas','trails',chatTrail.id,'runs','index.jsonl'),'utf8'),'');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
