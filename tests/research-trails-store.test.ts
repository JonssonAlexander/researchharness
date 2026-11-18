import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createAtlasStore } from '../src/store/atlas.ts';

const id=(prefix:string)=>`${prefix}_${randomUUID()}`;
test('trails retain branches, historical links, revisions and safe retries',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trails-')); const file=path.join(dir,'atlas.sqlite');
 try {
  const atlas=createAtlasStore(file), store=atlas.research, concept=id('ac'), subject=id('as');
  atlas.save({kind:'subject',id:subject,expectedRevision:0,title:'Area',color:'#abcdef',parentId:null});
  atlas.save({kind:'concept',id:concept,expectedRevision:0,title:'Concept',aliases:[],subjectIds:[subject],preferredSubjectId:subject,propositionIds:[]});
  const trail=id('rt'),root=id('rn'),child=id('rn');
  const create={kind:'create' as const,requestId:randomUUID(),id:trail,rootNodeId:root,title:'Investigation',question:'Why?',anchorConceptIds:[concept],primaryConceptId:concept,origin:{kind:'atlas' as const}};
  assert.deepEqual(store.save(create),{trailId:trail});assert.deepEqual(store.save(create),{trailId:trail});
  assert.throws(()=>store.save({...create,title:'Changed'}),/Request ID/);
  const add={kind:'add-node' as const,requestId:randomUUID(),id:child,trailId:trail,parentNodeId:root,nodeKind:'approach' as const,title:'Try this',body:'',relatedConceptIds:[concept]};store.save(add);
  assert.throws(()=>store.save({kind:'edit-node',id:root,expectedRevision:1,parentNodeId:child,nodeKind:'question',title:'Why?',body:'',relatedConceptIds:[]}),/root/);
  assert.deepEqual(store.list().trails[0]?.linkedConceptIds,[concept]);
  assert.throws(()=>store.save({kind:'edit-node',id:root,expectedRevision:1,parentNodeId:null,nodeKind:'note',title:'Why?',body:'',relatedConceptIds:[]}),/root must remain/);
  const other=id('rt'),otherRoot=id('rn');store.save({...create,requestId:randomUUID(),id:other,rootNodeId:otherRoot});
  assert.throws(()=>store.save({...add,requestId:randomUUID(),id:id('rn'),parentNodeId:otherRoot}),/same trail/);
  let parent=child;
  for(let depth=3;depth<=32;depth++){const next=id('rn');store.save({...add,requestId:randomUUID(),id:next,parentNodeId:parent});parent=next;}
  assert.throws(()=>store.save({...add,requestId:randomUUID(),id:id('rn'),parentNodeId:parent}),/depth/);

  assert.throws(()=>store.save({kind:'edit-node',id:child,expectedRevision:1,parentNodeId:child,nodeKind:'approach',title:'Try this',body:'',relatedConceptIds:[]}),/cycles/);
  store.save({kind:'edit-trail',id:trail,expectedRevision:1,title:'Investigation',status:'paused',anchorConceptIds:[concept],primaryConceptId:concept,archived:true});
  assert.throws(()=>store.save({kind:'edit-trail',id:trail,expectedRevision:1,title:'stale',status:'active',anchorConceptIds:[],primaryConceptId:null,archived:false}),/changed/);
  const workspace=id('rw'), workspaceRequest=randomUUID();
  store.save({kind:'workspace',requestId:workspaceRequest,id:workspace,label:'Project',localRoot:'/tmp/project',expectedRevision:0,provision:'pending'});
  const bind={kind:'bind' as const,requestId:randomUUID(),trailId:trail,workspaceId:workspace,expectedRevision:2};
  assert.deepEqual(store.save(bind),{trailId:trail,workspaceId:workspace});assert.deepEqual(store.save(bind),{trailId:trail,workspaceId:workspace});
  assert.equal(store.detail(trail).workspace?.id,workspace);
  const reopened=createAtlasStore(file).research.detail(trail);assert.equal(reopened.nodes.length,32);assert.ok(reopened.trail.archivedAt);
  const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=OFF; DELETE FROM concept_subjects; DELETE FROM concepts;');db.close();
  assert.deepEqual(store.detail(trail).trail.missingConceptIds,[concept]);assert.deepEqual(store.detail(trail).nodes.find(n=>n.id===child)?.missingConceptIds,[concept]);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('v15 migration backs up and future schema is refused',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trails-migrate-'));const file=path.join(dir,'atlas.sqlite');
 try {const atlas=createAtlasStore(file);const subject=id('as');atlas.save({kind:'subject',id:subject,expectedRevision:0,title:'Preserved',color:'#abcdef',parentId:null});const before=JSON.stringify(atlas.read().subjects);const db=new DatabaseSync(file);db.exec('DROP TABLE research_import_reviews; DROP TABLE research_import_checkpoints; DROP TABLE research_evidence; DROP TABLE research_mutation_receipts; DROP TABLE research_nodes; DROP TABLE research_trails; DROP TABLE research_workspaces; PRAGMA user_version=15;');db.close();atlas.research.list();assert.equal(JSON.stringify(atlas.read().subjects),before);assert.ok(fs.readdirSync(dir).some(f=>f.includes('.v15-')&&f.endsWith('.bak')));const future=new DatabaseSync(file);future.exec('PRAGMA user_version=18');future.close();assert.throws(()=>atlas.research.list(),/newer app/);} finally {fs.rmSync(dir,{recursive:true,force:true});}
});
