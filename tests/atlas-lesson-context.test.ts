import test from 'node:test';
import assert from 'node:assert/strict';
import {searchLessonAtlas,readLessonAtlas,type AtlasLessonReader} from '../src/core/atlas-lesson-context.ts';
import {atlasLessonTools} from '../src/agent/tools/atlas-lesson.ts';
import type {AtlasSnapshot} from '../src/core/atlas.ts';
const a='ac_00000000-0000-4000-8000-000000000001',b='ac_00000000-0000-4000-8000-000000000002';
function fixture(){
 const atlas:AtlasSnapshot={concepts:[{id:a,title:'Brownian motion',aliases:['Wiener process'],subjectIds:[],preferredSubjectId:null,propositionIds:['n_c'],revision:1,x:0,y:0,markdown:'Independent increments; use Itô calculus.'},{id:b,title:'Quadratic variation',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[],revision:1,x:0,y:0}],subjects:[],relations:[],learningEvidence:[{conceptId:a,chatId:'chat_source',at:'2026-10-31T12:00:00Z',outcome:'with-help',evidence:'Used a hint for the limiting step.',assistance:'Teacher supplied the bound.'}]};
 const nodes=['a','b','c'].map(id=>({id:`n_${id}`,name:id,statement:`Precise ${id} under stated conditions.`,aliases:[],provenance:[{chatId:'source',messageId:'msg'}],createdAt:'2026-10-31'}));
 const chains=[{id:'arg_joint',premises:['n_a','n_b'],conclusion:'n_c',provenance:[],createdAt:'2026-10-31'}];
 const reader:AtlasLessonReader={read:()=>({atlas,propositions:nodes,chains}),lesson:()=>null};return {atlas,nodes,chains,reader};
}
test('Atlas lookup searches aliases and notes with stable IDs, exposes assistance and does not mutate knowledge',()=>{
 const f=fixture(),before=JSON.stringify(f);
 assert.equal(searchLessonAtlas(f.reader,'Wiener').results[0]!.id,a);assert.equal(searchLessonAtlas(f.reader,'Itô').results[0]!.id,a);
 const read=readLessonAtlas(f.reader,'concept',a);assert(read.kind==='concept');assert.equal(read.concept.notes,f.atlas.concepts[0]!.markdown);assert.equal(read.observations.items[0]!.outcome,'with-help');assert.equal(read.observations.items[0]!.chatId,'chat_source');assert.match(read.notice,/does not imply independent/);
 const proof=readLessonAtlas(f.reader,'claim','n_c');assert(proof.kind==='claim');assert.deepEqual(proof.arguments.items[0]!.premises,['n_a','n_b']);assert.equal(proof.premises.items.length,2);assert.equal(JSON.stringify(f),before);
 assert.throws(()=>readLessonAtlas(f.reader,'concept','removed'),/no longer exists/);assert.throws(()=>readLessonAtlas(f.reader,'lesson','uncommitted'),/not integrated/);
});
test('search pages and record budgets disclose omissions without cutting joint arguments or statements',()=>{
 const f=fixture();f.nodes.push(...Array.from({length:25},(_,i)=>({id:`n_more_${i}`,name:`Search target ${i}`,statement:'Full assumptions.',aliases:[],provenance:[],createdAt:'2026-10-31'})));
 const first=searchLessonAtlas(f.reader,'Search target'),second=searchLessonAtlas(f.reader,'Search target',first.nextOffset!);assert.equal(first.results.length,12);assert.equal(second.results.length,12);assert(!first.results.some(a=>second.results.some(b=>a.id===b.id)));
 f.nodes[0]!.statement='x'.repeat(17000);const proof=readLessonAtlas(f.reader,'claim','n_c');assert(proof.kind==='claim');assert.deepEqual(proof.arguments.items[0]!.premises,['n_a','n_b']);assert.equal(proof.premises.omitted,1);assert(!proof.premises.items.some(n=>n.id==='n_a'));
 f.nodes[2]!.statement='x'.repeat(49000);assert.throws(()=>readLessonAtlas(f.reader,'claim','n_c'),/lookup budget/);
});
test('native Atlas tools use the fresh injected reader and expose only read operations',async()=>{
 const f=fixture(),tools=atlasLessonTools(f.reader);assert.deepEqual(Object.keys(tools),['search_atlas','read_atlas']);
 const before=JSON.stringify(f.atlas),result=await tools.search_atlas!.execute('search',{query:'Wiener'},undefined);assert(JSON.stringify(result).includes(a));
 f.atlas.concepts[0]!.markdown='A revised explanation.';const read=await tools.read_atlas!.execute('read',{kind:'concept',id:a},undefined);assert(JSON.stringify(read).includes('A revised explanation.'));
 assert.notEqual(JSON.stringify(f.atlas),before);assert.equal(f.atlas.concepts[0]!.revision,1);
});
