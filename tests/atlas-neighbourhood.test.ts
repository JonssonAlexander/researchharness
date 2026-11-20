import {test} from "node:test";
import assert from "node:assert/strict";
import {atlasNeighbourhood,atlasConceptLessons,layoutAtlasLessonBranches} from "../src/core/atlas-neighbourhood.ts";
import type {AtlasSnapshot,AtlasConcept,AtlasSubject} from "../src/core/atlas.ts";
import {initialLesson,type LessonTopic} from "../src/core/learning-session.ts";
import type {LessonArtifact} from "../src/core/lesson-integration.ts";
const concept=(id:string,subjectIds:string[]=[],propositionIds:string[]=[]):AtlasConcept=>({id,title:id,aliases:[],subjectIds,preferredSubjectId:subjectIds[0]??null,propositionIds,revision:1,x:123,y:456});
const subject=(id:string,parentId:string|null=null):AtlasSubject=>({id,title:id,parentId,color:'#65a3dc',revision:1,x:0,y:0});
const link=(id:string,sourceId:string,targetId:string)=>({id,sourceId,targetId,label:'Related',direction:'unclear' as const,notes:'',replaces:null,removed:false});
test('subject maps include descendants and bounded real foundation links without writing positions or inventing edges',()=>{
 const s:AtlasSnapshot={subjects:[subject('s'),subject('child','s')],concepts:[concept('a',['s']),concept('b',['child']),concept('foundation'),concept('unrelated')],relations:[],drawingLinks:[link('ab','a','b'),link('af','a','foundation'),link('gone','b','unrelated')]};s.drawingLinks![2]!.removed=true;
 const before=JSON.stringify(s),view=atlasNeighbourhood(s,{kind:'subject',id:'s'});
 assert.deepEqual(view.primaryIds.sort(),['a','b']);assert.deepEqual(view.boundaryIds,['foundation']);assert.equal(view.links.length,2);assert.equal(JSON.stringify(s),before);
});
test('concept maps show immediate neighbours and only existing accepted typed links',()=>{
 const s:AtlasSnapshot={subjects:[],concepts:[concept('a'),concept('b'),concept('c')],drawingLinks:[link('ab','a','b'),link('bc','b','c')],relations:[]};
 const view=atlasNeighbourhood(s,{kind:'concept',id:'a'});assert.deepEqual(view.nodes.map(n=>n.id),['a','b']);assert.equal(view.links.length,1);
 assert.equal(atlasNeighbourhood(s,{kind:'concept',id:'missing'}).nodes.length,0);
});
test('linked canonical claims recover the source lesson for newly organized concepts',()=>{
 const s:AtlasSnapshot={subjects:[],concepts:[concept('a',[],['n_claim'])],relations:[],lessonMaps:[{id:'lesson',chatId:'chat',title:'Source lesson',conceptIds:[],newPropositionIds:[],map:{} as never,derivations:[{key:'proof',title:'Proof',rootId:'n_claim',conceptIds:[],propositionIds:['n_claim'],argumentIds:[],gaps:[],assistance:''}]}]};
 assert.equal(atlasConceptLessons(s,'a')[0]!.id,'lesson');assert.equal(atlasNeighbourhood(s,{kind:'concept',id:'a'}).lessons.length,1);
});

test('linked lesson branches merge exact titles, retain per-lesson edges and connect disconnected topics',()=>{
 const root={id:'root',title:'Anchor',x:10,y:20},neighbour={id:'atlas-neighbour',title:'Neighbour',x:10,y:-305};
 const topic=(id:string,title:string,fields:Partial<LessonTopic>={}):LessonTopic=>({id,title,conceptId:null,tangent:false,...fields});
 const artifact=(id:string,nodes:LessonTopic[]):LessonArtifact=>({
  id,chatId:id,title:id,conceptIds:[root.id],newPropositionIds:[],derivations:[],
  map:{...initialLesson(id),nodes,connections:[],currentNodeId:nodes[0]!.id},
 });
 const lessons=[
  artifact('a',[topic('start','Anchor'),topic('one','Exact topic'),topic('tail','Only A'),topic('detail','Detached',{tangent:true})]),
  artifact('b',[topic('one','Exact topic'),topic('tail','Only B'),topic('case','exact topic')]),
 ];
 const before=JSON.stringify(lessons);
 const scene=layoutAtlasLessonBranches(root,[root,neighbour],lessons);
 assert.deepEqual(scene,layoutAtlasLessonBranches(root,[root,neighbour],lessons));
 assert.equal(scene.topics.some(t=>t.title==='Anchor'),false);
 const shared=scene.topics.find(t=>t.title==='Exact topic')!;
 assert.deepEqual(shared.labels.map(({lessonId,topic})=>[lessonId,topic.id]),[['a','one'],['b','one']]);
 assert.deepEqual(shared.lessonIds,['a','b']);
 assert.equal(scene.topics.filter(t=>t.title==='Exact topic').length,1);
 assert.equal(scene.topics.some(t=>t.title==='exact topic'),true);
 const entry=scene.edges.find(e=>e.from===root.id&&e.to===shared.id)!;
 assert.deepEqual(entry.routeIds,['a']);
 assert.deepEqual(entry.mapIds,['b']);
 const detached=scene.topics.find(t=>t.title==='Detached')!;
 assert(scene.edges.some(e=>e.from===root.id&&e.to===detached.id&&e.mapIds.includes('a')));
 assert(scene.topics.every(t=>Math.abs(t.x-neighbour.x)>=250||Math.abs(t.y-neighbour.y)>=67));
 assert.equal(JSON.stringify(lessons),before);
});

test('separate lesson routes spread to both sides of the Atlas concept',()=>{
 const root={id:'root',title:'Anchor',x:0,y:0};
 const lessons=['a','b','c','d'].map(id=>{
  const map=initialLesson(id);
  map.nodes.push({id:'detail',title:`Next in ${id}`,tangent:false,conceptId:null});
  return {id,chatId:id,title:id,conceptIds:[root.id],newPropositionIds:[],derivations:[],map};
 });
 const scene=layoutAtlasLessonBranches(root,[root],lessons);
 for(const [i,lesson] of lessons.entries()){
  const direction=i%2===0?1:-1;
  const entry=scene.topics.find(p=>p.title===lesson.id)!;
  const next=scene.topics.find(p=>p.title===`Next in ${lesson.id}`)!;
  assert(direction*entry.x>0);
  assert(direction*(next.x-entry.x)>0);
 }
});
