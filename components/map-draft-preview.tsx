"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {DEFAULT_RENDER_SETTINGS,isSubscriptionModel,DRAFT_ORIGINS,projectMapDraft,mapImageLabel,type MapEvidence,type ProposalView,type MapDraft,type MapReview,type MapIntegration,type AtlasSnapshot,projectAtlas,mapReviewReasons} from "@/src/core";
import {graphMathLabel} from "./graph-math-label";
import {DraftItemEditor,DraftAdd,DraftIntegration,reviewRequest} from "./map-draft-editor";
import {GraphCanvasRenderer} from "./graph-canvas";
import {MessageResponse} from "./ai-elements/message";

const button="rounded-md border px-3 py-1.5 text-xs hover:bg-accent";
type Selection={kind:"concept"|"connection";key:string}|null;
export function MapDraftPreview({proposal,onEvidence,onDirtyChange}:{proposal:ProposalView;onEvidence:(e:MapEvidence)=>void;onDirtyChange?:(dirty:boolean)=>void}) {
	const [draft,setDraft]=useState<MapDraft>(proposal.draft!),[review,setReview]=useState<MapReview|null>(null),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(""),[atlas,setAtlas]=useState<AtlasSnapshot|null>(null),[plan,setPlan]=useState<MapIntegration|null>(null),[inAtlas,setInAtlas]=useState(false),[integrating,setIntegrating]=useState(false);
	const currentDraft=useRef(draft);currentDraft.current=draft;
	const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<GraphCanvasRenderer|null>(null);
	const [selected,setSelected]=useState<Selection>(null),[error,setError]=useState<string|null>(null);
	useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
	const positions=useRef(new Map<string,{x:number;y:number}>());
	const projection=useMemo(()=>{
		const p=projectMapDraft(draft,proposal.imageLayout);
		for(const n of p.nodes){const old=positions.current.get(n.id);if(old){n.x=old.x;n.y=old.y;}Object.assign(n,{badgeColor:mapReviewReasons(draft.concepts.find(c=>c.key===n.id)!).length?"#e6b35a":undefined,htmlLabel:typeof document!=="undefined"?graphMathLabel(n.label):undefined});}
		if(inAtlas&&plan&&atlas){const base=projectAtlas(atlas);
			return {nodes:[...base.nodes.map(n=>({...n,draggable:false,htmlLabel:graphMathLabel(n.label)})),...p.nodes.filter(n=>{const c=plan.concepts.find(c=>c.key===n.id);return c&&!c.existing;}).map(n=>{const c=plan.concepts.find(c=>c.key===n.id)!;return {...n,id:c.id,x:c.x,y:c.y,draggable:false};})],edges:[],semanticEdges:[...base.semanticEdges,...plan.relations.map(r=>({from:r.sourceId,to:r.targetId}))]};
		}
		return p;
	},[draft,proposal.imageLayout,inAtlas,plan,atlas]);
	useEffect(()=>{let active=true;void fetch(`/api/atlas/map-review?id=${proposal.id}`,{cache:"no-store"}).then(async r=>{const v=await r.json();if(!r.ok)throw new Error(v.error);if(active){setReview(v);setDraft(v.draft);}}).catch(e=>{if(active)setSaveError((e as Error).message);});return()=>{active=false;};},[proposal.id]);
	function edit(value:MapDraft){setDraft(value);setDirty(true);setPlan(null);setInAtlas(false);setIntegrating(false);}
	async function save(){const captured=draft;setSaving(true);setSaveError("");try{const value=await reviewRequest({action:"save",proposalId:proposal.id,expectedRevision:review!.revision,draft});setReview(value);if(currentDraft.current===captured){setDraft(value.draft);setDirty(false);}}catch(e){setSaveError((e as Error).message);}finally{setSaving(false);}}
	async function integrate(){setSaveError("");try{const r=await fetch("/api/atlas",{cache:"no-store"}),value=await r.json();if(!r.ok)throw new Error(value.error);setAtlas(value);setIntegrating(true);}catch(e){setSaveError((e as Error).message);}}
	const prepared=useCallback((p:MapIntegration|null)=>{setPlan(p);if(!p)setInAtlas(false);},[]);
	useEffect(()=>{
		const el=canvas.current;if(!el)return;
		let graph:GraphCanvasRenderer|undefined;
		try {
			graph=new GraphCanvasRenderer(el,{onSelect:id=>setSelected({kind:"concept",key:plan?.concepts.find(n=>n.id===id)?.key??id}),onContext:()=>{},onStageClick:()=>setSelected(null),onCameraMove:()=>{},onCommit:p=>{for(const [id,v] of Object.entries(p))positions.current.set(id,v);}});
			graph.setSettings({...DEFAULT_RENDER_SETTINGS,nodeSize:4,labelSize:12,labelZoom:2,arrowLength:5,clusterLabels:false});
			const dark=getComputedStyle(document.body).color;
			// Resolve CSS/OKLCH to the renderer's hex channel without changing its theme API.
			const swatch=document.createElement("canvas").getContext("2d")!;swatch.fillStyle=dark;swatch.fillRect(0,0,1,1);
			const rgb=swatch.getImageData(0,0,1,1).data,label=`#${[...rgb].slice(0,3).map(c=>c.toString(16).padStart(2,"0")).join("")}`;
			for(const n of projection.nodes)positions.current.set(n.id,n);
			graph.setData({...projection,clusters:[],logicalEdges:[],colors:{node:"#65a3dc",edge:"#808590",label,hoverText:label},fontFamily:getComputedStyle(document.body).fontFamily});
			renderer.current=graph;setError(null);
		}catch{graph?.destroy();graph=undefined;setError("Interactive map unavailable. The draft remains reviewable through the lists below.");}
		return()=>{graph?.destroy();renderer.current=null;};
	},[projection]);
	const concept=selected?.kind==="concept"?draft.concepts.find(n=>n.key===selected.key):null;
	const connection=selected?.kind==="connection"?draft.connections.find(e=>e.key===selected.key):null;
	const title=(id:string)=>draft.concepts.find(n=>n.key===id)?.title??id;
	const evidence=(items:MapEvidence[])=>items.map((e,i)=><button key={i} type="button" className="block text-left text-xs text-muted-foreground underline underline-offset-4" onClick={()=>onEvidence(e)}>{mapImageLabel(proposal.imageLayout?.[e.page],e.page)} · {e.quote}</button>);
	const support=(item:{origin:keyof typeof DRAFT_ORIGINS;evidence:MapEvidence[];rationale:string;assumptions:string;uncertainty:string})=><>
		<span className="inline-block rounded-full border px-2 py-1 text-[11px]" style={{color:DRAFT_ORIGINS[item.origin].color}}>{DRAFT_ORIGINS[item.origin].label}</span>
		{item.rationale&&<div className="text-xs leading-relaxed"><span className="text-muted-foreground">Reasoning: </span><MessageResponse mode="static">{item.rationale}</MessageResponse></div>}
		{item.assumptions&&<div className="text-xs leading-relaxed"><span className="text-muted-foreground">Assumptions: </span><MessageResponse mode="static">{item.assumptions}</MessageResponse></div>}
		{item.uncertainty&&<div className="text-xs leading-relaxed text-amber-600 dark:text-amber-300">Unresolved: <MessageResponse mode="static">{item.uncertainty}</MessageResponse></div>}
		{evidence(item.evidence)}
	</>;
	return <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_22rem] md:overflow-hidden">
		<section aria-label="Isolated proposed mind map" className="relative flex min-h-80 flex-col border-b md:min-h-0 md:border-b-0 md:border-r">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-xs">
				<div><p className="font-medium">{inAtlas?"In Atlas · integration preview":"This map only · proposed"}</p><p className="mt-1 text-muted-foreground">{draft.concepts.length} concepts · {draft.connections.length} connections · no Atlas changes</p></div>
				<div className="flex flex-wrap gap-1"><button type="button" className={button} onClick={()=>renderer.current?.fit()}>Fit map</button>{plan&&<button type="button" className={button} onClick={()=>setInAtlas(!inAtlas)}>{inAtlas?"This map only":"In Atlas"}</button>}
				<button type="button" className={button} disabled={!dirty||saving||!review||!!review.integration} onClick={()=>void save()}>{saving?"Saving…":dirty?"Save draft edits":"Draft saved"}</button>
				<button type="button" className={button} disabled={dirty||saving||integrating||!review||!!review.integration} onClick={()=>void integrate()}>{review?.integration?"Integrated":"Integrate…"}</button></div>
			</div>
			{error&&<p role="status" className="p-3 text-xs text-muted-foreground">{error}</p>}
			<div className="relative min-h-72 flex-1"><canvas ref={canvas} aria-label="Proposed mind map; select a concept to inspect its notes" className="absolute inset-0 h-full w-full" /></div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-3 text-[11px] text-muted-foreground">{Object.values(DRAFT_ORIGINS).map(o=><span key={o.label}><span style={{color:o.color}}>●</span> {o.label}</span>)}<span>Dashed line: direction unclear · amber dot: unresolved, thin notes or unverified additions</span></div>
		</section>
		<aside aria-label="Draft notes and connections" className="space-y-4 overflow-y-auto p-5 text-sm">
			<p className="break-words text-[11px] text-muted-foreground">Second pass · {proposal.model} · {proposal.usage?`${proposal.usage.steps} recorded model call(s)`:"Usage not reported"}<br/>{isSubscriptionModel(proposal.model)?"Counts toward plan usage":proposal.estimatedCost===null?"API estimate unavailable":`Estimated $${proposal.estimatedCost.toFixed(4)}`}</p>
			{saveError&&<p role="alert" className="text-xs text-destructive">{saveError}</p>}
			{dirty&&<p className="text-xs text-amber-600">Unsaved draft edits · save before integration or leaving this view.</p>}
			{integrating&&review&&atlas&&<DraftIntegration key={`${review.revision}:${atlas.layoutRevision}`} review={review} atlas={atlas} onPrepared={prepared} onCancel={()=>{setIntegrating(false);setPlan(null);setInAtlas(false);}} onCommitted={()=>{setReview({...review,integration:{id:plan!.id,committedAt:new Date().toISOString()}});setIntegrating(false);setPlan(null);setInAtlas(false);}}/>}
			<button type="button" className={button} onClick={()=>setSelected(null)}>Draft overview</button>
			{concept?<article className="space-y-3"><h3 className="text-lg font-medium"><MessageResponse mode="static">{concept.title}</MessageResponse></h3>{support(concept)}
				{concept.existingId&&<p className="text-xs text-muted-foreground">Possible existing match: {proposal.context.find(n=>n.id===concept.existingId)?.title??concept.title}. Identity still needs review.</p>}
				{mapReviewReasons(concept).length>0&&<ul className="list-disc pl-4 text-xs text-amber-600">{mapReviewReasons(concept).map(r=><li key={r}>{r}</li>)}</ul>}
				{concept.notes.map((n,i)=><section key={i} className="space-y-2 rounded-xl border p-3">{support(n)}<MessageResponse mode="static">{n.text}</MessageResponse></section>)}
			</article>:connection?<article className="space-y-3"><h3 className="font-medium">{title(connection.source)} {connection.direction==="both"?"↔":connection.direction==="forward"?"→":"—"} {title(connection.target)}</h3>
				<MessageResponse mode="static">{connection.label||"Unlabelled connection"}</MessageResponse><p className="text-xs text-muted-foreground">{connection.relationType??"No mathematical type assigned"} · proposed, not a proven implication</p>{support(connection)}
			</article>:<section className="space-y-3"><h3 className="font-medium">Draft overview · model synthesis</h3><MessageResponse mode="static">{draft.overview||"No overview was proposed."}</MessageResponse>
				{draft.questions.length>0&&<div className="space-y-2 rounded-xl border border-amber-500/40 p-3"><h4 className="font-medium">Needs review</h4>{draft.questions.map((q,i)=><p key={i} className="text-xs leading-relaxed">{q}</p>)}</div>}
				<p className="text-xs text-muted-foreground">Review the structure first. Select a concept or connection for its notes and evidence. Reconstructions and explanations are model proposals, not verified mathematics.</p>
			</section>}
			{selected&&(concept||connection)&&review&&!review.integration&&!integrating&&<DraftItemEditor draft={draft} selection={selected} onChange={edit}/>}
			{review&&!review.integration&&!integrating&&<DraftAdd draft={draft} onChange={edit}/>}
			<details open={!selected}><summary className="cursor-pointer text-xs font-medium">Concepts</summary><div className="mt-2 flex flex-wrap gap-1">{draft.concepts.map(n=><button key={n.key} type="button" aria-pressed={concept?.key===n.key} className={`${button} aria-pressed:bg-accent`} onClick={()=>setSelected({kind:"concept",key:n.key})}><MessageResponse mode="static">{n.title}</MessageResponse></button>)}</div></details>
			<details open={!!concept}><summary className="cursor-pointer text-xs font-medium">Connections</summary><div className="mt-2 space-y-1">{draft.connections.filter(e=>!concept||e.source===concept.key||e.target===concept.key).map(e=><button key={e.key} type="button" className={`${button} block w-full text-left`} onClick={()=>setSelected({kind:"connection",key:e.key})}>{title(e.source)} {e.direction==="both"?"↔":e.direction==="forward"?"→":"—"} {title(e.target)}</button>)}</div></details>
			<p className="border-t pt-3 text-xs text-muted-foreground">Your edits are saved separately from model output. Integration preserves existing notes and source provenance. Dragging here changes this view only.</p>
		</aside>
	</div>;
}
