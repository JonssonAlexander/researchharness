import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chat-summary-cache-'));
process.env.LH_DATA_DIR=dir;
const {chatStore}=await import('../src/store/chats.ts');
const {CURRENT_CHAT_VERSION}=await import('../src/core/contracts.ts');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));

test('summaries reuse unchanged files and refresh on writes and external replacements',()=>{
 const a=chatStore.createChat('First'), b=chatStore.createChat('Second','practice');
 const file=path.join(dir,'chats',`${a.id}.json`);
 const cold=chatStore.listChats();
 const parse=JSON.parse; let parses=0;
 JSON.parse=((...args:Parameters<typeof JSON.parse>)=>{parses++;return parse(...args);}) as typeof JSON.parse;
 try { assert.deepEqual(chatStore.listChats(),cold); assert.equal(parses,0); } finally { JSON.parse=parse; }
 chatStore.renameChat(a.id,'Renamed');
 chatStore.saveMessages(a.id,[{id:'m',role:'user',content:'Hello',timestamp:1}]);
 let row=chatStore.listChats().find(c=>c.id===a.id)!;
 assert.equal(row.title,'Renamed'); assert.equal(row.messageCount,1);
 const record=chatStore.getChat(a.id)!;
 const replacement=path.join(dir,'replacement');
 fs.writeFileSync(replacement,JSON.stringify({...record,title:'External'})); fs.renameSync(replacement,file);
 assert.equal(chatStore.listChats().find(c=>c.id===a.id)?.title,'External');
 fs.writeFileSync(file,'{broken');
 assert.equal(chatStore.listChats().some(c=>c.id===a.id),false);
 assert.equal(chatStore.listChats().some(c=>c.id===b.id),true);
 fs.writeFileSync(file,JSON.stringify({...record,version:CURRENT_CHAT_VERSION+1}));
 assert.equal(chatStore.listChats().some(c=>c.id===a.id),false);
 fs.writeFileSync(file,JSON.stringify(record));
 assert.equal(chatStore.listChats().find(c=>c.id===a.id)?.title,'Renamed');
 assert.equal(chatStore.deleteChat(a.id),true);
 assert.equal(chatStore.listChats().some(c=>c.id===a.id),false);
});
