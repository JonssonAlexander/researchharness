"use client";
import {useEffect,useState} from "react";
import {identityCandidates,mapReviewReasons,RELATION_TYPES,type MapDraft,type MapReview,type MapIntegration,type AtlasSnapshot,type IntegrationChoices} from "@/src/core";
const field="w-full rounded border bg-background px-2 py-1.5 text-xs",button="rounded border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50";
export async function reviewRequest(body:unknown){const r=await fetch("/api/atlas/map-review",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
export function DraftItemEditor({draft,selection,onChange}:{draft:MapDraft;selection:{kind:"concept"|"connection";key:string};onChange:(d:MapDraft)=>void}){
	const node=selection.kind==="concept"?draft.concepts.find(n=>n.key===selection.key):null,edge=selection.kind==="connection"?draft.connections.find(e=>e.key===selection.key):null;
	function patch(changes:object){onChange({...draft,[node?"concepts":"connections"]:(node?draft.concepts:draft.connections).map(n=>n.key===selection.key?{...n,...changes}:n)});}
	return <details className="space-y-2 rounded-xl border p-3"><summary className="cursor-pointer text-xs font-medium">Edit {node?"concept":"connection"}</summary>
		{node&&<><label className="block text-xs">Name<input className={field} maxLength={160} value={node.title} onChange={e=>patch({title:e.target.value,existingId:null})}/></label>
		{node.notes.map((note,i)=><label key={i} className="block text-xs">Note {i+1} · Markdown / LaTeX<textarea className={field} rows={5} maxLength={4000} value={note.text} onChange={e=>patch({notes:node.notes.map((n,j)=>i===j?{...n,text:e.target.value,origin:"explanation",rationale:"Edited by the owner during draft review; not independently verified."}:n)})}/></label>)}</>}
		{edge&&<><label className="block text-xs">Label<input className={field} value={edge.label} maxLength={160} onChange={e=>patch({label:e.target.value})}/></label>
		{(["source","target"] as const).map(k=><label key={k} className="block text-xs">{k}<select className={field} value={edge[k]} onChange={e=>patch({[k]:e.target.value})}>{draft.concepts.map(n=><option key={n.key} value={n.key}>{n.title}</option>)}</select></label>)}
		<label className="block text-xs">Direction<select className={field} value={edge.direction} onChange={e=>patch({direction:e.target.value})}>{["forward","both","unclear"].map(x=><option key={x}>{x}</option>)}</select></label>
		<label className="block text-xs">Meaning<select className={field} value={edge.relationType??""} onChange={e=>patch({relationType:e.target.value||null})}><option value="">Unspecified drawing connection</option>{RELATION_TYPES.map(t=><option key={t}>{t}</option>)}</select></label></>}
		{(node||edge)&&(["rationale","assumptions","uncertainty"] as const).map(k=><label key={k} className="block text-xs">{k}<textarea rows={2} className={field} maxLength={2000} value={(node??edge)![k]} onChange={e=>patch({[k]:e.target.value})}/></label>)}
		<button type="button" className={button} onClick={()=>onChange(node?{...draft,concepts:draft.concepts.filter(n=>n.key!==node.key),connections:draft.connections.filter(e=>e.source!==node.key&&e.target!==node.key)}:{...draft,connections:draft.connections.filter(e=>e.key!==edge?.key)})}>Remove {node?"concept and its draft connections":"connection"}</button>
	</details>;
}
export function DraftAdd({draft,onChange}:{draft:MapDraft;onChange:(d:MapDraft)=>void}){
	const [name,setName]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState("");
	const support={origin:"explanation" as const,evidence:[],rationale:"Owner-added during review; mathematical support still needs review.",assumptions:"",uncertainty:"Needs mathematical review."};
	return <details className="rounded-xl border p-3"><summary className="cursor-pointer text-xs font-medium">Add concept or connection</summary><div className="mt-2 space-y-2">
		<label className="block text-xs">New concept<input className={field} value={name} maxLength={160} onChange={e=>setName(e.target.value)}/></label>
		<button type="button" className={button} disabled={!name.trim()||draft.concepts.length>=40} onClick={()=>{onChange({...draft,concepts:[...draft.concepts,{key:`draft_${crypto.randomUUID()}`,title:name.trim(),sourceKeys:[],existingId:null,...support,notes:[{...support,text:"Add an explanation, assumptions and useful examples."}]}]});setName("");}}>Add concept</button>
		{(["From","To"] as const).map((label,i)=><label key={label} className="block text-xs">{label}<select className={field} value={i?to:from} onChange={e=>(i?setTo:setFrom)(e.target.value)}><option value="">Choose concept</option>{draft.concepts.map(n=><option key={n.key} value={n.key}>{n.title}</option>)}</select></label>)}
		<button type="button" className={button} disabled={!from||!to||from===to||draft.connections.length>=60} onClick={()=>onChange({...draft,connections:[...draft.connections,{key:`edge_${crypto.randomUUID()}`,source:from,target:to,direction:"unclear",relationType:null,label:"",...support}]})}>Add connection</button>
	</div></details>;
}
export function DraftIntegration({review,atlas,onPrepared,onCommitted,onCancel}:{review:MapReview;atlas:AtlasSnapshot;onPrepared:(plan:MapIntegration|null)=>void;onCommitted:()=>void;onCancel?:()=>void}){
	const [choices,setChoices]=useState<IntegrationChoices>(()=>({identities:Object.fromEntries(review.draft.concepts.map(n=>[n.key,identityCandidates(n.title,atlas).length?null:"new"])),subjectId:null,connections:[],mapConnections:review.draft.connections.map(e=>e.key)}));
	const [plan,setPlan]=useState<MapIntegration|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
	function change(c:IntegrationChoices){setChoices({...c,connections:c.connections.filter(key=>{const e=review.draft.connections.find(e=>e.key===key)!;return c.identities[e.source]&&c.identities[e.target];})});setPlan(null);onPrepared(null);}
	useEffect(()=>()=>onPrepared(null),[onPrepared]);
	async function run(commit=false){setBusy(true);setError("");try{if(commit&&plan){await reviewRequest({action:"commit",id:plan.id,digest:plan.digest,approve:true});onCommitted();}else {const p=await reviewRequest({action:"prepare",proposalId:review.proposalId,expectedRevision:review.revision,choices:{...choices,mapConnections:choices.mapConnections?.filter(key=>{const e=review.draft.connections.find(e=>e.key===key)!;return choices.identities[e.source]&&choices.identities[e.target];})},baseRevision:atlas.layoutRevision??0});setPlan(p);onPrepared(p);}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
	return <section className="space-y-3 rounded-xl border p-3"><h3 className="text-sm font-medium">Integrate into Atlas</h3>
		<p className="text-xs text-muted-foreground">Choose identities explicitly. Reuse adds sourced notes without renaming or replacing existing notes. Ambiguous matches need your judgment; name matching cannot prove identity.</p>
		{review.draft.concepts.map(n=><label key={n.key} className="block text-xs">{n.title}{mapReviewReasons(n).length>0?" · ● needs review":""}<select className={field} value={choices.identities[n.key]??""} onChange={e=>change({...choices,identities:{...choices.identities,[n.key]:e.target.value||null}})}><option value="">Exclude / defer</option><option value="new">Create new concept</option>{atlas.concepts.map(c=><option key={c.id} value={c.id}>Reuse: {c.title}{identityCandidates(n.title,atlas).some(x=>x.id===c.id)?" · possible match":""}</option>)}</select></label>)}
		<label className="block text-xs">Subject for new concepts<select className={field} value={choices.subjectId??""} onChange={e=>change({...choices,subjectId:e.target.value||null})}><option value="">Unassigned</option>{atlas.subjects.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
		<p className="text-xs">Mind-map lines are ordinary associations. Keep them without assigning a mathematical type; promoting a typed relation is a separate choice.</p>
		{review.draft.connections.map(e=>{const eligible=!!choices.identities[e.source]&&!!choices.identities[e.target];return <div key={e.key} className="space-y-1 rounded border p-2 text-xs">
			<label className="block"><input type="checkbox" disabled={!eligible||busy} checked={eligible&&(choices.mapConnections??[]).includes(e.key)} onChange={event=>change({...choices,mapConnections:event.target.checked?[...(choices.mapConnections??[]),e.key]:choices.mapConnections?.filter(k=>k!==e.key)})}/> Keep line: {review.draft.concepts.find(n=>n.key===e.source)?.title} — {review.draft.concepts.find(n=>n.key===e.target)?.title}</label>
			{e.relationType&&e.direction!=="unclear"&&<label className="block text-muted-foreground"><input type="checkbox" disabled={!eligible||busy} checked={choices.connections.includes(e.key)} onChange={event=>change({...choices,connections:event.target.checked?[...choices.connections,e.key]:choices.connections.filter(k=>k!==e.key)})}/> Also accept typed relation: {e.relationType}</label>}
		</div>;})}
		{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
		<button type="button" className={button} disabled={busy} onClick={()=>void run()}>Preview integration</button> {onCancel&&<button type="button" className={button} disabled={busy} onClick={onCancel}>Back to editing</button>}
		{plan&&<div className="space-y-2 border-t pt-3 text-xs"><p>{plan.concepts.filter(n=>!n.existing).length} new concepts · {plan.concepts.filter(n=>n.existing).length} reused · {plan.mapConnections?.length??0} mind-map lines · {plan.relations.length} typed links · {plan.reusedRelations.length} matching links reused.</p><p>See “In Atlas” for placement. Approval keeps the listed ordinary map lines, sourced notes and any explicitly selected typed relations. Mathematical claims remain external assertions, with review markers preserved.</p><button type="button" className={button} disabled={busy} onClick={()=>void run(true)}>Approve and integrate</button></div>}
	</section>;
}


export function MapConnectionRepair({review,atlas,onPrepared,onCommitted,onCancel}:{review:MapReview;atlas:AtlasSnapshot;onPrepared:(plan:MapIntegration|null)=>void;onCommitted:()=>void;onCancel:()=>void}){
	const [plan,setPlan]=useState<MapIntegration|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
	useEffect(()=>()=>onPrepared(null),[onPrepared]);
	async function run(commit=false){setBusy(true);setError("");try{
		if(commit&&plan){await reviewRequest({action:"commit",id:plan.id,digest:plan.digest,approve:true});onCommitted();}
		else{const p=await reviewRequest({action:"prepare-connections",proposalId:review.proposalId,baseRevision:atlas.layoutRevision??0});setPlan(p);onPrepared(p);}
	}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
	const title=(id:string)=>atlas.concepts.find(n=>n.id===id)?.title??id;
	return <section className="space-y-3 rounded-xl border p-3 text-xs" aria-label="Restore integrated map connections">
		<h3 className="text-sm font-medium">Restore missing map connections</h3>
		<p>Uses the identities from your original integration. Adds ordinary associations only; existing nodes, notes, positions and mathematical relations stay intact.</p>
		<button type="button" className={button} disabled={busy} onClick={()=>void run()}>Preview missing connections</button>{" "}<button type="button" className={button} disabled={busy} onClick={onCancel}>Cancel</button>
		{error&&<p role="alert" className="text-destructive">{error}</p>}
		{plan&&<><p>{plan.mapConnections?.length??0} missing lines · 0 new nodes · {plan.skippedConnections?.length??0} lines skipped because an endpoint was excluded or removed.</p>
			{plan.mapConnections?.map(c=><div key={c.id} className="rounded border p-2"><p>{title(c.sourceId)} — {title(c.targetId)}</p>{c.label&&<p className="text-muted-foreground">{c.label}</p>}{c.uncertainty&&<p className="text-amber-600">{c.uncertainty}</p>}</div>)}
			{!!plan.skippedConnections?.length&&<details><summary>Skipped connections</summary>{plan.skippedConnections.map(key=>{const e=review.draft.connections.find(e=>e.key===key)!;return <p key={key}>{review.draft.concepts.find(n=>n.key===e.source)?.title} — {review.draft.concepts.find(n=>n.key===e.target)?.title}</p>;})}</details>}
			{plan.mapConnections?.length?<><p>Use “In Atlas” to inspect the dotted source associations before approving.</p><button type="button" className={button} disabled={busy} onClick={()=>void run(true)}>Approve and restore connections</button></>:<p>All available connections are already present.</p>}
		</>}
	</section>;
}
