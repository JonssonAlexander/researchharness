"use client";
import {LessonScratchwork} from "./lesson-scratchwork";
import {useEffect,useMemo,useRef,useState} from "react";
import {conceptDerivation,derivationDiagram,sharedDerivationMap,layoutSharedDerivations,lessonMapTitle,propositionSessionHref,DEFAULT_RENDER_SETTINGS,type LessonArtifact,type AtlasConcept,type AtlasCommand,type GraphSnapshot,type LearningContext} from "@/src/core";
import {GraphCanvasRenderer,fitTransform} from "./graph-canvas";
import {graphMathLabel} from "./graph-math-label";
import {MessageResponse} from "./ai-elements/message";

const button="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50";
const field="w-full rounded-md border bg-background px-2 py-1.5 text-xs";
export function DerivationCanvas({scope,onSelect,focusIds,onClearFocus}:{scope:ReturnType<typeof conceptDerivation>;onSelect:(id:string)=>void;focusIds?:ReadonlySet<string>|null;onClearFocus?:()=>void}){
 const refit=useRef(()=>{}),canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<GraphCanvasRenderer|null>(null),select=useRef(onSelect);select.current=onSelect;
 const clear=useRef(onClearFocus);clear.current=onClearFocus;
 const [error,setError]=useState(""),[allPremises,setAllPremises]=useState(false);
 const compact=useMemo(()=>derivationDiagram(scope,{compact:true}),[scope]),folded=compact.folded?.reduce((sum,c)=>sum+c.premiseIds.length,0)??0;
 useEffect(()=>{
  if(!canvas.current)return;let graph:GraphCanvasRenderer|undefined,resize:ResizeObserver|undefined;
  try{
   const diagram=allPremises?derivationDiagram(scope):compact,logicalEdges=scope.chains.flatMap(c=>c.premises.map(from=>({from,to:c.conclusion}))),impLinks=scope.chains.filter(c=>c.premises.length>1).map(c=>({id:c.id,premises:c.premises,conclusion:c.conclusion}));
   const {positions,clusters}=layoutSharedDerivations(compact);
   const colors=new Map(clusters.flatMap(c=>c.members.map(id=>[id,c.color] as const))),petals=new Map(clusters.flatMap(c=>c.members.map(id=>[id,c.id] as const)));
   graph=new GraphCanvasRenderer(canvas.current,{onSelect:id=>select.current(id),onContext:()=>{},onStageClick:()=>clear.current?.(),onCameraMove:()=>{},onCommit:()=>{}});
   graph.setSettings({...DEFAULT_RENDER_SETTINGS,nodeSize:2.5,edgeWidth:.5,labelSize:12,labelZoom:8,arrowLength:3,clusterLabels:false,regions:{...DEFAULT_RENDER_SETTINGS.regions,dilation:36,blur:60,edgeAlpha:.17}});
   graph.setData({labelWidth:140,nodes:diagram.nodes.map(n=>({id:n.id,label:scope.propositions.some(p=>p.id===n.id)?lessonMapTitle(n.name):"",...positions.get(n.id)!,fixed:true,color:colors.get(n.id),htmlLabel:scope.propositions.some(p=>p.id===n.id)?graphMathLabel(lessonMapTitle(n.name)):undefined})),edges:diagram.edges.map(e=>({...e,quiet:!allPremises&&petals.get(e.from)!==petals.get(e.to)})),logicalEdges,impLinks,clusters,colors:{node:"#65a3dc",edge:"#808590",label:"#999fa9",hoverText:"#dce4f0"},fontFamily:getComputedStyle(document.body).fontFamily});
   renderer.current=graph;
   refit.current=()=>{const el=canvas.current,points=[...positions.values()];if(!el||!points.length||el.clientWidth<24||el.clientHeight<24)return;const bounds={minX:Math.min(...points.map(p=>p.x))-85,maxX:Math.max(...points.map(p=>p.x))+85,minY:Math.min(...points.map(p=>p.y))-24,maxY:Math.max(...points.map(p=>p.y))+90},camera=fitTransform(bounds,el.clientWidth,el.clientHeight,24);graph?.restoreViewCamera({x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2,k:Math.min(1,camera.k)});};
   refit.current();if(typeof ResizeObserver!=="undefined"){resize=new ResizeObserver(()=>refit.current());resize.observe(canvas.current!);}
  }catch{graph?.destroy();setError("Graph unavailable. The complete claim and argument lists remain below.");}
  return()=>{resize?.disconnect();graph?.destroy();renderer.current=null;refit.current=()=>{};};
 },[scope,allPremises,compact]);
 useEffect(()=>{renderer.current?.setHighlighted(focusIds??null,{subtle:true});},[focusIds,scope,allPremises,compact]);
 return <div className="relative min-h-72 min-w-0 flex-1 overflow-hidden"><canvas ref={canvas} aria-label="Recorded derivation graph; select a claim" className="absolute inset-0 h-full w-full"/><button type="button" className={`${button} absolute left-3 top-3 bg-background`} onClick={()=>refit.current()}>Fit map</button>{focusIds&&onClearFocus&&<button type="button" className={`${button} absolute right-3 top-3 bg-background`} onClick={onClearFocus}>Show all</button>}{folded>0&&<button type="button" title="Full joint premise sets stay in the step panel. This only folds repeated links in the overview." className={`${button} absolute bottom-3 left-3 bg-background`} onClick={()=>setAllPremises(!allPremises)}>{allPremises?"Compact premise links":`All premise links · ${folded} folded`}</button>}{error&&<p role="status" className="absolute bottom-2 left-3 bg-background p-2 text-xs">{error}</p>}</div>;
}

