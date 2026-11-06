/** Atlas heads use strict replacement; immutable assets and SQL remain separate protocols. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import test,{after,type TestContext} from 'node:test';
import {createLearningSessionStore} from '../src/store/learning-session.ts';
import {initialLesson} from '../src/core/learning-session.ts';
import {createLessonDocumentStore} from '../src/store/lesson-documents.ts';
import {createScratchpadStore} from '../src/store/scratchpad.ts';
import {createProblemStore} from '../src/store/problems.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-atomic-'));
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const directory=()=>fs.mkdtempSync(path.join(root,'case-'));
const scene={type:'excalidraw' as const,version:2 as const,elements:[],appState:{},files:{}};
const target={id:'topic',title:'A result',start:'Assume A.',finish:'Show B.'};
function refuseRename(t:TestContext,file:string,save:()=>unknown,windows=false){
 const before=fs.existsSync(file)?fs.readFileSync(file):null;
 if(windows){const descriptor=Object.getOwnPropertyDescriptor(process,'platform')!;Object.defineProperty(process,'platform',{value:'win32'});t.after(()=>Object.defineProperty(process,'platform',descriptor));}
 const code=windows?'EACCES':'EIO',rename=fs.renameSync;
 t.mock.method(fs,'renameSync',(...args:Parameters<typeof fs.renameSync>)=>{if(String(args[1])===file)throw Object.assign(Error('injected rename'),{code});return rename(...args);});
 assert.throws(save,{code});t.mock.restoreAll();
 assert.deepEqual(fs.existsSync(file)?fs.readFileSync(file):null,before);
 assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(n=>n.includes('.tmp-')),[]);
}
for(const windows of [false,true]){
 test(`lesson head survives failed replacement (${windows?'modeled Windows':'I/O failure'}) and retries`,t=>{
  const dir=directory(),store=createLearningSessionStore(dir),old=store.create('lesson',initialLesson('A result'));
  const change={expectedRevision:old.revision,status:'active' as const,plan:{...old.plan,objective:'Revised result'}};
  refuseRename(t,path.join(dir,'lesson/current.json'),()=>store.save('lesson',change),windows);
  assert.deepEqual(createLearningSessionStore(dir).read('lesson'),old);
  assert.equal(store.save('lesson',change).revision,2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'lesson/revision-1.json'),'utf8')),old);
 });
 test(`scratchpad keeps draft and previous recovery copy (${windows?'modeled Windows':'I/O failure'})`,t=>{
  const dir=directory(),store=createScratchpadStore(dir),old=store.save('chat','pad',0,{scene,text:'old',target});
  refuseRename(t,path.join(dir,'chat/pad/current.json'),()=>store.save('chat','pad',1,{scene,text:'new',target}),windows);
  assert.deepEqual(createScratchpadStore(dir).read('chat','pad'),old);
  assert.equal(store.save('chat','pad',1,{scene,text:'retry',target}).revision,2);
  if(!windows)assert.equal(fs.statSync(path.join(dir,'chat/pad/current.json')).mode&0o777,0o600);
 });
 test(`problem attempts do not advance when saving fails (${windows?'modeled Windows':'I/O failure'})`,t=>{
  const dir=directory(),store=createProblemStore(dir),{problem,attempt}=store.create({title:'A result',statement:'Show A implies A.',modelSolution:'Use the hypothesis.',source:{kind:'generated',citation:'Synthetic test'},checking:'Checked the statement and direct solution.',conceptIds:[],techniqueIds:[]},'chat','call',45);
  refuseRename(t,path.join(dir,`${problem.id}.json`),()=>store.append(problem.id,attempt.id,{at:'',status:'setAside'}),windows);
  assert.deepEqual(createProblemStore(dir).read(problem.id),problem);
  assert.equal(store.append(problem.id,attempt.id,{at:'',status:'setAside'}).attempts[0]!.events.length,1);
 });
}
test('document manifest publishes last and retry reuses the untouched original',t=>{
 const dir=directory(),store=createLessonDocumentStore(dir),bytes=Buffer.from('A mathematical source.'),rename=fs.renameSync;
 t.mock.method(fs,'renameSync',(...args:Parameters<typeof fs.renameSync>)=>{if(String(args[1]).endsWith('.json'))throw Object.assign(Error('manifest failure'),{code:'EIO'});return rename(...args);});
 assert.throws(()=>store.put('chat','paper.md',bytes,'text',null),{code:'EIO'});t.mock.restoreAll();
 assert.deepEqual(store.list('chat'),[]);const files=fs.readdirSync(path.join(dir,'chat'));assert.equal(files.length,1);assert(files[0]!.endsWith('.original'));
 const document=store.put('chat','paper.md',bytes,'text',null);assert.deepEqual(createLessonDocumentStore(dir).asset('chat',document.id).bytes,bytes);
 if(process.platform!=='win32')assert.equal(fs.statSync(path.join(dir,'chat',`${document.id}.json`)).mode&0o777,0o600);
});
test('failed scratchwork manifest never publishes an incomplete attempt and retry is idempotent',t=>{
 const dir=directory(),store=createScratchpadStore(dir),draft=store.save('chat','pad',0,{scene,text:'My proof',target}),id=`sa_${randomUUID()}`;
 refuseRename(t,path.join(dir,'chat/attempts',`${id}.json`),()=>store.capture('chat','pad',id,1,null));
 assert.deepEqual(store.list('chat','pad'),[]);assert.deepEqual(store.read('chat','pad'),draft);
 const a=store.capture('chat','pad',id,1,null);assert.deepEqual(store.capture('chat','pad',id,1,null),a);
 const entry=store.retain('chat','pad',draft,id);assert.deepEqual(createScratchpadStore(dir).retained(entry.id)?.draft,draft);
});
