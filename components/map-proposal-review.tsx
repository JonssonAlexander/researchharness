"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {isSubscriptionModel,type AtlasSnapshot,type Mindmap,type MindmapCapture,type MapFindings,type ProposalView} from "@/src/core";
import {MessageResponse} from "./ai-elements/message";
import {useBackdropDismiss} from "./backdrop-dismiss";
import {useServerEvent,useServerResync} from "./server-events";

const button="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50";
type Evidence=MapFindings["concepts"][number]["evidence"];
export function MapProposalDialog({map,capture,snapshot,onClose}:{map:Mindmap;capture:MindmapCapture;snapshot:AtlasSnapshot;onClose:()=>void}) {
	const [proposal,setProposal]=useState<ProposalView|null>(null),[model,setModel]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
	const [configError,setConfigError]=useState<string|null>(null);
	const [busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[page,setPage]=useState(0),[evidence,setEvidence]=useState<Evidence|null>(null);
	const root=useRef<HTMLDivElement>(null),abort=useRef<AbortController|null>(null),sequence=useRef(0);
	const refresh=useCallback(async()=>{
		const request=++sequence.current;
		try {
			const response=await fetch(`/api/atlas/proposals?revision=${capture.id}`,{cache:"no-store"}),value=await response.json();
			if(request!==sequence.current)return;
			if(!response.ok)throw new Error(value.error);
			setProposal(value);setLoaded(true);setError(null);
		}catch(error){if(request===sequence.current){setError((error as Error).message);setLoaded(true);}}
	},[capture.id]);
	useEffect(()=>{void refresh();void fetch("/api/atlas/proposals?config=1",{cache:"no-store"}).then(async r=>{
		const value=await r.json();if(r.ok)setModel(value.model);else setConfigError(value.error);
	}).catch(()=>setConfigError("Vision model configuration is unavailable."));return()=>{sequence.current++;abort.current?.abort();};},[refresh]);
	useServerEvent("atlas-changed",()=>void refresh());useServerResync(()=>void refresh());
	useEffect(()=>{
		const previous=document.activeElement as HTMLElement|null;root.current?.focus();
		return()=>previous?.focus();
	},[]);
	const close=()=>{abort.current?.abort();onClose();};
	const backdrop=useBackdropDismiss(close);
	async function generate() {
		if(!model||busy)return;
		setBusy(true);setError(null);abort.current=new AbortController();
		try {
			const response=await fetch("/api/atlas/proposals",{method:"POST",headers:{"content-type":"application/json"},signal:abort.current.signal,
				body:JSON.stringify({id:`mp_${crypto.randomUUID()}`,sourceRevision:capture.id,expectedModel:model,consent:true})});
			const value=await response.json();if(!response.ok)throw new Error(value.error);
			setProposal(value);await refresh();
		}catch(error){setError((error as Error).name==="AbortError"?"Interpretation cancelled; the saved source remains unchanged.":(error as Error).message);}
		finally{setBusy(false);abort.current=null;}
	}
	const focus=(source:Evidence)=>{setPage(source.page);setEvidence(source);};
	return createPortal(<div className="lh-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" {...backdrop}>
		<div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Review map interpretation"
			className="flex h-[min(90vh,60rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl outline-none"
			onKeyDown={event=>{
				if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();}
				if(event.key==="Tab"){
					const nodes=root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],select:not([disabled]),[tabindex="0"]');
					const first=nodes?.[0],last=nodes?.[nodes.length-1];
					if(event.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){event.preventDefault();last?.focus();}
					else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
				}
			}}>
			<header className="flex items-start justify-between gap-4 border-b px-5 py-4">
				<div><p className="text-xs text-muted-foreground">SOURCE REVIEW · REVISION {map.captures.findIndex(c=>c.id===capture.id)+1}</p>
					<h2 className="mt-1 text-lg font-medium">{map.title}</h2><p className="mt-1 text-xs text-muted-foreground">Suggestions stay separate from your knowledge graph.</p></div>
				<button type="button" className={button} onClick={close}>Close</button>
			</header>
			<ProposalReviewBody proposal={proposal} capture={capture} snapshot={snapshot} model={model} loaded={loaded} busy={busy} error={error??(!loaded||proposal?.status==="prepared"?null:configError)}
				page={page} evidence={evidence} onPage={p=>{setPage(p);setEvidence(null);}} onEvidence={focus} onGenerate={()=>void generate()} onCancel={()=>abort.current?.abort()} />
		</div>
	</div>,document.body);
}
export function ProposalReviewBody({proposal,capture,snapshot,model,loaded,busy,error,page,evidence,onPage,onEvidence,onGenerate,onCancel}:{
	proposal:ProposalView|null;capture:MindmapCapture;snapshot:AtlasSnapshot;model:string|null;loaded:boolean;busy:boolean;error:string|null;
	page:number;evidence:Evidence|null;onPage:(page:number)=>void;onEvidence:(source:Evidence)=>void;onGenerate:()=>void;onCancel:()=>void;
}) {
	const [zoom,setZoom]=useState(1),[broken,setBroken]=useState<string|null>(null),findings=proposal?.findings;
	const notSent=proposal&&(proposal.status==="failed"||proposal.status==="cancelled")&&!proposal.images.length&&!proposal.usage;
	const image=proposal?.images.length?`/api/atlas/proposals?id=${proposal.id}&page=${Math.min(page,proposal.images.length-1)}`:
		capture.previewHash?`/api/atlas/mindmaps?revision=${capture.id}&kind=preview`:null;
	return <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1.1fr)_minmax(22rem,1fr)] md:overflow-hidden">
		<section aria-label="Saved source drawing" className="flex min-h-64 flex-col border-b bg-muted/20 md:min-h-0 md:border-b-0 md:border-r">
			<div className="flex items-center justify-between gap-2 border-b px-4 py-3 text-xs"><span>{proposal?.images.length?"Captured interpretation pages":"Source overview"}</span>
				<div className="flex items-center gap-1">
				<button type="button" className={button} aria-label="Zoom out source" disabled={zoom===1} onClick={()=>setZoom(Math.max(1,zoom-0.5))}>−</button>
				<button type="button" className={button} onClick={()=>setZoom(1)}>Fit</button>
				<button type="button" className={button} aria-label="Zoom in source" disabled={zoom===3} onClick={()=>setZoom(Math.min(3,zoom+0.5))}>+</button>
				{proposal && proposal.images.length>1 && <select aria-label="Source page" className="rounded border bg-background px-2 py-1" value={page} onChange={e=>onPage(Number(e.target.value))}>
					{proposal.images.map((_,i)=><option key={i} value={i}>Page {i+1}</option>)}</select>}</div></div>
			<div className={`flex flex-1 items-start overflow-auto p-4 ${zoom===1?"justify-center":"justify-start"}`}>
				{image && broken!==image?<div className="relative inline-block shrink-0" style={{width:zoom>1?`${zoom*100}%`:undefined}}>
					{/* eslint-disable-next-line @next/next/no-img-element -- immutable local page; no external image request. */}
					<img src={image} alt={`Saved map drawing, page ${page+1}`} className="block max-w-full rounded bg-white" style={{maxHeight:zoom===1?"70vh":undefined,width:zoom>1?"100%":undefined}} onError={()=>setBroken(image)} />
					{evidence?.page===page&&evidence.region&&<div aria-hidden="true" className="pointer-events-none absolute rounded border-2 border-amber-500 bg-amber-300/20"
						style={{left:`${evidence.region.x*100}%`,top:`${evidence.region.y*100}%`,width:`${evidence.region.w*100}%`,height:`${evidence.region.h*100}%`}} />}
				</div>:<p className="py-12 text-sm text-muted-foreground">Source image unavailable. Restore its files before interpretation.</p>}
			</div>
		</section>
		<section aria-label="Interpretation proposal" className="space-y-4 overflow-y-auto p-5 text-sm">
			{error&&<p role="alert" className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive">{error}</p>}
			{proposal && <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span className="rounded-full border px-2 py-1">{proposal.status}</span>
				<span className="py-1">{proposal.model}</span><span className="py-1">{notSent?"Model not called":proposal.usage?`${proposal.usage.steps} recorded model call(s)`:"Usage not reported"}</span>
				{!notSent&&<span className="py-1">{isSubscriptionModel(proposal.model)?"Counts toward plan usage":proposal.estimatedCost===null?"API estimate unavailable":`Estimated $${proposal.estimatedCost.toFixed(4)}`}</span>}</div>}
			{proposal && proposal.baseRevision!==snapshot.layoutRevision && <p className="rounded-lg border border-amber-500/40 p-3 text-xs">Atlas changed since this proposal was captured. Keep it for review; any future approval must revalidate its references.</p>}
			{proposal?.error&&<p className="rounded-lg border p-3 text-xs">{proposal.error}</p>}
			{(!proposal||proposal.status==="failed"||proposal.status==="cancelled") && <div className="space-y-3 rounded-xl border p-4">
				<h3 className="font-medium">Interpret this saved revision</h3>
				<p className="text-xs leading-relaxed text-muted-foreground">Readable page images and names/aliases of up to 40 linked concepts will be sent to {model??"your configured vision model"}. Uses up to two model calls. Original files stay unchanged.</p>
				<button type="button" className={button} disabled={!loaded||!model||busy} onClick={onGenerate}>{busy?"Interpreting…":proposal?"Try interpretation again":"Interpret revision"}</button>
				{busy&&<button type="button" className={`${button} ml-2`} onClick={onCancel}>Cancel</button>}
				{proposal&&<p className="text-xs text-muted-foreground">Retry starts a new attempt and may use additional plan allowance or API credits.</p>}
			</div>}
			{(busy||proposal?.status==="running")&&<p role="status" className="animate-pulse text-xs text-muted-foreground">Reading saved pages and preparing source-backed suggestions…</p>}
			{findings&&<>
				<div><h3 className="font-medium">Concepts <span className="text-muted-foreground">{findings.concepts.length}</span></h3>
					<div className="mt-2 space-y-2">{findings.concepts.map(c=><article key={c.key} className="space-y-2 rounded-xl border p-3">
						<div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">{c.title}</h4><span className="text-[11px] text-muted-foreground">{c.existingId?`Possible match: ${proposal?.context.find(n=>n.id===c.existingId)?.title??c.title}`:"Identity to review"}</span></div>
						{c.notes&&<MessageResponse mode="static">{c.notes}</MessageResponse>}
						{c.uncertainty&&<p className="text-xs text-amber-600 dark:text-amber-300">Uncertain: {c.uncertainty}</p>}
						<button type="button" className="text-left text-xs text-muted-foreground underline underline-offset-4" onClick={()=>onEvidence(c.evidence)}>Page {c.evidence.page+1} · {c.evidence.quote}</button>
					</article>)}</div>
				</div>
				{findings.relations.length>0&&<div><h3 className="font-medium">Depicted connections</h3><div className="mt-2 space-y-2">{findings.relations.map((r,i)=><article key={i} className="space-y-2 rounded-xl border p-3">
					<p>{findings.concepts.find(c=>c.key===r.source)?.title} → {findings.concepts.find(c=>c.key===r.target)?.title}</p>
					<p className="text-xs text-muted-foreground">{r.type} · proposed association</p>{r.conditions&&<MessageResponse mode="static">{r.conditions}</MessageResponse>}
					{r.uncertainty&&<p className="text-xs text-amber-600 dark:text-amber-300">Uncertain: {r.uncertainty}</p>}
					<button type="button" className="text-left text-xs text-muted-foreground underline" onClick={()=>onEvidence(r.evidence)}>Page {r.evidence.page+1} · {r.evidence.quote}</button>
				</article>)}</div></div>}
				{findings.questions.length>0&&<div className="space-y-2 rounded-xl border border-amber-500/30 p-3"><h3 className="font-medium">Needs clarification</h3>{findings.questions.map((q,i)=><p key={i} className="text-xs leading-relaxed">{q}</p>)}</div>}
				{!findings.concepts.length&&!findings.relations.length&&<p className="text-muted-foreground">No safe concept or connection suggestions were found.</p>}
				<details className="rounded-xl border p-3"><summary className="cursor-pointer text-xs">Transcription</summary><div className="mt-3"><MessageResponse mode="static">{findings.transcription||"No readable text was transcribed."}</MessageResponse></div></details>
				<p className="border-t pt-3 text-xs text-muted-foreground">Review only. Approval and graph updates are the next step; these suggestions have not changed your knowledge.</p>
			</>}
			{(proposal?.attempts?.length??0)>1&&<details className="rounded-xl border p-3"><summary className="cursor-pointer text-xs">Attempt history</summary>
				{proposal!.attempts!.map(a=><p key={a.id} className="mt-2 text-xs text-muted-foreground">{a.status} · {a.model} · {a.calls===null?"usage unreported":`${a.calls} recorded call(s)`} {a.estimatedCost!==null?`· estimated $${a.estimatedCost.toFixed(4)}`:""}</p>)}</details>}
		</section>
	</div>;
}
