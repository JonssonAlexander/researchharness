import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createAtlasStore } from '../src/store/atlas.ts';

const dropV17 = 'DROP TABLE research_import_reviews; DROP TABLE research_import_checkpoints; DROP TABLE research_evidence; PRAGMA user_version=16;';
test('v16 upgrade backs up and preserves research data; failed DDL rolls back',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-v17-'));
 try {
  const file=path.join(dir,'atlas.sqlite'),atlas=createAtlasStore(file),trailId=`rt_${randomUUID()}`;
  atlas.research.save({kind:'create',requestId:randomUUID(),id:trailId,rootNodeId:`rn_${randomUUID()}`,title:'Prior work',question:'Why?',anchorConceptIds:[],primaryConceptId:null,origin:{kind:'manual'}});
  const before=atlas.research.detail(trailId);let db=new DatabaseSync(file);db.exec(dropV17);db.close();
  assert.deepEqual(createAtlasStore(file).research.detail(trailId),before);
  const backup=fs.readdirSync(dir).find(name=>name.includes('.v16-')&&name.endsWith('.bak'));assert.ok(backup);
  db=new DatabaseSync(path.join(dir,backup));assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,16);assert.equal(db.prepare('SELECT count(*) AS n FROM research_trails').get()!.n,1);db.close();
  const broken=path.join(dir,'broken.sqlite');createAtlasStore(broken).read();db=new DatabaseSync(broken);db.exec(`${dropV17} CREATE TABLE research_import_checkpoints(unrecognized TEXT);`);db.close();
  assert.throws(()=>createAtlasStore(broken).read(),/already exists/);
  db=new DatabaseSync(broken);assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,16);assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='research_import_reviews'").get()!.n,0);db.close();
  db=new DatabaseSync(file);db.exec('PRAGMA user_version=18');db.close();assert.throws(()=>createAtlasStore(file).read(),/newer app/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
