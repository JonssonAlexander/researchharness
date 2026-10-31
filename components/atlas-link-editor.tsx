"use client";
import {useState} from "react";
import {drawingConnections,type DrawingLink,type AtlasSnapshot,type AtlasCommand} from "@/src/core";
import {AtlasRelations} from "./atlas-relations";
import {MessageResponse} from "./ai-elements/message";

const field="w-full rounded border bg-background px-2 py-1.5 text-xs";
const button="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50";
export function AtlasLinkEditor({snapshot,sourceId,targetId,save,onClose,onSelect}:{snapshot:AtlasSnapshot;sourceId:string;targetId:string;save:(c:AtlasCommand)=>Promise<void>;onClose:()=>void;onSelect?:(id:string)=>void}){
 const [draft,setDraft]=useState<DrawingLink|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[confirm,setConfirm]=useState(false);
 const pair=(c:{sourceId:string;targetId:string})=>[sourceId,targetId].includes(c.sourceId)&&[sourceId,targetId].includes(c.targetId);
 const links=drawingConnections(snapshot).filter(pair);
 const removed=(snapshot.drawingLinks??[]).filter(c=>c.removed&&pair(c));
 const name=(id:string)=>snapshot.concepts.find(c=>c.id===id)?.title??"Unavailable concept";
 async function submit(link:DrawingLink){
  setBusy(true);setError("");
  try{await save({...link,kind:"drawing-link",expectedRevision:snapshot.layoutRevision??0});setDraft(null);setConfirm(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function edit(id?:string){
  const link=links.find(c=>c.id===id),existing=snapshot.drawingLinks?.find(c=>c.id===id);
  setDraft(existing??{id:`dl_${crypto.randomUUID()}`,sourceId:link?.sourceId??sourceId,targetId:link?.targetId??targetId,label:link?.label??"",direction:link?.direction??"unclear",notes:link?.notes.slice(0,2000)??"",replaces:link?.id??null,removed:false});setConfirm(false);setError("");
 }
 return <section role="dialog" aria-label="Edit connections" className="absolute right-3 top-24 z-40 max-h-[75vh] w-[420px] max-w-[calc(100%_-_24px)] space-y-3 overflow-y-auto rounded-xl border bg-background p-4 shadow-xl">
  <div className="flex items-start justify-between gap-2"><h2 className="text-sm font-medium">Connections</h2><button type="button" className={button} onClick={onClose}>Close connections</button></div>
  <MessageResponse mode="static">{`${name(sourceId)} — ${name(targetId)}`}</MessageResponse>
  <p className="text-xs text-muted-foreground">Ordinary lines record associations. They do not assert a proof. Edits change the Atlas drawing; imported files stay unchanged.</p>
  {draft?<form className="space-y-2" onSubmit={e=>{e.preventDefault();void submit(draft);}}><fieldset disabled={busy} className="space-y-2">
   {(["sourceId","targetId"] as const).map(key=><label className="block text-xs" key={key}>{key==="sourceId"?"From":"To"}<select className={field} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}>{snapshot.concepts.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>)}
   <label className="block text-xs">Label<input className={field} maxLength={160} value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})}/></label>
   <label className="block text-xs">Direction<select className={field} value={draft.direction} onChange={e=>setDraft({...draft,direction:e.target.value as DrawingLink["direction"]})}><option value="unclear">Undirected / unclear</option><option value="forward">From → To</option><option value="both">Both ways</option></select></label>
   <label className="block text-xs">Context / uncertainty<textarea className={field} rows={3} maxLength={2000} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
   <div className="flex flex-wrap gap-1"><button className={button}>Save connection</button><button type="button" className={button} onClick={()=>setDraft(null)}>Cancel</button>
   {links.some(c=>c.id===draft.id||c.id===draft.replaces)&&<button type="button" className={button} onClick={()=>setConfirm(true)}>Remove line</button>}</div>
   {confirm&&<div className="space-x-1 text-xs"><span>Remove this line from Atlas?</span><button type="button" className={button} onClick={()=>void submit({...draft,removed:true})}>Confirm removal</button><button type="button" className={button} onClick={()=>setConfirm(false)}>Keep line</button></div>}
  </fieldset></form>:<>
   {links.map(c=><div className="space-y-1 rounded border p-2 text-xs" key={c.id}><MessageResponse mode="static">{`${name(c.sourceId)} ${c.direction==="forward"?"→":c.direction==="both"?"↔":"—"} ${name(c.targetId)}`}</MessageResponse>{c.label&&<MessageResponse mode="static">{c.label}</MessageResponse>}<p className="text-muted-foreground">{c.origin==="owner"?"Your drawing":c.origin==="ai"?"AI suggestion · review / study needed":"Imported drawing"}</p>{c.notes&&<details><summary>Context</summary><MessageResponse mode="static">{c.notes}</MessageResponse></details>}<button type="button" className={button} onClick={()=>edit(c.id)}>Edit ordinary line</button></div>)}
   {!links.length&&<p className="text-xs text-muted-foreground">No ordinary lines between these concepts.</p>}
   <button type="button" disabled={busy} className={button} onClick={()=>edit()}>Add ordinary connection</button>
   {removed.map(c=><div key={c.id} className="text-xs">Removed: {c.label||`${name(c.sourceId)} — ${name(c.targetId)}`} <button type="button" disabled={busy} className={button} onClick={()=>void submit({...c,removed:false})}>Restore line</button></div>)}
   <AtlasRelations key={`${sourceId}:${targetId}`} conceptId={sourceId} otherId={targetId} snapshot={snapshot} save={save} onSelect={id=>onSelect?.(id)}/>
  </>}
  {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
 </section>;
}