export function ConceptDerivations({concept,graph,save,onClose,onLearn,lessonMaps,onOpenLesson}:{concept:AtlasConcept;graph:GraphSnapshot;lessonMaps?:LessonArtifact[];onOpenLesson?:(id:string,chatId:string,key:string)=>void;save:(command:AtlasCommand)=>Promise<void>;onClose:()=>void;onLearn?:(context:LearningContext,prompt:string)=>void}){
 const [focused,setFocused]=useState(false),[selectedId,setSelectedId]=useState(""),[argumentId,setArgumentId]=useState(""),[query,setQuery]=useState(""),[candidate,setCandidate]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const linked=useMemo(()=>graph.propositions.filter(n=>concept.propositionIds.includes(n.id)),[graph.propositions,concept.propositionIds]);
 const scope=useMemo(()=>sharedDerivationMap(graph.propositions,graph.chains,concept.propositionIds),[graph.propositions,graph.chains,concept.propositionIds]);
 const selected=scope.propositions.find(n=>n.id===selectedId)??linked[0];
 const slices=useMemo(()=>new Map(linked.map(n=>[n.id,conceptDerivation(graph.propositions,graph.chains,[n.id])])),[graph.propositions,graph.chains,linked]);
 const root=linked.find(n=>slices.get(n.id)?.propositions.some(p=>p.id===selected?.id));
 const focusIds=useMemo(()=>{if(!focused)return null;const slice=conceptDerivation(scope.propositions,scope.chains,selectedId?[selectedId]:concept.propositionIds);return new Set([...slice.propositions.map(n=>n.id),...slice.chains.map(c=>c.id)]);},[focused,scope,selectedId,concept.propositionIds]);
 function choose(id:string){setSelectedId(id);setArgumentId("");setFocused(true);}
 const arguments_=scope.chains.filter(c=>c.conclusion===selected?.id),argument=arguments_.find(c=>c.id===argumentId)??arguments_[0];
 const byId=new Map(graph.propositions.map(n=>[n.id,n]));
 const candidates=graph.propositions.filter(n=>!concept.propositionIds.includes(n.id)&&(!query.trim()||`${n.name} ${n.statement} ${n.aliases.join(" ")}`.toLowerCase().includes(query.toLowerCase().trim()))).slice(0,100);
 async function link(){
  if(!candidate||busy)return;setBusy(true);setError("");
  try{await save({kind:"concept",id:concept.id,expectedRevision:concept.revision,title:concept.title,aliases:concept.aliases,subjectIds:concept.subjectIds,preferredSubjectId:concept.preferredSubjectId,propositionIds:[...concept.propositionIds,candidate]});setSelectedId(candidate);setFocused(true);setArgumentId("");setCandidate("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function learn(){
  if(!selected||!root)return;
  onLearn?.({conceptIds:[concept.id],goal:"derive",derivation:{rootId:root.id,targetId:selected.id,...argument?{chainId:argument.id}:{}}},`Help me reconstruct this precise result about ${concept.title}: ${selected.statement}. ${argument?"Work through the selected recorded argument, using all its premises jointly.":"No argument is recorded for this claim in the selected derivation; help me establish the assumptions and develop an argument."} Ask what I can derive independently first. Retain hints, gaps and source uncertainty; a stored dependency is not a proof certificate.`);
 }
 const sources=(items:{chatId:string;messageId:string}[])=>[...new Map(items.map(s=>[`${s.chatId}:${s.messageId}`,s])).values()].map(s=><p key={`${s.chatId}:${s.messageId}`} className="text-xs">{graph.sessions[s.chatId]?<a className="underline" href={propositionSessionHref({provenance:[s]},s.chatId)}>{graph.sessions[s.chatId]}</a>:graph.fileSources[s.chatId]??"Source unavailable"}</p>);
 return <section role="dialog" aria-label={`Derivations for ${concept.title}`} className="absolute inset-0 z-50 flex flex-col bg-background">
  <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4"><div><p className="text-xs text-muted-foreground">SHARED DERIVATION MAP</p><h2 className="text-lg font-medium"><MessageResponse mode="static">{concept.title}</MessageResponse></h2></div><button type="button" className={button} onClick={onClose}>Back to Atlas</button></header>
  <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_24rem] md:overflow-hidden">
   <div className="flex min-h-80 flex-col border-b md:border-b-0 md:border-r"><div className="border-b p-3 text-xs text-muted-foreground">Shared claims appear once. Select a result to follow its argument; click the background to explore the whole map.</div>
    {linked.length?<DerivationCanvas scope={scope} focusIds={focusIds} onClearFocus={()=>setFocused(false)} onSelect={choose}/>:<div className="space-y-3 p-6 text-sm"><p>No canonical claims are linked to this concept yet.</p><p className="text-muted-foreground">Imported concept notes and ordinary map lines stay conceptual. Link an existing claim using the panel, or start a derivation lesson.</p>{onLearn&&<button type="button" className={button} onClick={()=>onLearn({conceptIds:[concept.id],goal:"derive"},`Help me formulate a precise result about ${concept.title} and work toward a derivation. First establish assumptions and what I can explain independently. Distinguish proposed claims from established arguments; retain hints and gaps.`)}>Start a derivation lesson</button>}</div>}
    <p className="border-t p-3 text-xs text-muted-foreground">{scope.propositions.length} shared claims · {scope.chains.length} recorded arguments · source assertions, not verified proofs</p>
   </div>
   <aside className="space-y-4 overflow-y-auto p-5 text-sm">
    {!!linked.length&&<details><summary className="cursor-pointer text-xs font-medium">Results linked to this concept</summary>{linked.map(n=><button key={n.id} type="button" className={`${button} mt-1 block w-full text-left`} onClick={()=>choose(n.id)}>{n.name}</button>)}</details>}
    {!!lessonMaps?.length&&<details><summary className="cursor-pointer text-xs font-medium">Source lessons & proof notes</summary>{lessonMaps.flatMap(map=>map.derivations.filter(d=>d.conceptIds.includes(concept.id)).map(d=><button type="button" key={`${map.id}:${d.key}`} className={`${button} block w-full text-left`} onClick={()=>onOpenLesson?.(map.id,map.chatId,d.key)}>{d.title} · full argument{d.gaps.length?" · gaps remain":d.reviewFlags?.length?" · review markers":""}</button>))}</details>}
    {scope.truncated&&<p className="text-xs text-amber-600">This view reached its 150-claim / 80-argument limit. Some complete arguments are omitted; no joint premise set is split.</p>}
    {concept.propositionIds.some(id=>!byId.has(id))&&<p className="text-xs text-amber-600">Some linked claims are unavailable. Their references are retained; no replacements were guessed.</p>}
    {selected&&<article className="space-y-3"><h3 className="font-medium"><MessageResponse mode="static">{selected.name}</MessageResponse></h3><MessageResponse mode="static">{selected.statement}</MessageResponse>
     {!!arguments_.length&&<label className="block text-xs">Recorded argument<select className={field} value={argument!.id} onChange={e=>setArgumentId(e.target.value)}>{arguments_.map((c,i)=><option key={c.id} value={c.id}>Argument {i+1} · {c.premises.length} joint premise(s)</option>)}</select></label>}
     {argument?<><h4 className="text-xs font-medium">Joint premises · all used together</h4>{argument.premises.map(id=><div key={id} className="space-y-1 border-l-2 pl-3"><button type="button" className="text-left text-xs underline" onClick={()=>choose(id)}><MessageResponse mode="static">{byId.get(id)!.name}</MessageResponse></button><MessageResponse mode="static">{byId.get(id)!.statement}</MessageResponse></div>)}<p className="text-xs text-muted-foreground">The ledger records this joint inference. Consult its source for the argument and any unstated conditions; this view does not verify it.</p>{sources(argument.provenance)}</>:<p className="text-xs text-muted-foreground">No argument is recorded for this claim in this slice. It may be a starting assumption or an incomplete record.</p>}
     <LessonScratchwork maps={lessonMaps??[]} propositionId={selected.id}/>
     {!!selected.provenance.length&&<details><summary className="cursor-pointer text-xs">Claim sources</summary>{sources(selected.provenance)}</details>}
     {onLearn&&root&&<button type="button" className={button} onClick={learn}>{argument?"Learn this step":"Learn this claim"}</button>}
    </article>}
    {!!scope.propositions.length&&<details><summary className="cursor-pointer text-xs font-medium">Claims in this map</summary><div className="mt-2 space-y-1">{scope.propositions.map(n=><button key={n.id} type="button" aria-pressed={selected?.id===n.id} className={`${button} block w-full text-left aria-pressed:bg-accent`} onClick={()=>choose(n.id)}><MessageResponse mode="static">{n.name}</MessageResponse></button>)}</div></details>}
    <details open={!linked.length} className="space-y-2 rounded-lg border p-3"><summary className="cursor-pointer text-xs font-medium">Link an existing claim</summary><p className="text-xs text-muted-foreground">Choose the precise statement to associate with this concept. This adds a reference; it does not rename, merge or certify the claim.</p><input aria-label="Search existing claims" placeholder="Search claims…" className={field} value={query} onChange={e=>{setQuery(e.target.value);setCandidate("");}}/><select aria-label="Existing claim" className={field} value={candidate} onChange={e=>setCandidate(e.target.value)}><option value="">Choose a claim…</option>{candidates.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select>{candidate&&<MessageResponse mode="static">{byId.get(candidate)?.statement??"Claim unavailable"}</MessageResponse>}<button type="button" disabled={busy||!candidate||concept.propositionIds.length>=200} className={button} onClick={()=>void link()}>{busy?"Linking…":"Link claim to concept"}</button>{!graph.propositions.length&&<p className="text-xs text-muted-foreground">The canonical claim library is empty. No claims have been inferred from your concept labels.</p>}</details>
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
   </aside>
  </div>
 </section>;
}
