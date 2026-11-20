"use client";
import {LessonScratchwork} from "./lesson-scratchwork";
import {useEffect,useMemo,useRef,useState} from "react";
import {atlasConceptLessons,atlasNeighbourhood,createLessonMotion,layoutAtlasLessonBranches,layoutLessonMap,lessonLabelSize,lessonMapTitle,lessonTopicKind,DEFAULT_RENDER_SETTINGS,type AtlasMapScope,type AtlasSnapshot} from "@/src/core";
import {GraphCanvasRenderer,fitTransform} from "./graph-canvas";
import {fitLessonFormula,lessonMapLabel} from "./lesson-map-label";
import {graphMathLabel} from "./graph-math-label";
import {MessageResponse} from "./ai-elements/message";
const branchColors=["#75b8ec","#e8af70","#81c7ad","#bb96d7","#e496a6","#9ebc70"];
const button="rounded border px-3 py-1.5 text-xs hover:bg-accent";
export function AtlasNeighbourhood({atlas,scope,onClose,onInspect,onDerivations,onLesson}:{atlas:AtlasSnapshot;scope:AtlasMapScope;onClose:()=>void;onInspect:(id:string)=>void;onDerivations:(id:string)=>void;onLesson:(id:string,chatId:string,key?:string)=>void}){
 const [trail,setTrail]=useState<AtlasMapScope[]>([scope]),[selectedId,setSelectedId]=useState<string|null>(null),[error,setError]=useState("");
 const [hiddenLessons,setHiddenLessons]=useState<ReadonlySet<string>>(()=>new Set());
 const [topicId,setTopicId]=useState<string|null>(null);
 const current=trail.at(-1)!,view=useMemo(()=>atlasNeighbourhood(atlas,current),[atlas,current]);
 const selected=view.nodes.find(n=>n.id===selectedId)??view.nodes.find(n=>n.id===view.rootId)??view.nodes[0];
 const lessons=useMemo(()=>selected?atlasConceptLessons(atlas,selected.id):view.lessons,[atlas,selected,view.lessons]);
 const lessonColors=useMemo(()=>new Map(lessons.map((lesson,i)=>[lesson.id,branchColors[i%branchColors.length]!])),[lessons]);
 const visibleLessons=lessons.filter(m=>!hiddenLessons.has(m.id));
 const proofs=lessons.flatMap(m=>m.derivations.filter(d=>d.conceptIds.includes(selected?.id??"")||d.propositionIds.some(id=>selected?.propositionIds.includes(id))));
 const positions=useMemo(()=>{
  const layout=layoutLessonMap({nodes:view.nodes.map(c=>({id:c.id,title:c.title,conceptId:c.id,tangent:false})),connections:view.links});
  const primary=layout.filter(n=>!view.boundaryIds.includes(n.id)),right=Math.max(0,...primary.map(n=>n.x))+220;
  const points=new Map(layout.map(n=>[n.id,n]));
  view.boundaryIds.forEach((id,i)=>points.set(id,{id,x:right,y:(i-(view.boundaryIds.length-1)/2)*100}));
  return points;
 },[view]);
 const branches=useMemo(()=>{
  const root=selected&&positions.get(selected.id);
  return root?layoutAtlasLessonBranches({...root,title:selected.title},view.nodes.map(n=>({...positions.get(n.id)!,title:n.title})),lessons):undefined;
 },[positions,selected,lessons,view.nodes]);
 const visibleTopics=useMemo(()=>branches?.topics.filter(n=>n.lessonIds.some(id=>!hiddenLessons.has(id)))??[],[branches,hiddenLessons]);
 const topic=visibleTopics.find(n=>n.id===topicId);
 const canvas=useRef<HTMLCanvasElement>(null),refit=useRef(()=>{});
 const moved=useRef(new Map<string,{x:number;y:number}>());
 function enter(next:AtlasMapScope){setTrail(t=>[...t,next]);setSelectedId(null);setTopicId(null);}
 function toggleLessons(ids:string[],show:boolean){
  setHiddenLessons(previous=>{
   const next=new Set(previous);
   for(const id of ids){if(show)next.delete(id);else next.add(id);}
   return next;
  });
 }
 useEffect(()=>{
  if(!canvas.current||!view.nodes.length)return;
  let graph:GraphCanvasRenderer|undefined,resize:ResizeObserver|undefined;
  try{
   const positionKey=(id:string)=>JSON.stringify([current.kind,current.id,positions.has(id)?null:selected?.id,id]);
   const neighbours=new Set(selected?[selected.id]:[]);
   for(const {from,to} of view.links){
    if(from===selected?.id)neighbours.add(to);
    if(to===selected?.id)neighbours.add(from);
   }
   const selectedColor=atlas.subjects.find(s=>s.id===selected?.preferredSubjectId)?.color??"#65a3dc";
   const shown=(id:string)=>!hiddenLessons.has(id);
   const branchColor=(ids:string[])=>ids.length===1?lessonColors.get(ids[0]!):"#aab6c6";
   const lessonNodes=visibleTopics.map(point=>{
    const labels=point.labels.filter(label=>shown(label.lessonId)).map(label=>label.topic);
    const first=labels[0]!;
    const topic={...first,id:point.id,
     question:labels.every(n=>n.question===first.question)?first.question:undefined,
     formula:labels.every(n=>n.formula===first.formula)?first.formula:undefined,
    };
    const size=lessonLabelSize(topic),main=lessonTopicKind(topic)==="topic";
    return {...point,...moved.current.get(positionKey(point.id)),topic,label:topic.title,htmlLabel:lessonMapLabel(topic),labelWidth:size.width,labelHeight:size.height,sizeScale:main?1.3:.65,color:branchColor(point.lessonIds.filter(shown)),fixed:true,draggable:true};
   });
   const routeEdges=(branches?.edges??[]).filter(edge=>edge.routeIds.some(shown));
   const mapEdges=(branches?.edges??[]).flatMap(edge=>{
    const ids=edge.mapIds.filter(shown);
    return ids.length&&!edge.routeIds.some(shown)?[{...edge,color:branchColor(ids)}]:[];
   });
   const atlasNodes=view.nodes.map(c=>({
    ...positions.get(c.id)!,...moved.current.get(positionKey(c.id)),
    label:lessonMapTitle(c.title),htmlLabel:graphMathLabel(lessonMapTitle(c.title)),
    color:atlas.subjects.find(s=>s.id===c.preferredSubjectId)?.color??"#65a3dc",
    badgeColor:view.boundaryIds.includes(c.id)?"#9ca3af":undefined,
    fixed:true,draggable:true,labelWidth:lessonNodes.length?170:100,labelHeight:110,
   }));
   const nodes=[...atlasNodes,...lessonNodes];
   const motion=createLessonMotion({
    nodes:[
     ...atlasNodes.map(n=>({id:n.id,title:n.label,conceptId:n.id,tangent:false})),
     ...lessonNodes.map(n=>({...n.topic,parentId:undefined})),
    ],
    connections:[],
   },nodes.map(({id,x,y})=>({id,x,y})),[...view.links,...routeEdges,...mapEdges]);
   graph=new GraphCanvasRenderer(canvas.current,{onSelect:id=>{
    if(positions.has(id)){setSelectedId(id);setTopicId(null);}
    else setTopicId(id);
   },onPositions:points=>{
    for(const {id,x,y} of points)moved.current.set(positionKey(id),{x,y});
   },onContext:()=>{},onStageClick:()=>setTopicId(null),onCameraMove:()=>{},onCommit:()=>{}});
   graph.setSettings({...DEFAULT_RENDER_SETTINGS,nodeSize:lessonNodes.length?7:5,labelSize:lessonNodes.length?23:12,labelZoom:8,clusterLabels:true,clusterLabelSize:11});
   graph.setData({
    nodes,motion,
    edges:[],mapEdges:[...view.links.filter(e=>e.kind==="drawing"),...mapEdges],routeEdges,
    semanticEdges:view.links.filter(e=>e.kind==="typed"),logicalEdges:[],
    alwaysClusterLabels:true,
    clusters:[
     ...(selected?[
      {id:selected.id,label:null,members:[...neighbours],color:selectedColor},
      {id:`label:${selected.id}`,label:selected.title,members:[selected.id],color:selectedColor,labelOnly:true},
     ]:[]),
     ...lessons.filter(lesson=>shown(lesson.id)).map(lesson=>({
      id:`label:${lesson.id}`,label:lesson.title,
      members:visibleTopics.filter(topic=>topic.lessonIds.includes(lesson.id)).map(topic=>topic.id),
      color:lessonColors.get(lesson.id),labelOnly:true,
     })),
    ],
    colors:{node:"#65a3dc",edge:"#808590",label:"#c3c7cc",hoverText:"#ffffff"},fontFamily:getComputedStyle(document.body).fontFamily,
   });
   if(selected)graph.setNodeEmphasis({[selected.id]:"prominent"});
   for(const node of lessonNodes)fitLessonFormula(node.htmlLabel,node.labelWidth);
   refit.current=()=>{
    const el=canvas.current;
    if(!el||el.clientWidth<24||el.clientHeight<24)return;
    const b={minX:Math.min(...nodes.map(p=>p.x-p.labelWidth/2-8)),maxX:Math.max(...nodes.map(p=>p.x+p.labelWidth/2+8)),minY:Math.min(...nodes.map(p=>p.y))-30,maxY:Math.max(...nodes.map(p=>p.y+p.labelHeight+20))};
    const camera=fitTransform(b,el.clientWidth,el.clientHeight,24);
    graph?.restoreViewCamera({x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,k:Math.min(1.25,camera.k)});
   };
   refit.current();resize=new ResizeObserver(()=>refit.current());resize.observe(canvas.current);setError("");
  }catch{setError("Use the lists on the right; the canvas is unavailable.");}
  return()=>{resize?.disconnect();graph?.destroy();refit.current=()=>{};};
 },[current,selected,view,atlas.subjects,positions,branches,hiddenLessons,lessons,lessonColors,visibleTopics]);
 return <section role="dialog" aria-label={`${view.title} map`} className="absolute inset-0 z-40 flex flex-col bg-background">
  <header className="flex items-center justify-between gap-3 border-b p-4"><div className="min-w-0"><div className="flex gap-2 text-xs text-muted-foreground"><span>Atlas</span>{trail.length>1&&<button type="button" onClick={()=>{setTrail(t=>t.slice(0,-1));setSelectedId(null);setTopicId(null);}}>← Back</button>}<span> / {current.kind} map</span></div><h2 className="mt-1 text-lg"><MessageResponse mode="static">{view.title}</MessageResponse></h2></div><button type="button" className={button} onClick={onClose}>Back to Atlas</button></header>
  <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_20rem] md:overflow-hidden">
   <div className="relative min-h-80 overflow-hidden md:min-h-0"><canvas ref={canvas} className="absolute inset-0 h-full w-full touch-none" aria-label="Focused Atlas map; select or drag a concept or lesson topic"/><button type="button" className={`${button} absolute left-3 top-3 bg-background`} onClick={()=>refit.current()}>Fit map</button><p className="absolute bottom-2 left-3 max-w-md bg-background/90 p-2 text-xs text-muted-foreground">{view.nodes.length} concepts{visibleLessons.length>0&&` · ${visibleLessons.length} lesson ${visibleLessons.length===1?"map":"maps"}`} · concept links, not proof arrows{view.omittedPrimary?` · ${view.omittedPrimary} more concepts in Atlas`:""}{view.boundaryIds.length?" · foundations on the right":""}{view.omittedBoundary?` · ${view.omittedBoundary} more external concepts in Atlas`:""}{error&&` · ${error}`}</p></div>
   <aside className="space-y-4 overflow-y-auto border-l p-4 text-sm">
    {!view.nodes.length&&<p>No concepts in this map yet.</p>}
    {selected&&<><h3 className="font-medium"><MessageResponse mode="static">{selected.title}</MessageResponse></h3><div className="flex flex-wrap gap-2">{selected.id!==view.rootId&&<button type="button" className={button} onClick={()=>enter({kind:"concept",id:selected.id})}>Open map</button>}<button type="button" className={button} onClick={()=>onInspect(selected.id)}>Notes & edit</button>{(selected.propositionIds.length>0||proofs.length>0)&&<button type="button" className={button} onClick={()=>onDerivations(selected.id)}>Derivations{proofs.length?` · ${proofs.length}`:""}</button>}</div>
    <div className="flex flex-wrap gap-2">{atlas.subjects.filter(s=>selected.subjectIds.includes(s.id)).map(s=><button key={s.id} type="button" className="text-xs underline" style={{color:s.color}} onClick={()=>enter({kind:"subject",id:s.id})}>{s.title}</button>)}</div>
    {!!lessons.length&&<div className="space-y-2">
     <div className="flex items-center justify-between gap-2">
      <h4 className="text-xs text-muted-foreground">Lessons</h4>
      {lessons.length>1&&<button type="button" className={button} onClick={()=>toggleLessons(lessons.map(m=>m.id),visibleLessons.length<lessons.length)}>{visibleLessons.length===lessons.length?"Hide all maps":"Show all maps"}</button>}
     </div>
     {topic&&<p role="status" className="break-words text-xs">Selected topic · {topic.title}</p>}
     {lessons.map(m=><div key={m.id} className={`rounded border p-2 text-xs ${topic?.lessonIds.includes(m.id)&&!hiddenLessons.has(m.id)?"border-foreground":""}`}>
      <button type="button" className={`mb-2 flex items-center gap-2 rounded border px-2 py-1 ${hiddenLessons.has(m.id)?"text-muted-foreground":"bg-accent"}`} aria-label={`Show map for ${m.title}`} aria-pressed={!hiddenLessons.has(m.id)} onClick={()=>toggleLessons([m.id],hiddenLessons.has(m.id))}>
       <span aria-hidden="true" className="size-2 rounded-full" style={{backgroundColor:lessonColors.get(m.id)}}/>
       Show on map
      </button>
      <button type="button" className="text-left underline" onClick={()=>onLesson(m.id,m.chatId)}>{m.title}</button>
      <a className="mt-1 block text-muted-foreground underline" href={`/chat/${m.chatId}`}>Continue conversation</a>
     </div>)}
     {visibleTopics.length>0&&<details>
      <summary className="cursor-pointer text-xs text-muted-foreground">Visible lesson topics</summary>
      {visibleTopics.map(node=><button key={node.id} type="button" className="mt-1 block text-left text-xs underline" onClick={()=>setTopicId(node.id)}>{node.title}</button>)}
     </details>}
    </div>}
    <LessonScratchwork maps={atlas.lessonMaps??[]} conceptId={selected.id}/>
    {selected.markdown&&<details><summary className="cursor-pointer text-xs text-muted-foreground">Saved notes</summary><MessageResponse mode="static">{selected.markdown}</MessageResponse></details>}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">Connections · {view.links.filter(e=>e.from===selected.id||e.to===selected.id).length}</summary>{view.links.filter(e=>e.from===selected.id||e.to===selected.id).map(e=><p key={e.id} className="mt-2 text-xs">{view.nodes.find(n=>n.id===(e.from===selected.id?e.to:e.from))?.title} · {e.kind==="typed"?e.label:e.label||"ordinary association"}</p>)}</details></>}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">All concepts</summary>{view.nodes.map(c=><button type="button" key={c.id} className="mt-1 block text-left text-xs underline" onClick={()=>{setSelectedId(c.id);setTopicId(null);}}>{c.title}</button>)}</details>
   </aside>
  </div>
 </section>;
}
