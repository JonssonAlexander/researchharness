"use client";

import {useEffect,useRef,useState} from "react";
import {DEFAULT_RENDER_SETTINGS,isSubscriptionModel,DRAFT_ORIGINS,projectMapDraft,mapImageLabel,type MapEvidence,type ProposalView} from "@/src/core";
import {GraphCanvasRenderer} from "./graph-canvas";
import {MessageResponse} from "./ai-elements/message";

const button="rounded-md border px-3 py-1.5 text-xs hover:bg-accent";
type Selection={kind:"concept"|"connection";key:string}|null;
export function MapDraftPreview({proposal,onEvidence}:{proposal:ProposalView;onEvidence:(e:MapEvidence)=>void}) {
	const draft=proposal.draft!,canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<GraphCanvasRenderer|null>(null);
	const [selected,setSelected]=useState<Selection>(null),[error,setError]=useState<string|null>(null);
	// Prepared records are immutable; the parent keys this component by attempt ID.
	const [projection]=useState(()=>projectMapDraft(draft,proposal.imageLayout));
	useEffect(()=>{
		const el=canvas.current;if(!el)return;
		let graph:GraphCanvasRenderer|undefined;
		try {
			graph=new GraphCanvasRenderer(el,{onSelect:id=>setSelected({kind:"concept",key:id}),onContext:()=>{},onStageClick:()=>setSelected(null),onCameraMove:()=>{},onCommit:()=>{}});
			graph.setSettings({...DEFAULT_RENDER_SETTINGS,nodeSize:4,labelSize:12,labelZoom:2,arrowLength:5,clusterLabels:false});
			const dark=getComputedStyle(document.body).color;
			// Resolve CSS/OKLCH to the renderer's hex channel without changing its theme API.
			const swatch=document.createElement("canvas").getContext("2d")!;swatch.fillStyle=dark;swatch.fillRect(0,0,1,1);
			const rgb=swatch.getImageData(0,0,1,1).data,label=`#${[...rgb].slice(0,3).map(c=>c.toString(16).padStart(2,"0")).join("")}`;
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
		{item.rationale&&<p className="text-xs leading-relaxed"><span className="text-muted-foreground">Reasoning: </span>{item.rationale}</p>}
		{item.assumptions&&<p className="text-xs leading-relaxed"><span className="text-muted-foreground">Assumptions: </span>{item.assumptions}</p>}
		{item.uncertainty&&<p className="text-xs leading-relaxed text-amber-600 dark:text-amber-300">Unresolved: {item.uncertainty}</p>}
		{evidence(item.evidence)}
	</>;
	return <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_22rem] md:overflow-hidden">
		<section aria-label="Isolated proposed mind map" className="relative flex min-h-80 flex-col border-b md:min-h-0 md:border-b-0 md:border-r">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-xs">
				<div><p className="font-medium">This map only · proposed</p><p className="mt-1 text-muted-foreground">{draft.concepts.length} concepts · {draft.connections.length} connections · no Atlas changes</p></div>
				<button type="button" className={button} onClick={()=>renderer.current?.fit()}>Fit map</button>
			</div>
			{error&&<p role="status" className="p-3 text-xs text-muted-foreground">{error}</p>}
			<div className="relative min-h-72 flex-1"><canvas ref={canvas} aria-label="Proposed mind map; select a concept to inspect its notes" className="absolute inset-0 h-full w-full" /></div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-3 text-[11px] text-muted-foreground">{Object.values(DRAFT_ORIGINS).map(o=><span key={o.label}><span style={{color:o.color}}>●</span> {o.label}</span>)}<span>Dashed line: direction unclear</span></div>
		</section>
		<aside aria-label="Draft notes and connections" className="space-y-4 overflow-y-auto p-5 text-sm">
			<p className="break-words text-[11px] text-muted-foreground">Second pass · {proposal.model} · {proposal.usage?`${proposal.usage.steps} recorded model call(s)`:"Usage not reported"}<br/>{isSubscriptionModel(proposal.model)?"Counts toward plan usage":proposal.estimatedCost===null?"API estimate unavailable":`Estimated $${proposal.estimatedCost.toFixed(4)}`}</p>
			<button type="button" className={button} onClick={()=>setSelected(null)}>Draft overview</button>
			{concept?<article className="space-y-3"><h3 className="text-lg font-medium">{concept.title}</h3>{support(concept)}
				{concept.existingId&&<p className="text-xs text-muted-foreground">Possible existing match: {proposal.context.find(n=>n.id===concept.existingId)?.title??concept.title}. Identity still needs review.</p>}
				{concept.notes.map((n,i)=><section key={i} className="space-y-2 rounded-xl border p-3">{support(n)}<MessageResponse mode="static">{n.text}</MessageResponse></section>)}
			</article>:connection?<article className="space-y-3"><h3 className="font-medium">{title(connection.source)} {connection.direction==="both"?"↔":connection.direction==="forward"?"→":"—"} {title(connection.target)}</h3>
				<p>{connection.label||"Unlabelled connection"}</p><p className="text-xs text-muted-foreground">{connection.relationType??"No mathematical type assigned"} · proposed, not a proven implication</p>{support(connection)}
			</article>:<section className="space-y-3"><h3 className="font-medium">Draft overview · model synthesis</h3><MessageResponse mode="static">{draft.overview||"No overview was proposed."}</MessageResponse>
				{draft.questions.length>0&&<div className="space-y-2 rounded-xl border border-amber-500/40 p-3"><h4 className="font-medium">Needs review</h4>{draft.questions.map((q,i)=><p key={i} className="text-xs leading-relaxed">{q}</p>)}</div>}
				<p className="text-xs text-muted-foreground">Review the structure first. Select a concept or connection for its notes and evidence. Reconstructions and explanations are model proposals, not verified mathematics.</p>
			</section>}
			<details open={!selected}><summary className="cursor-pointer text-xs font-medium">Concepts</summary><div className="mt-2 flex flex-wrap gap-1">{draft.concepts.map(n=><button key={n.key} type="button" aria-pressed={concept?.key===n.key} className={`${button} aria-pressed:bg-accent`} onClick={()=>setSelected({kind:"concept",key:n.key})}>{n.title}</button>)}</div></details>
			<details open={!!concept}><summary className="cursor-pointer text-xs font-medium">Connections</summary><div className="mt-2 space-y-1">{draft.connections.filter(e=>!concept||e.source===concept.key||e.target===concept.key).map(e=><button key={e.key} type="button" className={`${button} block w-full text-left`} onClick={()=>setSelected({kind:"connection",key:e.key})}>{title(e.source)} {e.direction==="both"?"↔":e.direction==="forward"?"→":"—"} {title(e.target)}</button>)}</div></details>
			<p className="border-t pt-3 text-xs text-muted-foreground">Review only. Atlas comparison, editing, approval and applying changes come next. Dragging here changes this temporary view only.</p>
		</aside>
	</div>;
}
