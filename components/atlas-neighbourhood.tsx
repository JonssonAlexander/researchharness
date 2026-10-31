"use client";
import {LessonScratchwork} from "./lesson-scratchwork";
import {useEffect,useMemo,useRef,useState} from "react";
import {atlasConceptLessons,atlasNeighbourhood,layoutLessonMap,lessonMapTitle,DEFAULT_RENDER_SETTINGS,type AtlasMapScope,type AtlasSnapshot} from "@/src/core";
import {GraphCanvasRenderer,fitTransform} from "./graph-canvas";
import {graphMathLabel} from "./graph-math-label";
import {MessageResponse} from "./ai-elements/message";
const button="rounded border px-3 py-1.5 text-xs hover:bg-accent";
export function AtlasNeighbourhood({atlas,scope,onClose,onInspect,onDerivations,onLesson}:{atlas:AtlasSnapshot;scope:AtlasMapScope;onClose:()=>void;onInspect:(id:string)=>void;onDerivations:(id:string)=>void;onLesson:(id:string,chatId:string,key?:string)=>void}){
 const [trail,setTrail]=useState<AtlasMapScope[]>([scope]),[selectedId,setSelectedId]=useState<string|null>(null),[error,setError]=useState("");
 const current=trail.at(-1)!,view=useMemo(()=>atlasNeighbourhood(atlas,current),[atlas,current]);
 const selected=view.nodes.find(n=>n.id===selectedId)??view.nodes.find(n=>n.id===view.rootId)??view.nodes[0];
 const canvas=useRef<HTMLCanvasElement>(null),refit=useRef(()=>{});
 function enter(next:AtlasMapScope){setTrail(t=>[...t,next]);setSelectedId(null);}
 useEffect(()=>{
  if(!canvas.current||!view.nodes.length)return;let graph:GraphCanvasRenderer|undefined,resize:ResizeObserver|undefined;
  try{
   const layout=layoutLessonMap({nodes:view.nodes.map(c=>({id:c.id,title:c.title,conceptId:c.id,tangent:false})),connections:view.links});
   // Boundary concepts form a separate reference column; primary labels reserve space.
   const primary=layout.filter(n=>!view.boundaryIds.includes(n.id)),right=Math.max(0,...primary.map(n=>n.x))+220;
   const points=new Map(layout.map(n=>[n.id,n]));view.boundaryIds.forEach((id,i)=>points.set(id,{id,x:right,y:(i-(view.boundaryIds.length-1)/2)*100}));
   graph=new GraphCanvasRenderer(canvas.current,{onSelect:id=>setSelectedId(id),onContext:()=>{},onStageClick:()=>{},onCameraMove:()=>{},onCommit:()=>{}});
   graph.setSettings({...DEFAULT_RENDER_SETTINGS,nodeSize:5,labelSize:12,labelZoom:8,clusterLabels:false});
   graph.setData({labelWidth:100,nodes:view.nodes.map(c=>({...points.get(c.id)!,label:lessonMapTitle(c.title),htmlLabel:graphMathLabel(lessonMapTitle(c.title)),color:atlas.subjects.find(s=>s.id===c.preferredSubjectId)?.color??"#65a3dc",badgeColor:view.boundaryIds.includes(c.id)?"#9ca3af":undefined,fixed:true})),edges:[],mapEdges:view.links.filter(e=>e.kind==="drawing"),semanticEdges:view.links.filter(e=>e.kind==="typed"),logicalEdges:[],clusters:[],colors:{node:"#65a3dc",edge:"#808590",label:"#c3c7cc",hoverText:"#ffffff"},fontFamily:getComputedStyle(document.body).fontFamily});
   graph.setNodeEmphasis(view.rootId?{[view.rootId]:"prominent"}:{});
   refit.current=()=>{const el=canvas.current,n=[...points.values()];if(!el||el.clientWidth<24||!n.length)return;const b={minX:Math.min(...n.map(p=>p.x))-85,maxX:Math.max(...n.map(p=>p.x))+85,minY:Math.min(...n.map(p=>p.y))-30,maxY:Math.max(...n.map(p=>p.y))+80},camera=fitTransform(b,el.clientWidth,el.clientHeight,24);graph?.restoreViewCamera({x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,k:Math.min(1.25,camera.k)});};
   refit.current();resize=new ResizeObserver(()=>refit.current());resize.observe(canvas.current);setError("");
  }catch{setError("Use the concept list below; the canvas is unavailable.");}
  return()=>{resize?.disconnect();graph?.destroy();refit.current=()=>{};};
 },[view,atlas.subjects]);
 const lessons=selected?atlasConceptLessons(atlas,selected.id):view.lessons,proofs=lessons.flatMap(m=>m.derivations.filter(d=>d.conceptIds.includes(selected?.id??"")||d.propositionIds.some(id=>selected?.propositionIds.includes(id))));
 return <section role="dialog" aria-label={`${view.title} map`} className="absolute inset-0 z-40 flex flex-col bg-background">
  <header className="flex items-center justify-between gap-3 border-b p-4"><div className="min-w-0"><div className="flex gap-2 text-xs text-muted-foreground"><span>Atlas</span>{trail.length>1&&<button type="button" onClick={()=>{setTrail(t=>t.slice(0,-1));setSelectedId(null);}}>← Back</button>}<span> / {current.kind} map</span></div><h2 className="mt-1 text-lg"><MessageResponse mode="static">{view.title}</MessageResponse></h2></div><button type="button" className={button} onClick={onClose}>Back to Atlas</button></header>
  <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_20rem] md:overflow-hidden">
   <div className="relative min-h-80 md:min-h-0"><canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-label="Focused concept map; select a concept"/><button type="button" className={`${button} absolute left-3 top-3 bg-background`} onClick={()=>refit.current()}>Fit map</button><p className="absolute bottom-2 left-3 max-w-md bg-background/90 p-2 text-xs text-muted-foreground">{view.nodes.length} concepts · concept links, not proof arrows{view.omittedPrimary?` · ${view.omittedPrimary} more concepts in Atlas`:""}{view.boundaryIds.length?" · foundations on the right":""}{view.omittedBoundary?` · ${view.omittedBoundary} more external concepts in Atlas`:""}{error&&` · ${error}`}</p></div>
   <aside className="space-y-4 overflow-y-auto border-l p-4 text-sm">
    {!view.nodes.length&&<p>No concepts in this map yet.</p>}
    {selected&&<><h3 className="font-medium"><MessageResponse mode="static">{selected.title}</MessageResponse></h3><div className="flex flex-wrap gap-2">{selected.id!==view.rootId&&<button type="button" className={button} onClick={()=>enter({kind:"concept",id:selected.id})}>Open map</button>}<button type="button" className={button} onClick={()=>onInspect(selected.id)}>Notes & edit</button>{(selected.propositionIds.length>0||proofs.length>0)&&<button type="button" className={button} onClick={()=>onDerivations(selected.id)}>Derivations{proofs.length?` · ${proofs.length}`:""}</button>}</div>
    <div className="flex flex-wrap gap-2">{atlas.subjects.filter(s=>selected.subjectIds.includes(s.id)).map(s=><button key={s.id} type="button" className="text-xs underline" style={{color:s.color}} onClick={()=>enter({kind:"subject",id:s.id})}>{s.title}</button>)}</div>
    {!!lessons.length&&<div className="space-y-2"><h4 className="text-xs text-muted-foreground">Lessons</h4>{lessons.map(m=><div key={m.id} className="rounded border p-2 text-xs"><button type="button" className="text-left underline" onClick={()=>onLesson(m.id,m.chatId)}>{m.title}</button><a className="mt-1 block text-muted-foreground underline" href={`/chat/${m.chatId}`}>Continue conversation</a></div>)}</div>}
    <LessonScratchwork maps={atlas.lessonMaps??[]} conceptId={selected.id}/>
    {selected.markdown&&<details><summary className="cursor-pointer text-xs text-muted-foreground">Saved notes</summary><MessageResponse mode="static">{selected.markdown}</MessageResponse></details>}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">Connections · {view.links.filter(e=>e.from===selected.id||e.to===selected.id).length}</summary>{view.links.filter(e=>e.from===selected.id||e.to===selected.id).map(e=><p key={e.id} className="mt-2 text-xs">{view.nodes.find(n=>n.id===(e.from===selected.id?e.to:e.from))?.title} · {e.kind==="typed"?e.label:e.label||"ordinary association"}</p>)}</details></>}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">All concepts</summary>{view.nodes.map(c=><button type="button" key={c.id} className="mt-1 block text-left text-xs underline" onClick={()=>setSelectedId(c.id)}>{c.title}</button>)}</details>
   </aside>
  </div>
 </section>;
}
