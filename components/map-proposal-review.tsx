"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {isSubscriptionModel,mapImageLabel,type AtlasSnapshot,type Mindmap,type MindmapCapture,type MapFindings,type ProposalView} from "@/src/core";
import {MessageResponse} from "./ai-elements/message";
import {useBackdropDismiss} from "./backdrop-dismiss";
import {useServerEvent,useServerResync} from "./server-events";
import {MapDraftPreview} from "./map-draft-preview";

const button="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50";
type Evidence=MapFindings["concepts"][number]["evidence"];
export function MapProposalDialog({map,capture,snapshot,onClose}:{map:Mindmap;capture:MindmapCapture;snapshot:AtlasSnapshot;onClose:()=>void}) {
	const [proposal,setProposal]=useState<ProposalView|null>(null),[model,setModel]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
	const [configError,setConfigError]=useState<string|null>(null);
	const [attempt,setAttempt]=useState<string|null>(null);
	const [view,setView]=useState<"source"|"map">("source");
	const [busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[page,setPage]=useState(0),[evidence,setEvidence]=useState<Evidence|null>(null);
	const root=useRef<HTMLDivElement>(null),abort=useRef<AbortController|null>(null),sequence=useRef(0);
	const refresh=useCallback(async()=>{
		const request=++sequence.current;
		try {
			const response=await fetch(`/api/atlas/proposals?revision=${capture.id}${attempt?`&id=${attempt}`:""}`,{cache:"no-store"}),value=await response.json();
			if(request!==sequence.current)return;
			if(!response.ok)throw new Error(value.error);
			setProposal(value);setLoaded(true);setError(null);
		}catch(error){if(request===sequence.current){setError((error as Error).message);setLoaded(true);}}
	},[capture.id,attempt]);
	useEffect(()=>{void refresh();void fetch("/api/atlas/proposals?config=1",{cache:"no-store"}).then(async r=>{
		const value=await r.json();if(r.ok)setModel(value.model);else setConfigError(value.error);
	}).catch(()=>setConfigError("Vision model configuration is unavailable."));return()=>{sequence.current++;abort.current?.abort();};},[refresh]);
	useServerEvent("atlas-changed",()=>void refresh());useServerResync(()=>void refresh());
	useEffect(()=>{setPage(0);setEvidence(null);},[proposal?.id]);
	const hasDraft=!!proposal?.draft;
	useEffect(()=>{setView(hasDraft?"map":"source");},[proposal?.id,hasDraft]);
	useEffect(()=>{
		const previous=document.activeElement as HTMLElement|null;root.current?.focus();
		return()=>previous?.focus();
	},[]);
	const close=()=>{abort.current?.abort();onClose();};
	const backdrop=useBackdropDismiss(close);
	async function generate(parentId?:string) {
		if(!model||busy)return;
		setBusy(true);setError(null);abort.current=new AbortController();
		try {
			const response=await fetch("/api/atlas/proposals",{method:"POST",headers:{"content-type":"application/json"},signal:abort.current.signal,
				body:JSON.stringify({id:`mp_${crypto.randomUUID()}`,sourceRevision:capture.id,expectedModel:model,consent:true,reprocess:true,...(parentId?{parentId}:{})})});
			const value=await response.json();if(!response.ok)throw new Error(value.error);
			setAttempt(null);setPage(0);setEvidence(null);setProposal(value);if(!attempt)await refresh();
		}catch(error){setError((error as Error).name==="AbortError"?"Interpretation cancelled; the saved source remains unchanged.":(error as Error).message);}
		finally{setBusy(false);abort.current=null;}
	}
	const focus=(source:Evidence)=>{setView("source");setPage(source.page);setEvidence(source);};
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
			{proposal?.refinement&&<nav aria-label="Draft review views" className="flex flex-wrap gap-2 border-b px-5 py-3">
				<button type="button" className={button} disabled={!proposal.draft} aria-pressed={view==="map"} onClick={()=>setView("map")}>Proposed map</button>
				<button type="button" className={button} aria-pressed={view==="source"} onClick={()=>setView("source")}>Source images</button>
				<button type="button" className={button} disabled={busy} onClick={()=>setAttempt(proposal.refinement!.parentId)}>First-pass reading</button>
			</nav>}
			{view==="map"&&proposal?.draft?<MapDraftPreview key={proposal.id} proposal={proposal} onEvidence={focus}/>:<ProposalReviewBody proposal={proposal} capture={capture} snapshot={snapshot} model={model} loaded={loaded} busy={busy} error={error??(!loaded||proposal?.status==="prepared"?null:configError)}
				page={page} evidence={evidence} onPage={p=>{setPage(p);setEvidence(null);}} onEvidence={focus} onGenerate={()=>void generate()} onCancel={()=>abort.current?.abort()}
				onRefine={()=>void generate(proposal?.refinement?.parentId??proposal?.id)} />}
			{(proposal?.attempts?.length??0)>1&&<label className="flex items-center gap-3 border-t px-5 py-3 text-xs text-muted-foreground">Interpretation attempt
				<select aria-label="Interpretation attempt" className="min-w-0 rounded border bg-background px-2 py-1" disabled={busy} value={attempt??""} onChange={e=>{setAttempt(e.target.value||null);setPage(0);setEvidence(null);}}>
					<option value="">Latest</option>{proposal!.attempts!.map((a,i)=><option key={a.id} value={a.id}>{i+1} · {a.kind??"reading"} · {a.status} · {a.model}</option>)}
				</select></label>}
		</div>
	</div>,document.body);
}
export function ProposalReviewBody({proposal,capture,snapshot,model,loaded,busy,error,page,evidence,onPage,onEvidence,onGenerate,onCancel,onRefine}:{
	proposal:ProposalView|null;capture:MindmapCapture;snapshot:AtlasSnapshot;model:string|null;loaded:boolean;busy:boolean;error:string|null;
	page:number;evidence:Evidence|null;onPage:(page:number)=>void;onEvidence:(source:Evidence)=>void;onGenerate:()=>void;onCancel:()=>void;
	onRefine?:()=>void;
}) {
	const [zoom,setZoom]=useState(1),[broken,setBroken]=useState<string|null>(null),findings=proposal?.findings;
	const label=(index:number)=>mapImageLabel(proposal?.imageLayout?.[index],index);
	const notSent=proposal&&(proposal.status==="failed"||proposal.status==="cancelled")&&!proposal.images.length&&!proposal.usage;
	const image=proposal?.images.length?`/api/atlas/proposals?id=${proposal.id}&page=${Math.min(page,proposal.images.length-1)}`:
		capture.previewHash?`/api/atlas/mindmaps?revision=${capture.id}&kind=preview`:null;
	return <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1.1fr)_minmax(22rem,1fr)] md:overflow-hidden">
		<section aria-label="Saved source drawing" className="flex min-h-64 flex-col border-b bg-muted/20 md:min-h-0 md:border-b-0 md:border-r">
			<div className="flex items-center justify-between gap-2 border-b px-4 py-3 text-xs"><span>{proposal?.images.length?"Captured source views":"Source overview"}</span>
				<div className="flex items-center gap-1">
				<button type="button" className={button} aria-label="Zoom out source" disabled={zoom===1} onClick={()=>setZoom(Math.max(1,zoom-0.5))}>−</button>
				<button type="button" className={button} onClick={()=>setZoom(1)}>Fit</button>
				<button type="button" className={button} aria-label="Zoom in source" disabled={zoom===3} onClick={()=>setZoom(Math.min(3,zoom+0.5))}>+</button>
				{proposal && proposal.images.length>1 && <select aria-label="Source page" className="rounded border bg-background px-2 py-1" value={page} onChange={e=>onPage(Number(e.target.value))}>
					{proposal.images.map((_,i)=><option key={i} value={i}>{label(i)}</option>)}</select>}</div></div>
			{proposal?.imageLayout?.[page]?.kind==="detail"&&<p className="border-b px-4 py-2 text-[11px] text-muted-foreground">{label(page)} · position on whole map: {Math.round(proposal.imageLayout[page]!.region.x*100)}% from left, {Math.round(proposal.imageLayout[page]!.region.y*100)}% from top. Neighbouring details overlap.</p>}
			<div className={`flex flex-1 items-start overflow-auto p-4 ${zoom===1?"justify-center":"justify-start"}`}>
				{image && broken!==image?<div className="relative inline-block shrink-0" style={{width:`${zoom*100}%`}}>
					{/* eslint-disable-next-line @next/next/no-img-element -- immutable local page; no external image request. */}
					<img src={image} alt={`Saved map drawing, ${label(page)}`} className="block max-w-full rounded bg-white" style={{width:"100%"}} onError={()=>setBroken(image)} />
					{evidence?.page===page&&evidence.region&&<div aria-hidden="true" className="pointer-events-none absolute rounded border-2 border-amber-500 bg-amber-300/20"
						style={{left:`${evidence.region.x*100}%`,top:`${evidence.region.y*100}%`,width:`${evidence.region.w*100}%`,height:`${evidence.region.h*100}%`}} />}
				</div>:<p className="py-12 text-sm text-muted-foreground">Source image unavailable. Restore its files before interpretation.</p>}
			</div>
		</section>
		<section aria-label="Interpretation proposal" className="space-y-4 overflow-y-auto p-5 text-sm">
			{proposal?.status==="prepared"&&proposal.findings&&onRefine&&<div className="space-y-3 rounded-xl border border-blue-500/30 p-4">
				<h3 className="font-medium">Build a proposed mind map</h3>
				<p className="text-xs leading-relaxed text-muted-foreground">A second pass sends this saved reading, source images and linked concept names to {model??"your vision model"}. It proposes coherent notes and connections, separating source readings, reconstructions and added explanations. Up to two model calls; nothing is added to Atlas.</p>
				<button type="button" className={button} disabled={!model||busy} onClick={onRefine}>Refine into proposed map</button>
			</div>}
			{error&&<p role="alert" className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive">{error}</p>}
			{proposal && <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span className="rounded-full border px-2 py-1">{proposal.status}</span>
				<span className="py-1">{proposal.model}</span><span className="py-1">{notSent?"Model not called":proposal.usage?`${proposal.usage.steps} recorded model call(s)`:"Usage not reported"}</span>
				{!notSent&&<span className="py-1">{isSubscriptionModel(proposal.model)?"Counts toward plan usage":proposal.estimatedCost===null?"API estimate unavailable":`Estimated $${proposal.estimatedCost.toFixed(4)}`}</span>}</div>}
			{proposal && proposal.baseRevision!==snapshot.layoutRevision && <p className="rounded-lg border border-amber-500/40 p-3 text-xs">Atlas changed since this proposal was captured. Keep it for review; any future approval must revalidate its references.</p>}
			{proposal?.error&&<p className="rounded-lg border p-3 text-xs">{proposal.error}</p>}
			{(!proposal||!proposal.refinement&&proposal.status!=="running") && <div className="space-y-3 rounded-xl border p-4">
				<h3 className="font-medium">Interpret this saved revision</h3>
				<p className="text-xs leading-relaxed text-muted-foreground">A whole-map overview and overlapping detail images (or your supplied PNG), plus names/aliases of up to 40 linked concepts will be sent to {model??"your configured vision model"}. Uses up to two model calls. Original files stay unchanged.</p>
				<button type="button" className={button} disabled={!loaded||!model||busy} onClick={onGenerate}>{busy?"Interpreting…":proposal?.status==="prepared"?"Reinterpret with map layout":proposal?"Try interpretation again":"Interpret revision"}</button>

				{proposal&&<p className="text-xs text-muted-foreground">A new attempt preserves earlier results and may use additional plan allowance or API credits.</p>}
			</div>}
			{proposal?.refinement&&(proposal.status==="failed"||proposal.status==="cancelled")&&onRefine&&<div className="space-y-2 rounded-xl border p-4"><p className="text-xs text-muted-foreground">Retry refinement with {model??"your vision model"} using the retained first reading and source images. This starts a new attempt and may use additional plan allowance or API credits.</p><button type="button" className={button} disabled={!model||busy} onClick={onRefine}>Retry refinement</button></div>}
			{busy&&<button type="button" className={button} onClick={onCancel}>Cancel current attempt</button>}
			{(busy||proposal?.status==="running")&&<p role="status" className="animate-pulse text-xs text-muted-foreground">{proposal?.images.length?"Source views captured. Waiting for the model’s suggestions (up to 5 minutes)…":"Preparing whole-map and detail views locally…"}</p>}
			{findings&&<>
				<div><h3 className="font-medium">Labels and concepts <span className="text-muted-foreground">{findings.concepts.length}</span></h3>
					<div className="mt-2 space-y-2">{findings.concepts.map(c=><article key={c.key} className="space-y-2 rounded-xl border p-3">
						<div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">{c.title}</h4><span className="text-[11px] text-muted-foreground">{c.existingId?`Possible match: ${proposal?.context.find(n=>n.id===c.existingId)?.title??c.title}`:"Identity to review"}</span></div>
						{c.notes&&<MessageResponse mode="static">{c.notes}</MessageResponse>}
						{c.uncertainty&&<p className="text-xs text-amber-600 dark:text-amber-300">Uncertain: {c.uncertainty}</p>}
						<button type="button" className="text-left text-xs text-muted-foreground underline underline-offset-4" onClick={()=>onEvidence(c.evidence)}>{label(c.evidence.page)} · {c.evidence.quote}</button>
					</article>)}</div>
				</div>
				{(findings.depictions?.length??0)>0&&<div><h3 className="font-medium">Drawn connections</h3><div className="mt-2 space-y-2">{findings.depictions!.map((r,i)=><article key={i} className="space-y-2 rounded-xl border p-3">
					<p>{findings.concepts.find(c=>c.key===r.source)?.title} {r.direction==="forward"?"→":r.direction==="both"?"↔":"—"} {findings.concepts.find(c=>c.key===r.target)?.title}</p>
					<p className="text-xs text-muted-foreground">Observed drawing · {r.label||"unlabelled connection"}{r.direction==="unclear"?" · direction unclear":""}</p>
					{r.uncertainty&&<p className="text-xs text-amber-600 dark:text-amber-300">Uncertain: {r.uncertainty}</p>}
					{[r.evidence,...r.additionalEvidence??[]].map((e,j)=><button key={j} type="button" className="block text-left text-xs text-muted-foreground underline" onClick={()=>onEvidence(e)}>{label(e.page)} · {e.quote}</button>)}
				</article>)}</div></div>}
				{findings.relations.length>0&&<div><h3 className="font-medium">Proposed mathematical meaning</h3><div className="mt-2 space-y-2">{findings.relations.map((r,i)=><article key={i} className="space-y-2 rounded-xl border p-3">
					<p>{findings.concepts.find(c=>c.key===r.source)?.title} → {findings.concepts.find(c=>c.key===r.target)?.title}</p>
					<p className="text-xs text-muted-foreground">{r.type} · proposed association</p>{r.conditions&&<MessageResponse mode="static">{r.conditions}</MessageResponse>}
					{r.uncertainty&&<p className="text-xs text-amber-600 dark:text-amber-300">Uncertain: {r.uncertainty}</p>}
					{[r.evidence,...r.additionalEvidence??[]].map((e,j)=><button key={j} type="button" className="block text-left text-xs text-muted-foreground underline" onClick={()=>onEvidence(e)}>{label(e.page)} · {e.quote}</button>)}
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
