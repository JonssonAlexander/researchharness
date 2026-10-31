import assert from "node:assert/strict";
import test from "node:test";
import { createAtlasDemo } from "../src/core/atlas-demo.ts";
import { arrangeAtlas, createAtlasLayout } from "../src/core/atlas-layout.ts";
import { projectAtlas, type AtlasSnapshot } from "../src/core/atlas.ts";

function fixture(): AtlasSnapshot {
 const demo=createAtlasDemo("123456789abc");
 const snapshot: AtlasSnapshot={subjects:[],concepts:[],relations:[]};
 for(const c of demo) {
  if(c.kind==='subject') snapshot.subjects.push({...c,revision:1,x:0,y:0});
  if(c.kind==='concept') snapshot.concepts.push({...c,revision:1,x:0,y:0});
  if(c.kind==='subject-position') Object.assign(snapshot.subjects.find(n=>n.id===c.id)!,{x:c.x,y:c.y});
  if(c.kind==='concept-position') Object.assign(snapshot.concepts.find(n=>n.id===c.id)!,{x:c.x,y:c.y});
  if(c.kind==='relation') snapshot.relations.push({...c,revision:1,createdAt:'',updatedAt:'',contentHash:''});
 }
 return snapshot;
}
function settle(layout: ReturnType<typeof createAtlasLayout>) {
 let ticks=0; while(layout.step() && ++ticks<250) {}
 assert(ticks<250,"layout must stop, not run forever");
 return layout.positions();
}
test("local settling uses accepted links, is deterministic, leaves input and other subjects unchanged",()=>{
 const snapshot=fixture(), before=structuredClone(snapshot), subject=snapshot.subjects[0]!.id;
 const a=createAtlasLayout(snapshot,subject), b=createAtlasLayout(snapshot,subject);
 const first=settle(a); assert.deepEqual(first,settle(b)); assert.deepEqual(snapshot,before);
 assert(first.some(p=>p.x!==snapshot.concepts.find(c=>c.id===p.id)!.x));
 assert(first.every(p=>snapshot.concepts.find(c=>c.id===p.id)!.preferredSubjectId===subject));
 for(const n of a.nodes.filter(n=>!a.active.has(n.id))) {
  const old=snapshot.concepts.find(c=>c.id===n.id)!;
  assert.equal(n.x,old.x); assert.equal(n.y,old.y);
 }
 const unlinked=structuredClone(snapshot); unlinked.relations.forEach(r=>r.reviewStatus='retracted');
 assert.notDeepEqual(first,settle(createAtlasLayout(unlinked,subject)));
});
test("drag releases into local settling; nearby nodes respond and distant regions stay fixed",()=>{
 const snapshot=fixture(), subject=snapshot.subjects[0]!.id;
 const layout=createAtlasLayout(snapshot,subject), node=snapshot.concepts[1]!;
 layout.move(node.id,node.x+70,node.y+50);
 for(let i=0;i<30;i++) layout.step();
 const held=layout.nodes.find(n=>n.id===node.id)!;
 assert.equal(held.x,node.x+70); assert.equal(held.y,node.y+50);
 layout.release(); const positions=settle(layout);
 assert(positions.some(p=>p.id!==node.id && Math.hypot(p.x-snapshot.concepts.find(c=>c.id===p.id)!.x,p.y-snapshot.concepts.find(c=>c.id===p.id)!.y)>1));
 assert(positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 assert.equal(held.fx,null);
});
test("locked subjects reject layout; oversized regions fail before moving anything",()=>{
 const snapshot=fixture(); snapshot.subjects[0]!.locked=true;
 assert.throws(()=>createAtlasLayout(snapshot,snapshot.subjects[0]!.id),/Unlock/);
 assert(projectAtlas(snapshot).nodes.some(n=>n.fixed&&!n.draggable));
 snapshot.subjects[0]!.locked=false;
 snapshot.concepts=Array.from({length:151},(_,i)=>({...snapshot.concepts[0]!,id:`concept-${i}`}));
 assert.throws(()=>createAtlasLayout(snapshot,snapshot.subjects[0]!.id),/150/);
});

test("moving into another subject before settling keeps both touched regions in one bounded layout",()=>{
 const snapshot=fixture();
 const first=snapshot.subjects[0]!.id, second=snapshot.subjects[1]!.id;
 const partial=createAtlasLayout(snapshot,first);
 partial.move(snapshot.concepts[1]!.id,-200,-50); partial.step(); partial.release();
 const intermediate=structuredClone(snapshot);
 for(const p of partial.positions()) Object.assign(intermediate.concepts.find(c=>c.id===p.id)!,p);
 const combined=createAtlasLayout(intermediate,second,[...partial.subjectIds]);
 assert.deepEqual(combined.subjectIds,new Set([second,first]));
 const positions=settle(combined);
 assert.equal(positions.length,7);
 assert(!positions.some(p=>snapshot.concepts.find(c=>c.id===p.id)!.preferredSubjectId===snapshot.subjects[2]!.id));
});


test("organic overview keeps subject regions separate despite cross-subject bridges",()=>{
 const snapshot=fixture(),before=structuredClone(snapshot),ids=snapshot.concepts.map(c=>c.id);
 const positions=arrangeAtlas(snapshot,ids,"organic");
 assert.deepEqual(positions,arrangeAtlas(snapshot,ids,"organic"));
 assert.deepEqual(snapshot,before);
 const ranges=snapshot.subjects.map(subject=>{
  const points=positions.filter(p=>snapshot.concepts.find(c=>c.id===p.id)!.preferredSubjectId===subject.id);
  return {min:Math.min(...points.map(p=>p.x)),max:Math.max(...points.map(p=>p.x))};
 }).sort((a,b)=>a.min-b.min);
 for(let i=1;i<ranges.length;i++)assert(ranges[i]!.min-ranges[i-1]!.max>=179);
 const moved=structuredClone(snapshot),subject=snapshot.subjects[0]!.id;
 for(const c of moved.concepts)if(c.preferredSubjectId!==subject){c.x+=10000;c.y-=10000;}
 // A distant foundation must not drag a local topic into a long thin shape.
 const a=settle(createAtlasLayout(snapshot,subject)),b=settle(createAtlasLayout(moved,subject));
 const span=(points:typeof a)=>Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
 assert(Math.abs(span(a)-span(b))<30);
});
