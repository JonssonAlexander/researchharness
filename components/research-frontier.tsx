"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {
 FRONTIER_BUDGET, FRONTIER_GOAL, FRONTIER_SCOPE, FRONTIER_TARGET, frontierTokens,
 type FrontierOpportunity, type FrontierSource, type FrontierState, type ResearchTrail,
} from "@/src/core";
import {MessageResponse} from "./ai-elements/message";
import {useServerEvent, useServerResync} from "./server-events";

const endpoint = "/api/research/frontier";
const button = "rounded border px-2 py-1 hover:bg-accent disabled:opacity-50";
const field = "w-full rounded border bg-background px-2 py-1";

async function readResponse(response: Response) {
 const data = await response.json();
 if (!response.ok) throw new Error(data.error || "Research Frontier is unavailable.");
 return data;
}
function Evidence({job, id, title, onConcept, onTrail}: {
 job: string; id: string; title?: string; onConcept: (id: string) => void; onTrail: (id: string) => void;
}) {
 const [source, setSource] = useState<FrontierSource | null>(null);
 const [error, setError] = useState("");
 const [loading, setLoading] = useState(false);
 function open() {
  if (source || loading) return;
  setLoading(true);
  setError("");
  void fetch(endpoint + "?" + new URLSearchParams({id: job, source: id}))
   .then(readResponse).then(setSource).catch(e => setError(e.message)).finally(() => setLoading(false));
 }
 let text = source?.text ?? "";
 try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Plain text evidence. */ }
 return <details onToggle={event => {if (event.currentTarget.open) open();}}>
  <summary className="cursor-pointer break-all">{source?.title ?? title ?? id}</summary>
  {loading && <p role="status">Opening evidence…</p>}
  {error && <p role="alert">{error}</p>}
  {source && <div className="space-y-1 rounded border p-2">
   <p>{source.status}</p>
   <pre className="break-words whitespace-pre-wrap">{text}</pre>
   {source.url && <a className="block underline" href={source.url} target="_blank" rel="noreferrer">Open cited source</a>}
   {source.chatId && <a className="block underline" href={`/chat/${encodeURIComponent(source.chatId)}`}>Open source conversation</a>}
   {source.kind === "concept" && <button type="button" className="underline" onClick={() => onConcept(source.id)}>Open Atlas concept</button>}
   {source.trailId && <button type="button" className="underline" onClick={() => onTrail(source.trailId!)}>Open research trail</button>}
  </div>}
 </details>;
}

