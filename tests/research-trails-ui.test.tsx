import React, {act} from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import {parseHTML} from 'linkedom';
import {ServerEventsProvider} from "../components/server-events.tsx";
import {ResearchFrontier} from "../components/research-frontier.tsx";
import {ResearchTrailEntry,ResearchTrails} from '../components/research-trails.tsx';
import {researchCommandSchema, type AtlasSnapshot, type ResearchNode, type ResearchTrail} from '../src/core/index.ts';

const conceptId='ac_00000000-0000-4000-8000-000000000001';
const otherId='ac_00000000-0000-4000-8000-000000000002';
const trailId='rt_00000000-0000-4000-8000-000000000001';
const nodeId='rn_00000000-0000-4000-8000-000000000001';
const atlas:AtlasSnapshot={subjects:[],relations:[],concepts:[conceptId,otherId].map((id,i)=>({id,title:i?'Second':'First',aliases:[],subjectIds:[],preferredSubjectId:null,propositionIds:[],revision:1,x:0,y:0}))};
const trail:ResearchTrail={id:trailId,title:'Question',rootNodeId:nodeId,status:'active',workspaceId:null,primaryConceptId:conceptId,anchorConceptIds:[conceptId],origin:{kind:'atlas'},revision:1,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',archivedAt:null,missingConceptIds:[],linkedConceptIds:[conceptId]};
const node:ResearchNode={id:nodeId,trailId,parentNodeId:null,kind:'question',title:'Question',body:'My retained notes',relatedConceptIds:[],revision:1,createdAt:trail.createdAt,updatedAt:trail.updatedAt,missingConceptIds:[]};
async function mount(render:()=>React.ReactNode,fetcher:typeof fetch) {
 const dom=parseHTML('<html><body><div id="root"></div></body></html>');
 const previous=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value] of Object.entries({React,window:dom.window,document:dom.document,fetch:fetcher,IS_REACT_ACT_ENVIRONMENT:true})){
  previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 const {createRoot}=await import('react-dom/client');const root=createRoot(dom.document.getElementById('root')!);
 async function update(){await act(async()=>root.render(render()));}await update();
 return {document:dom.document,update,async close(){await act(async()=>root.unmount());for(const [key,value] of previous){if(value)Object.defineProperty(globalThis,key,value);else delete (globalThis as Record<string,unknown>)[key];}}};
}
function click(document:Document,label:string){const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert(button,`Missing button ${label}`);button.dispatchEvent(new window.Event('click',{bubbles:true}));}
async function submit(document:Document){await act(async()=>{document.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});}

test('chat entry sends only an explicit research command and preserves retry identity after an error',async()=>{
 const attempts:{url:string;body:unknown}[]=[];
 const ui=await mount(()=> <ResearchTrailEntry origin={{kind:'chat',chatId:'chat-1'}} initialQuestion="Can this converge?"/>,async(input,init)=>{attempts.push({url:String(input),body:JSON.parse(String(init?.body))});return attempts.length===1?Response.json({error:'Please retry'},{status:409}):Response.json({result:{}});});
 try{
  await act(async()=>click(ui.document,'New research trail'));
  assert.match(ui.document.body.textContent!,/unanchored/);
  await submit(ui.document);
  assert.match(ui.document.querySelector('[role="alert"]')!.textContent!,/Please retry/);
  assert.equal(ui.document.querySelector('input[required]')!.getAttribute('value'),'Can this converge?');
  await submit(ui.document);
  assert.equal(ui.document.querySelector('form'),null);
  assert.equal(attempts.length,2);
  assert.deepEqual(attempts[0],attempts[1]);
  assert.equal(attempts[0]!.url,'/api/research');
  const command=researchCommandSchema.parse(attempts[0]!.body);
  assert.equal(command.kind,'create');
  if(command.kind==='create'){assert.deepEqual(command.origin,{kind:'chat',chatId:'chat-1'});assert.deepEqual(command.anchorConceptIds,[]);assert.equal(command.question,'Can this converge?');}
 }finally{await ui.close();}
});

test('concept switching anchors the new trail and failed node edits retain the editor',async()=>{
 let selected=conceptId;const commands:unknown[]=[];
 const state={trails:[trail],workspaces:[],detail:{trail,nodes:[node],workspace:null},selectedId:trailId,nodeId:null,select(){},refresh:async()=>{},error:'',mode:'selected',setMode(){}} as unknown as Parameters<typeof ResearchTrails>[0]['research'];
 const ui=await mount(()=> <ResearchTrails research={state} atlas={atlas} conceptId={selected}/>,async(_input,init)=>{commands.push(JSON.parse(String(init?.body)));return Response.json({error:'Revision conflict'}, {status:409});});
 try{
  assert.match(ui.document.body.textContent!,/First/);
  await act(async()=>click(ui.document,'Edit node'));
  await act(async()=>click(ui.document,'Save node'));
  assert.match(ui.document.querySelector('[role="alert"]')!.textContent!,/Revision conflict/);
  assert(ui.document.querySelector('textarea'), 'failed edits must remain editable');
  selected=otherId;await ui.update();
  await act(async()=>click(ui.document,'New research trail'));
  const anchor=[...ui.document.querySelectorAll('select')].find(s=>s.parentElement?.textContent?.includes('Anchor concept'))!;
  assert.equal(anchor.value,otherId);
  assert.equal((commands[0] as {kind:string}).kind,'edit-node');
 }finally{await ui.close();}
});

test("Research Frontier opens the saved brief and only starts work after an explicit action", async () => {
 const commands: unknown[] = [];
 const idea = {id: "abcd", title: "A uniform estimate", hypothesis: "Can the bound be uniform in dimension?",
  intuition: "Use the existing contraction step.", sources: ["claim"], exploration: false};
 const assessment = {id: idea.id, sources: ["claim"], startingPoint: "A contraction in each fixed dimension.",
  obstacles: "The norm constant grows.", novelty: "Uniformity is open in the packet.", nextAction: "Track the dimension constant.",
  uncertainty: "The examples may make it sharp.", reason: "A precise argument to inspect.", support: 3, usefulness: 4, surprise: 1, verdict: "pursue"};
 const brief = {id: "job_test_deadbeef", date: "2026-11-20T00:00:00.000Z", goal: "Uniform estimates", budget: 35000,
  selected: [idea.id], previous: ["retired", idea.id], opportunities: [{idea,assessment}], sourceTitles: {claim: "Contraction theorem"}};
 const connect = () => ({close() {}, onOpen() {}, onEvent() {}});
 const ui = await mount(() => <ServerEventsProvider connect={connect}>
  <ResearchFrontier trails={[trail]} onConcept={() => {}} onTrail={() => {}}/>
 </ServerEventsProvider>, async (_input, init) => {
  if (init?.body) commands.push(JSON.parse(String(init.body)));
  return Response.json({model: "fixture:research", job: null, brief});
 });
 try {
  assert.match(ui.document.body.textContent!, /A uniform estimate.*Up from 2/);
  assert.match(ui.document.body.textContent!, /Contraction theorem/);
  assert.equal(commands.length, 0);
  await act(async () => click(ui.document, "Deepen"));
  assert.deepEqual(commands[0], {action: "deepen", id: brief.id, opportunityId: idea.id});
  await act(async () => {
   [...ui.document.querySelectorAll("form")].at(-1)!.dispatchEvent(new window.Event("submit", {bubbles: true, cancelable: true}));
  });
  assert.deepEqual(commands[1], {action: "start", goal: brief.goal, budget: brief.budget});
 } finally {await ui.close();}
});
