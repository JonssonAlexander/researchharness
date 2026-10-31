"use client";
import {useEffect,useState} from "react";
import {arrangeAtlas,type AtlasArrangement,type AtlasSnapshot,type AtlasCommand} from "@/src/core";
export type ArrangementPosition={id:string;x:number;y:number};
export function AtlasArrange({atlas,mapId,conceptId,save,onPreview}:{atlas:AtlasSnapshot;mapId:string|null;conceptId:string|null;save:(c:AtlasCommand)=>Promise<void>;onPreview:(p:ArrangementPosition[]|null)=>void}){
 const [mode,setMode]=useState<AtlasArrangement>("organic"),[plan,setPlan]=useState<{positions:ArrangementPosition[];base:number}|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const subject=atlas.concepts.find(c=>c.id===conceptId)?.preferredSubjectId,map=atlas.mindmaps?.find(m=>m.id===mapId),ids=map?map.captures.find(c=>c.id===map.currentRevision)?.conceptIds??[]:atlas.concepts.filter(c=>!conceptId||c.preferredSubjectId===subject).map(c=>c.id);
 useEffect(()=>()=>onPreview(null),[onPreview]);
 useEffect(()=>{setPlan(null);onPreview(null);},[mapId,subject,atlas.layoutRevision,onPreview]);
 function preview(){try{const positions=arrangeAtlas(atlas,ids,mode);setPlan({positions,base:atlas.layoutRevision??0});onPreview(positions);setError("");}catch(e){setError((e as Error).message);}}
 async function commit(){if(!plan)return;setBusy(true);setError("");try{await save({kind:"layout",expectedRevision:plan.base,positions:plan.positions});setPlan(null);onPreview(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const button="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50";
 return <details className="space-y-2 rounded border p-2 text-xs"><summary className="cursor-pointer font-medium">Arrange {map?map.title:subject?atlas.subjects.find(s=>s.id===subject)?.title:"Atlas"}</summary><p className="text-muted-foreground">Preview unlocked nodes in this selection. Other regions stay in place.</p><select aria-label="Arrangement style" className="w-full rounded border bg-background p-1" value={mode} onChange={e=>{setMode(e.target.value as AtlasArrangement);setError("");setPlan(null);onPreview(null);}}><option value="organic">Organic</option><option value="radial">Radial / flower</option><option value="connected">Most connected in centre</option></select><button type="button" className={button} disabled={busy} onClick={preview}>Preview arrangement</button>{plan&&<div><p>{plan.positions.length} nodes · positions only</p><button type="button" className={button} disabled={busy} onClick={()=>void commit()}>Save arrangement</button> <button type="button" className={button} disabled={busy} onClick={()=>{setPlan(null);onPreview(null);}}>Cancel</button></div>}{error&&<p role="alert" className="text-destructive">{error}</p>}</details>;
}