function Direction({opportunity: {idea, assessment}, rank, previous, job, trails, titles, busy, send, onConcept, onTrail}: {
 opportunity: FrontierOpportunity; rank: number; previous: number; job: string; trails: ResearchTrail[]; titles: Record<string, string>; busy: boolean;
 send: (command: unknown) => Promise<boolean>;
 onConcept: (id: string) => void; onTrail: (id: string, node?: string) => void;
}) {
 const [trailId, setTrailId] = useState("");
 const [promoted, setPromoted] = useState(false);
 const position = previous < 0 ? "New to brief" : previous === rank ? "Same priority" :
  previous > rank ? `Up from ${previous + 1}` : `Down from ${previous + 1}`;
 const sources = [...new Set([...idea.sources, ...assessment.sources])];
 return <details className="space-y-2 rounded border p-2">
  <summary className="cursor-pointer font-medium">{rank >= 0 ? `${rank + 1}. ` : ""}{idea.title}
   <span className="ml-1 font-normal text-muted-foreground">· {rank >= 0 ? position : assessment.verdict}</span>
  </summary>
  {[
   ["Hypothesis", idea.hypothesis], ["Why it might work", idea.intuition], ["Start from", assessment.startingPoint],
   ["Obstacles", assessment.obstacles], ["Possible novelty", assessment.novelty], ["Investigate next", assessment.nextAction],
   ["Uncertainty", assessment.uncertainty], ["Assessment", assessment.reason],
  ].map(([label, value]) => <div key={label}><h4 className="font-medium">{label}</h4><MessageResponse mode="static">{value!}</MessageResponse></div>)}
  <div><h4 className="font-medium">Evidence</h4>{sources.map(id =>
   <Evidence key={id} id={id} title={titles[id]} job={job} onConcept={onConcept} onTrail={onTrail}/>)}</div>
  <button className={button} type="button" disabled={busy} onClick={() => void send({action: "deepen", id: job, opportunityId: idea.id})}>Deepen</button>
  {assessment.verdict === "pursue" && trails.length > 0 && <form className="space-y-2" onSubmit={event => {
   event.preventDefault();
   void send({action: "promote", id: job, opportunityId: idea.id, trailId}).then(setPromoted);
  }}>
   <label className="block">Research trail<select className={field} value={trailId} onChange={event => {setTrailId(event.target.value); setPromoted(false);}} required>
    <option value="">Select an existing trail</option>{trails.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
   </select></label>
   <button className={button} disabled={busy || !trailId || promoted}>{promoted ? "Added to trail" : "Promote to trail"}</button>
  </form>}
 </details>;
}

export function ResearchFrontier({trails, onConcept, onTrail}: {
 trails: ResearchTrail[]; onConcept: (id: string) => void; onTrail: (id: string, node?: string) => void;
}) {
 const [state, setState] = useState<FrontierState | null>(null);
 const [goal, setGoal] = useState<string | null>(null);
 const [budget, setBudget] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState("");
 const sequence = useRef(0);
 const reload = useCallback(async () => {
  const ticket = ++sequence.current;
  try {
   const data: FrontierState = await readResponse(await fetch(endpoint));
   if (ticket === sequence.current) setState(data);
  } catch (e) {
   if (ticket === sequence.current) setError(e instanceof Error ? e.message : "Could not load the brief.");
  }
 }, []);
 useEffect(() => {void reload();}, [reload]);
 useServerEvent("jobs-changed", event => {if (event.chatId === FRONTIER_SCOPE) void reload();});
 useServerResync(reload);

 async function send(command: unknown) {
  setBusy(true);
  setError("");
  try {
   const data = await readResponse(await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(command)}));
   if (data.nodeId) {
    onTrail((command as {trailId: string}).trailId, data.nodeId);
   } else await reload();
   return true;
  } catch (e) {
   setError(e instanceof Error ? e.message : "Discovery is unavailable.");
   return false;
  } finally {
   setBusy(false);
  }
 }
 const brief = state?.brief;
 const job = state?.job;
 const running = job?.status === "running";
 const goalValue = goal ?? brief?.goal ?? FRONTIER_GOAL;
 const budgetValue = budget ?? String(brief?.budget ?? FRONTIER_BUDGET);
 const directions = brief?.opportunities.filter(o => brief.selected.includes(o.idea.id)) ?? [];
 const other = brief?.opportunities.filter(o => !brief.selected.includes(o.idea.id)) ?? [];
 const activeTrails = trails.filter(t => !t.archivedAt);
 function display(o: FrontierOpportunity, rank: number) {
  return <Direction key={`${brief!.id}:${o.idea.id}`} opportunity={o} rank={rank}
   previous={brief!.previous.indexOf(o.idea.id)} job={brief!.id} trails={activeTrails} titles={brief!.sourceTitles}
   busy={!!running || busy} send={send} onConcept={onConcept} onTrail={onTrail}/>;
 }
 return <section aria-label="Research Frontier" className="space-y-2 rounded border border-violet-600/40 p-2 text-xs">
  <h2 className="font-medium">Research Frontier</h2>
  {directions.map(display)}
  {brief && <p className="text-muted-foreground">
   {new Date(brief.date).toLocaleDateString()} · {brief.usage ? `${frontierTokens(brief.usage).toLocaleString()} reported tokens · ${brief.usage.steps} model calls` : "No model usage recorded"}
   {brief.selected.length < 3 && " · Fewer than three directions qualified"}
   {brief.previous.some(id => !brief.selected.includes(id)) && ` · ${brief.previous.filter(id => !brief.selected.includes(id)).length} left the brief`}
   {brief.stale && " · Showing the previously saved brief"}
  </p>}
  {brief?.note && <p>{brief.note}</p>}
  {!!other.length && <details className="space-y-1"><summary className="cursor-pointer">Other assessed directions</summary>{other.map(o => display(o, -1))}</details>}
  {job?.status !== "done" && job && <p role={job.error ? "alert" : "status"}>{job.interrupted ? "Discovery was interrupted. Resume from saved progress or cancel." : job.error || job.activity}</p>}
  {job?.status === "error" && job.error !== "Cancelled" && <button type="button" className={button} disabled={busy}
   onClick={() => void send({action: "resume", id: job.id})}>Retry from saved progress</button>}
  {running && <div className="flex flex-wrap gap-2">
   {job.interrupted && <button className={button} disabled={busy} type="button" onClick={() => void send({action: "resume", id: job.id})}>Resume</button>}
   <button className={button} disabled={busy} type="button" onClick={() => void send({action: "cancel", id: job.id})}>Cancel</button>
  </div>}
  {!running && <form className="space-y-2" onSubmit={event => {event.preventDefault(); void send({action: "start", goal: goalValue, budget: Number(budgetValue)});}}>
   <details className="space-y-2"><summary className="cursor-pointer">Discovery settings</summary>
    <label className="block">Research goal<textarea className={field} required maxLength={1000} value={goalValue} onChange={e => setGoal(e.target.value)}/></label>
    <label className="block">Token budget target<input className={field} type="number" required step={1} min={FRONTIER_TARGET} max={100000} value={budgetValue} onChange={e => setBudget(e.target.value)}/></label>
   </details>
   <p className="text-muted-foreground">{state?.model ? `Sends selected notes, graph evidence and research history to ${state.model}. Provider usage or charges may apply.` : "Configure a research model in Settings to generate a brief."}</p>
   <div className="flex flex-wrap gap-2">
    <button className={button} disabled={busy || (!state?.model && !brief)}>{brief ? "Start research session" : "Build session brief"}</button>
    {brief && <button className={button} disabled={busy || !state?.model} type="button"
     onClick={() => void send({action: "refresh", goal: goalValue, budget: Number(budgetValue)})}>Refresh brief</button>}
   </div>
  </form>}
  {error && <p role="alert">{error}</p>}
 </section>;
}
