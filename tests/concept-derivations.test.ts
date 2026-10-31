import test from "node:test";
import assert from "node:assert/strict";
import {conceptDerivation,derivationDiagram,layoutDerivation,sharedDerivationMap,layoutSharedDerivations,resolveDerivationTarget} from "../src/core/concept-derivations.ts";
import type {GraphNode,GraphChain} from "../src/core/contracts/graph.ts";
import type {AtlasConcept} from "../src/core/atlas.ts";
const node=(id:string):GraphNode=>({id,name:id,statement:`Precise ${id}`,aliases:[],provenance:[],createdAt:"2026-10-30T00:00:00Z"});
const chain=(id:string,premises:string[],conclusion:string):GraphChain=>({id,premises,conclusion,provenance:[],createdAt:"2026-10-30T00:00:00Z"});
const nodes=['n_a','n_b','n_c','n_d','n_other'].map(node),chains=[chain('arg_joint',['n_a','n_b'],'n_c'),chain('arg_prior',['n_d'],'n_a'),chain('arg_alternative',['n_d'],'n_c'),chain('arg_unrelated',['n_other'],'n_other')];
const concept:AtlasConcept={id:'ac_00000000-0000-4000-8000-000000000001',title:'Concept',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:['n_c'],revision:1,x:0,y:0};

test('derivation follows canonical arguments backwards, keeps alternatives and jointly required premises',()=>{
 const before=JSON.stringify({nodes,chains}),scope=conceptDerivation(nodes,chains,['n_c']);
 assert.deepEqual(scope.propositions.map(n=>n.id),['n_a','n_b','n_c','n_d']);assert.equal(scope.chains.length,3);assert.equal(scope.truncated,false);
 const diagram=derivationDiagram(scope);assert(diagram.nodes.some(n=>n.id==='arg_joint'));assert(diagram.edges.some(e=>e.from==='n_a'&&e.to==='arg_joint'));assert(diagram.edges.some(e=>e.from==='n_b'&&e.to==='arg_joint'));assert(diagram.edges.some(e=>e.from==='arg_joint'&&e.to==='n_c'));assert(!diagram.edges.some(e=>e.from==='n_b'&&e.to==='n_c'));
 assert.equal(JSON.stringify({nodes,chains}),before);
});

test('missing claims, incomplete argument references and cycles remain bounded and are not completed by guessing',()=>{
 const scope=conceptDerivation(nodes,[...chains,chain('arg_cycle',['n_c'],'n_d'),chain('arg_broken',['n_absent'],'n_c')],['n_c','n_missing']);
 assert.deepEqual(scope.missing,['n_missing']);assert(!scope.chains.some(c=>c.id==='arg_broken'));assert.equal(scope.chains.length,4);
 const large=Array.from({length:151},(_,i)=>node(`n_${i}`)),wide=chain('arg_wide',large.slice(1).map(n=>n.id),'n_0'),bounded=conceptDerivation(large,[wide],['n_0']);
 assert.equal(bounded.truncated,true);assert.equal(bounded.chains.length,0);assert.equal(bounded.propositions.length,1);
});

