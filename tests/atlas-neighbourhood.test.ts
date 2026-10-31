import {test} from "node:test";
import assert from "node:assert/strict";
import {atlasNeighbourhood,atlasConceptLessons} from "../src/core/atlas-neighbourhood.ts";
import type {AtlasSnapshot,AtlasConcept,AtlasSubject} from "../src/core/atlas.ts";
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
