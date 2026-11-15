"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {DEFAULT_RENDER_SETTINGS,layoutLessonMap,lessonMapLayers,lessonLabelSize,lessonParent,lessonRoot,lessonTopicKind,createLessonMotion,lessonRoute,lessonVisibleTopicIds,type LearningPlan} from "@/src/core";
import {GraphCanvasRenderer,fitTransform} from "./graph-canvas";
import {lessonMapLabel,fitLessonFormula} from "./lesson-map-label";
const button="rounded border bg-background/90 px-2 py-1 text-xs hover:bg-accent";
export function LessonMap({plan,onSelect,expanded=false}:{plan:LearningPlan;onSelect:(id:string)=>void;expanded?:boolean}){
 const [unavailable,setUnavailable]=useState(false),[larger,setLarger]=useState(false),[branch,setBranch]=useState<string|null>(()=>lessonRoot(plan,plan.currentNodeId)),[all,setAll]=useState(false);
 const [following,setFollowing]=useState(true);
 useEffect(()=>{if(following){setBranch(lessonRoot(plan,plan.currentNodeId));setAll(false);}},[plan.currentNodeId,following,plan]);
 const canvas=useRef<HTMLCanvasElement>(null),select=useRef(onSelect);select.current=onSelect;
 const fitMap=useRef(()=>{}),focusMap=useRef(()=>{}),camera=useRef<{x:number;y:number;k:number}|null>(null),lastView=useRef("");
 const arrangements=useRef(new Map<string,Map<string,{x:number;y:number}>>());
 const view=all?"all":branch??"overview";
 const current=plan.nodes.find(n=>n.id===plan.currentNodeId),order=lessonRoute(plan),currentRoot=lessonRoot(plan,plan.currentNodeId),step=order.indexOf(currentRoot??'')+1;
 const scene=useMemo(()=>{
  const ids=lessonVisibleTopicIds(plan,branch,all,following?plan.currentNodeId:null),nodes=plan.nodes.filter(n=>ids.has(n.id));
  return {...plan,nodes,connections:plan.connections.filter(e=>ids.has(e.from)&&ids.has(e.to))};
 },[plan,all,branch,following]);
 const topology=JSON.stringify({nodes:scene.nodes.map(({id,title,kind,tangent,parentId,formula,question,section})=>({id,title,kind,tangent,parentId,formula,question,section,conceptId:null})),connections:scene.connections});
 const projection=useMemo(()=>layoutLessonMap(JSON.parse(topology)),[topology]);
 useEffect(()=>{if(!larger)return;const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setLarger(false);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[larger]);
 useEffect(()=>{
  const el=canvas.current;if(!el)return;let graph:GraphCanvasRenderer|undefined,resize:ResizeObserver|undefined;
  const positions=arrangements.current.get(view)??new Map();arrangements.current.set(view,positions);
  const hadPositions=positions.size>0,added:string[]=[];
  for(const p of projection)if(!positions.has(p.id)){
   const n=scene.nodes.find(n=>n.id===p.id)!,parent=lessonParent(scene,n),anchor=parent?positions.get(parent):null,seed=projection.find(p=>p.id===parent);
   positions.set(p.id,anchor&&seed?{x:p.x+anchor.x-seed.x,y:p.y+anchor.y-seed.y}:{x:p.x,y:p.y});added.push(p.id);
  }
  try{
   graph=new GraphCanvasRenderer(el,{onSelect:id=>{
    select.current(id);setFollowing(false);
    const node=plan.nodes.find(n=>n.id===id)!;
    if(lessonTopicKind(node)==="topic"){setAll(false);setBranch(old=>old===id?null:id);}
   },onContext:()=>{},onStageClick:()=>{},onCameraMove:()=>{},onCommit:()=>{},onPositions:frame=>{for(const p of frame)positions.set(p.id,{x:p.x,y:p.y});}});
   graph.setSettings({...DEFAULT_RENDER_SETTINGS,nodeSize:5,labelSize:14,labelZoom:8,clusterLabels:true,clusterLabelSize:14});
   const layers=lessonMapLayers(scene),nodes=scene.nodes.map(n=>{
    const kind=lessonTopicKind(n),count=plan.nodes.filter(child=>child.id!==n.id&&lessonRoot(plan,child.id)===n.id).length;
    return {...positions.get(n.id)!,id:n.id,label:n.title,htmlLabel:lessonMapLabel(n,count,n.id===plan.currentNodeId),labelWidth:lessonLabelSize(n).width,sizeScale:kind==="topic"?1.3:.65,labelScale:kind==="topic"?1:.92,
     color:kind==="tangent"?"#bb96d7":n.progress==="explored"?"#85a99a":n.progress==="revisit"?"#e6b35a":"#65a3dc",focusRing:n.id===plan.currentNodeId?"#9dd8ff":undefined,fixed:true,draggable:true};
   });
   const sections=[...new Set(scene.nodes.filter(n=>lessonTopicKind(n)==='topic'&&n.section).map(n=>n.section!))];
   const clusters=sections.map((section,i)=>({id:section,label:section,members:scene.nodes.filter(n=>plan.nodes.find(p=>p.id===lessonRoot(plan,n.id))?.section===section).map(n=>n.id),color:['#506b83','#716947','#4d7467'][i%3]}));
   const motion=createLessonMotion(scene,scene.nodes.map(n=>({id:n.id,...positions.get(n.id)!})));
   if(hadPositions&&added.length){const id=added.at(-1)!;motion.move(id,positions.get(id)!);motion.release();}
   graph.setData({nodes,motion,alwaysClusterLabels:true,edges:[],mapEdges:[...layers.branches.map(e=>({...e,color:"#899ba9"})),...layers.associations.map(e=>({...e,color:"#424b57"}))],routeEdges:layers.route,logicalEdges:[],clusters,colors:{node:"#65a3dc",edge:"#808590",label:"#bec5cf",hoverText:"#e0e8f2"},fontFamily:getComputedStyle(document.body).fontFamily});
   for(const n of nodes)fitLessonFormula(n.htmlLabel,n.labelWidth);
   const fit=(focus=false)=>{
    if(el.clientWidth<24||el.clientHeight<24)return;
    const included=focus&&branch?scene.nodes.filter(n=>lessonRoot(scene,n.id)===branch):scene.nodes;
    if(!included.length)return;
    const bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
    for(const n of included){const p=positions.get(n.id)!,size=lessonLabelSize(n);bounds.minX=Math.min(bounds.minX,p.x-size.width/2-16);bounds.maxX=Math.max(bounds.maxX,p.x+size.width/2+16);bounds.minY=Math.min(bounds.minY,p.y-90);bounds.maxY=Math.max(bounds.maxY,p.y+size.height+20);}
    const fitted=fitTransform(bounds,el.clientWidth,el.clientHeight,24);graph?.restoreViewCamera({x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2,k:Math.min(larger?2:1.1,fitted.k)});
   };
   fitMap.current=()=>fit(false);focusMap.current=()=>fit(true);
   if(camera.current&&lastView.current===view)graph.restoreViewCamera(camera.current);else fit(!!branch);
   lastView.current=view;
   resize=new ResizeObserver(()=>{if(!camera.current&&el.clientWidth>=24){fit(!!branch);camera.current=graph!.getViewCamera();}});resize.observe(el);setUnavailable(false);
  }catch{setUnavailable(true);}
  return()=>{resize?.disconnect();if(graph)camera.current=graph.getViewCamera();graph?.destroy();};
 },[plan,scene,projection,view,branch,larger]);
 useEffect(()=>{const frame=requestAnimationFrame(()=>branch?focusMap.current():fitMap.current());return()=>cancelAnimationFrame(frame);},[larger,branch]);
 return <div role={larger?"dialog":undefined} aria-modal={larger?true:undefined} aria-label={larger?"Lesson map":undefined} className={`shrink-0 overflow-hidden ${larger?"fixed inset-4 z-50 rounded-xl border bg-background shadow-xl":expanded?"relative h-96":"relative h-64 md:h-80"}`}>
  <canvas ref={canvas} aria-label="Lesson concept map; drag to arrange, tap a topic to unfold, pinch to zoom" className="absolute inset-0 h-full w-full touch-none"/>
  <div className="absolute right-2 top-2 z-10 flex gap-1"><button type="button" className={button} onClick={()=>fitMap.current()}>Fit</button><button type="button" className={button} aria-pressed={all} onClick={()=>{setFollowing(false);setAll(v=>!v);setBranch(null);}}>All details</button>{!expanded&&<button type="button" className={button} aria-label={larger?"Shrink lesson map":"Enlarge lesson map"} onClick={()=>setLarger(v=>!v)}>{larger?"↙":"↗"}</button>}</div>
  <button type="button" aria-label="Focus current lesson topic" className="absolute bottom-1 left-2 max-w-[90%] rounded bg-background/95 px-2 py-1 text-left text-xs text-foreground" onClick={()=>{setFollowing(true);setAll(false);setBranch(currentRoot);focusMap.current();}}>{unavailable?'Map unavailable; use topics below.':`Now · ${step>0?`${step}/${order.length} · `:''}${current?.question||current?.title||'Choose a topic'}${following?'':' · return here'}`}</button>
 </div>;
}