test('learning resolves exactly the selected argument, refuses unrelated/stale targets and retains every co-premise',()=>{
 const picked=resolveDerivationTarget([concept],nodes,chains,{rootId:'n_c',targetId:'n_c',chainId:'arg_joint'});
 assert.deepEqual(picked.propositions.map(n=>n.id),['n_a','n_b','n_c']);assert.deepEqual(picked.chains.map(c=>c.id),['arg_joint']);
 assert.throws(()=>resolveDerivationTarget([concept],nodes,chains,{rootId:'n_other',targetId:'n_other'}),/linked/);
 assert.throws(()=>resolveDerivationTarget([concept],nodes,chains,{rootId:'n_c',targetId:'n_other'}),/changed/);
 assert.throws(()=>resolveDerivationTarget([concept],nodes,chains,{rootId:'n_c',targetId:'n_c',chainId:'arg_missing'}),/no longer/);
 assert.deepEqual(resolveDerivationTarget([concept],nodes,chains,{rootId:'n_c',targetId:'n_b'}).chains,[]);
});

 test('derivation layout reserves label rectangles, follows inference direction and handles cycles deterministically',()=>{
 const scope=conceptDerivation(nodes,chains,['n_c']),diagram=derivationDiagram(scope),before=JSON.stringify(diagram),positions=layoutDerivation(diagram);
 for(const edge of diagram.edges)assert(positions.get(edge.to)!.y>positions.get(edge.from)!.y);
 const points=[...positions.values()];for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)assert(Math.abs(points[i]!.x-points[j]!.x)>=170||Math.abs(points[i]!.y-points[j]!.y)>=100);
 assert.equal(JSON.stringify(diagram),before);assert.deepEqual(layoutDerivation(diagram),positions);
 const cyclic=derivationDiagram(conceptDerivation(nodes,[...chains,chain('arg_cycle',['n_c'],'n_d')],['n_c'])),fallback=layoutDerivation(cyclic);assert.equal(fallback.size,cyclic.nodes.length);assert([...fallback.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 });


test('shared derivations join exact prerequisites once across results and keep unrelated families separate',()=>{
 const all=[...nodes,node('n_second'),{...node('n_similar'),name:'n_a'}];
 const arguments_=[...chains,chain('arg_second',['n_a','n_b'],'n_second')],before=JSON.stringify({all,arguments_});
 const scope=sharedDerivationMap(all,arguments_,['n_c']);
 assert.equal(scope.propositions.filter(n=>n.id==='n_a').length,1);
 assert(scope.propositions.some(n=>n.id==='n_second'));
 assert(scope.propositions.some(n=>n.id==='n_similar'),'similar names are never merged');
 assert(scope.chains.some(c=>c.id==='arg_second'));
 const diagram=derivationDiagram(scope),layout=layoutSharedDerivations(diagram);
 assert(layout.clusters.some(c=>c.members.includes('n_c')));
 assert(layout.clusters.some(c=>c.members.includes('n_second')));
 const members=layout.clusters.flatMap(c=>c.members);assert.equal(members.filter(id=>id==='n_a').length,1);
 assert(!members.includes('n_similar'),'unconnected claims stay on the outer rim');
 assert.equal(layout.positions.size,diagram.nodes.length);
 assert.deepEqual(layout,layoutSharedDerivations(diagram));
 assert([...layout.positions.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 assert.equal(JSON.stringify({all,arguments_}),before);
});

test('shared map limits retain complete arguments, prioritize the entry proof and omit broken references',()=>{
 const all=Array.from({length:170},(_,i)=>node(`n_${i}`));
 const arguments_=all.slice(1).map((_,i)=>chain(`arg_${i}`,['n_0'],`n_${i+1}`));
 arguments_.push(chain('arg_missing',['absent'],'n_169'));
 const scope=sharedDerivationMap(all,arguments_,['n_169','unknown']);
 assert(scope.propositions.some(n=>n.id==='n_169'));assert(scope.chains.some(c=>c.conclusion==='n_169'));
 assert(scope.truncated);assert(scope.propositions.length<=150);assert(scope.chains.length<=80);
 assert.deepEqual(scope.missing,['unknown']);assert(!scope.chains.some(c=>c.id==='arg_missing'));
 const ids=new Set(scope.propositions.map(n=>n.id));for(const c of scope.chains)assert([c.conclusion,...c.premises].every(id=>ids.has(id)));
});


test('flower puts results inside prerequisites, shares foundations and keeps orphans on the rim',()=>{
 const ns=['n_base','n_mid','n_result','n_other','n_orphan'].map(node),cs=[chain('arg_1',['n_base'],'n_mid'),chain('arg_2',['n_mid'],'n_result'),chain('arg_3',['n_base'],'n_other')];
 const diagram=derivationDiagram(sharedDerivationMap(ns,cs,['n_result'])),layout=layoutSharedDerivations(diagram);
 const radius=(id:string)=>{const p=layout.positions.get(id)!;return Math.hypot(p.x,p.y);};
 assert(radius('n_result')<radius('n_mid'));assert(radius('n_mid')<radius('n_base'));assert(Math.abs(radius('n_result')-radius('n_other'))<.001);
 assert(radius('n_orphan')>radius('n_base'));
 assert.equal(layout.positions.size,ns.length);
 const inward=(id:string)=>{const p=layout.positions.get(id)!;return p.x;};
 assert(inward('n_result')*inward('n_other')<0,'distinct results occupy different petals');
 const cyclic=layoutSharedDerivations(derivationDiagram(conceptDerivation(nodes,[...chains,chain('arg_cycle',['n_c'],'n_d')],['n_c'])));
 assert([...cyclic.positions.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});


test('compact overview folds carried premise chords without editing the full joint argument',()=>{
 const ns=['n_a','n_b','n_mid','n_end'].map(node),cs=[chain('arg_mid',['n_a','n_b'],'n_mid'),chain('arg_end',['n_a','n_b','n_mid'],'n_end')],scope=conceptDerivation(ns,cs,['n_end']),before=JSON.stringify(scope);
 const full=derivationDiagram(scope),compact=derivationDiagram(scope,{compact:true});
 assert.deepEqual(compact.folded,[{chainId:'arg_end',premiseIds:['n_a','n_b']}]);
 assert(compact.edges.some(e=>e.from==='n_mid'&&e.to==='arg_end'));
 assert(!compact.edges.some(e=>e.from==='n_a'&&e.to==='arg_end'));
 assert(full.edges.some(e=>e.from==='n_a'&&e.to==='arg_end'));
 assert.deepEqual(scope.chains.find(c=>c.id==='arg_end')!.premises,['n_a','n_b','n_mid']);
 assert.equal(JSON.stringify(scope),before);
 const cyclic=conceptDerivation(ns,[...cs,chain('arg_cycle',['n_mid'],'n_a')],['n_end']);
 assert(!derivationDiagram(cyclic,{compact:true}).folded!.some(f=>f.chainId==='arg_end'&&f.premiseIds.includes('n_a')));
 const layout=layoutSharedDerivations(compact);
 for(const sector of layout.sectors){const cluster=layout.clusters.find(c=>c.id===`proof-petal:${sector.rootId}`)!;for(const id of cluster.members){const p=layout.positions.get(id)!,centre=(sector.start+sector.end)/2,offset=Math.atan2(Math.sin(Math.atan2(p.y,p.x)-centre),Math.cos(Math.atan2(p.y,p.x)-centre));assert(Math.abs(offset)<=(sector.end-sector.start)/2+.001);}}
 for(let i=1;i<layout.sectors.length;i++)assert(layout.sectors[i]!.start>layout.sectors[i-1]!.end);
});
