"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {
 ADAPTIVE_BUDGET, ADAPTIVE_DEFAULTS, FRONTIER_ACTIONS, FRONTIER_PRIORITIES, FRONTIER_STOPS, FRONTIER_BUDGET, FRONTIER_GOAL, FRONTIER_SCOPE, FRONTIER_TARGET, frontierTokens,
 type FrontierBoardEntry, type FrontierPreference, type FrontierProgress, type FrontierOpportunity, type FrontierSource, type FrontierState, type ResearchTrail,
} from "@/src/core";
import {MessageResponse} from "./ai-elements/message";
import {useServerEvent, useServerResync} from "./server-events";
import {useSettingsSaved} from "./settings-signal";

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

function Direction({opportunity: {idea, assessment}, rank, previous, job, trails, titles, preference, busy, send, onConcept, onTrail, boardCard}: {
 boardCard?: FrontierBoardEntry;
 opportunity: FrontierOpportunity; rank: number; previous: number; job: string; trails: ResearchTrail[]; titles: Record<string, string>; preference?: FrontierPreference; busy: boolean;
 send: (command: unknown) => Promise<boolean>;
 onConcept: (id: string) => void; onTrail: (id: string, node?: string) => void;
}) {
 const [trailId, setTrailId] = useState("");
 const [promoted, setPromoted] = useState(false);
 const position = previous < 0 ? "New to brief" : previous === rank ? "Same priority" :
  previous > rank ? `Up from ${previous + 1}` : `Down from ${previous + 1}`;
 const sources = [...new Set([...idea.sources, ...assessment.sources])];
 return <details open={boardCard ? true : undefined} className="space-y-2 rounded border p-2">
  <summary className="cursor-pointer font-medium">{rank >= 0 ? `${rank + 1}. ` : ""}{idea.title}
   <span className="ml-1 font-normal text-muted-foreground">· {rank >= 0 ? position : assessment.verdict}</span>
  </summary>
  {boardCard && <div className="flex flex-wrap items-center gap-2">
   <span className="flex items-center gap-1 font-medium"><span aria-hidden="true" className="size-2 rounded-full"
    style={{backgroundColor: FRONTIER_PRIORITIES[boardCard.priority].color}}/>{FRONTIER_PRIORITIES[boardCard.priority].label}</span>
   <button className={button} type="button" disabled={busy}
    onClick={() => void send({action: "branch", id: job, opportunityId: idea.id})}>Branch from here</button>
   <button className={button} type="button" disabled={busy}
    onClick={() => void send({action: "archive-opportunity", id: job, opportunityId: idea.id, archived: true})}>Archive</button>
   <button className={button} type="button" disabled={busy}
    title="Add an Atlas concept labelled as a research hypothesis"
    onClick={() => void send({action: "add-to-atlas", id: job, opportunityId: idea.id})}>Add to Atlas</button>
  </div>}
  {[
   ["Hypothesis", idea.hypothesis], ["Why it might work", idea.intuition], ["Start from", assessment.startingPoint],
   ["Obstacles", assessment.obstacles], ["Possible novelty", assessment.novelty], ["Investigate next", assessment.nextAction],
   ["Uncertainty", assessment.uncertainty], ["Assessment", assessment.reason],
  ].map(([label, value]) => <div key={label}><h4 className="font-medium">{label}</h4><MessageResponse mode="static">{value!}</MessageResponse></div>)}
  <div><h4 className="font-medium">Evidence</h4>{sources.map(id =>
   <Evidence key={id} id={id} title={titles[id]} job={job} onConcept={onConcept} onTrail={onTrail}/>)}</div>
  {assessment.feedback && <details><summary>Mathematical critique</summary>
   <p>Mechanism · {assessment.feedback.mechanism}</p>
   {assessment.feedback.failureMechanism && <MessageResponse mode="static">{assessment.feedback.failureMechanism}</MessageResponse>}
   {[
    ["Unresolved assumptions", assessment.feedback.unresolvedAssumptions],
    ["Alternative mechanisms", assessment.feedback.alternativeMechanisms],
    ["Evidence needed", assessment.feedback.evidenceNeeded],
   ].map(([label, entries]) => Array.isArray(entries) && entries.length > 0 &&
    <div key={String(label)}><h4 className="font-medium">{label}</h4>
     {entries.map(entry => <MessageResponse key={entry} mode="static">{entry}</MessageResponse>)}</div>)}
  </details>}
  <div className="flex flex-wrap gap-1" aria-label="Direction feedback">
   {([["interested", "Interested"], ["dismiss", "Dismiss"], ["revisit", "Revisit later"]] as const).map(([value, label]) =>
    <button className={`${button} aria-pressed:bg-accent`} type="button" key={value} aria-pressed={preference === value} disabled={busy}
     onClick={() => void send({action: "feedback", id: job, opportunityId: idea.id, preference: value})}>{label}</button>)}
  </div>
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

function DiscoveryProgress({progress}: {progress: FrontierProgress}) {
 const {action, budget, iteration, rounds, settings, stop, reportedTokens, estimatedUnreported} = progress;
 return <div className="space-y-1 rounded border p-2" aria-label="Auto-discovery progress">
  <p>{iteration ? `Iteration ${iteration}` : "Broad discovery pass"}
   {action && ` · ${FRONTIER_ACTIONS[action.kind]} · ${action.label}`}</p>
  <p>{reportedTokens === undefined ? "No provider usage reported yet" : `${reportedTokens.toLocaleString()} reported tokens`}
   {!!estimatedUnreported && ` + ${estimatedUnreported.toLocaleString()} estimated`} · {budget.toLocaleString()} target</p>
  {action && <p>Estimated next call · {action.estimate.toLocaleString()} tokens · priority {action.priority}</p>}
  {action?.recovery && <p>{action.recovery}</p>}
  {action?.penalty !== undefined && <p>Priority multiplier {action.penalty.toFixed(2)} · {action.overlap} overlapping investigations</p>}
  {stop && <p>{FRONTIER_STOPS[stop]}</p>}
  <details><summary>Iteration outcomes and settings</summary>
   <p>Minimum gain {settings.minGain} · reconsider strategy after {settings.patience} below threshold · minimum action priority {settings.minValue}</p>
   <ul className="space-y-2">{rounds.map((round, i) => <li key={i}>
    <p className="font-medium">{round.label} · {round.gain > 0 ? "+" : ""}{round.gain} portfolio points</p>
    {round.progress && <p>Progress {round.progress.total} · information gain {round.progress.information}</p>}
    {round.penalty !== undefined && <p>Priority multiplier {round.penalty.toFixed(2)} · {round.overlap} overlapping investigations</p>}
    {round.recovery && <p>{round.recovery}</p>}
    {round.progress?.insights.map(insight => <details key={insight.finding}>
     <summary>{insight.finding}</summary><p>{insight.justification}</p><p>Sources · {insight.sources.join(", ")}</p>
    </details>)}
    <p>{round.outcome} · {round.reportedTokens.toLocaleString()} reported tokens
     {!!round.estimatedUnreported && ` + ${round.estimatedUnreported.toLocaleString()} estimated`}</p>
   </li>)}</ul>
  </details>
 </div>;
}

type BoardDetail = {opportunity: FrontierOpportunity; rank: number; previous: number; sourceTitles: Record<string, string>};

export function ResearchFrontier({trails, onConcept, onTrail, onBoard, selected, onSelect}: {
 onBoard?: (entries: FrontierBoardEntry[]) => void;
 selected?: string | null;
 onSelect?: (id: string) => void;
 trails: ResearchTrail[]; onConcept: (id: string) => void; onTrail: (id: string, node?: string) => void;
}) {
 const [state, setState] = useState<FrontierState | null>(null);
 const [goal, setGoal] = useState<string | null>(null);
 const [budget, setBudget] = useState<string | null>(null);
 const [mode, setMode] = useState<"single" | "adaptive" | null>(null);
 const [settings, setSettings] = useState<Record<string, string>>({});
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState("");
 const [boardDetail, setBoardDetail] = useState<{key: string; detail: BoardDetail} | null>(null);
 const [boardError, setBoardError] = useState("");
 const sequence = useRef(0);
 const reload = useCallback(async () => {
  const ticket = ++sequence.current;
  try {
   const data: FrontierState = await readResponse(await fetch(mode ? `${endpoint}?mode=${mode}` : endpoint));
   if (ticket === sequence.current) setState(data);
  } catch (e) {
   if (ticket === sequence.current) setError(e instanceof Error ? e.message : "Could not load the brief.");
  }
 }, [mode]);
 useEffect(() => {void reload();}, [reload]);
 useEffect(() => {if (state?.board) onBoard?.(state.board);}, [onBoard, state?.board]);
 useServerEvent("jobs-changed", event => {if (event.chatId === FRONTIER_SCOPE) void reload();});
 useServerResync(reload);
 useSettingsSaved(section => {if (section === "agent" || section === "models") void reload();});

 async function send(command: unknown) {
  setBusy(true);
  setError("");
  try {
   const data = await readResponse(await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(command)}));
   if (data.conceptId) {
    onConcept(data.conceptId);
   } else if (data.nodeId) {
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
 const progress = running || job?.status === "error" ? job.progress : brief?.progress;
 const goalValue = goal ?? brief?.goal ?? FRONTIER_GOAL;
 const modeValue = mode ?? brief?.mode ?? "single";
 const adaptive = modeValue === "adaptive";
 const policy = brief?.progress?.settings ?? ADAPTIVE_DEFAULTS;
 const budgetValue = budget ?? String((!brief?.mode || brief.mode === modeValue ? brief?.budget : undefined)
  ?? (adaptive ? ADAPTIVE_BUDGET : FRONTIER_BUDGET));
 function start(action: "start" | "refresh") {
  const configured = {
   patience: Number(settings.patience ?? policy.patience),
   minGain: Number(settings.minGain ?? policy.minGain),
   minValue: Number(settings.minValue ?? policy.minValue),
  };
  return send({action, goal: goalValue, budget: Number(budgetValue), ...(adaptive ? {adaptive: configured} : {})});
 }
 const directions = brief?.opportunities.filter(o => brief.selected.includes(o.idea.id)) ?? [];
 const other = brief?.opportunities.filter(o => !brief.selected.includes(o.idea.id) &&
  (!onBoard || !state?.board?.some(card => card.id === o.idea.id))) ?? [];
 const activeTrails = trails.filter(t => !t.archivedAt);
 const activeEntry = state?.board?.find(card => card.id === selected && !card.archived);
 const selectedJob = activeEntry?.jobId;
 const selectedId = activeEntry?.id;
 const current = brief?.id === selectedJob ? brief?.opportunities.find(o => o.idea.id === selectedId) : undefined;
 const detailKey = `${selectedJob}:${selectedId}`;
 const detail = current && brief ? {opportunity: current, rank: brief.selected.indexOf(current.idea.id),
  previous: brief.previous.indexOf(current.idea.id), sourceTitles: brief.sourceTitles} :
  boardDetail?.key === detailKey ? boardDetail.detail : null;
 useEffect(() => {
  setBoardError("");
  if (!selectedJob || !selectedId || current) return;
  const controller = new AbortController();
  void fetch(endpoint + "?" + new URLSearchParams({id: selectedJob, opportunity: selectedId}), {signal: controller.signal})
   .then(readResponse)
   .then(detail => {if (!controller.signal.aborted) setBoardDetail({key: detailKey, detail});})
   .catch(e => {if (!controller.signal.aborted) setBoardError(e.message);});
  return () => controller.abort();
 }, [selectedJob, selectedId, Boolean(current), detailKey]);
 const board = state?.board ?? [];
 const openCards = board.filter(card => !card.archived);
 const archive = board.filter(card => card.archived);
 function display(o: FrontierOpportunity, rank: number) {
  return <Direction key={`${brief!.id}:${o.idea.id}`} opportunity={o} rank={rank}
   previous={brief!.previous.indexOf(o.idea.id)} job={brief!.id} trails={activeTrails} titles={brief!.sourceTitles} preference={brief!.feedback?.[o.idea.id]}
   busy={!!running || busy} send={send} onConcept={onConcept} onTrail={onTrail}/>;
 }
 return <section aria-label="Research Frontier" className="space-y-3 text-xs">
  {!onBoard && <><h2 className="font-medium">Research Frontier</h2>{directions.map(display)}</>}
  {onBoard && <>
   <div className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Hypothesis priority legend">
    {Object.values(FRONTIER_PRIORITIES).map(p => <span key={p.label} className="flex items-center gap-1">
     <span aria-hidden="true" className="size-2.5 rounded-full border-2" style={{borderColor: p.color}}/>{p.label}</span>)}
   </div>
   {activeEntry && detail && <Direction key={detailKey} {...detail} job={activeEntry.jobId} titles={detail.sourceTitles} trails={activeTrails}
    boardCard={activeEntry} preference={brief?.feedback?.[activeEntry.id]} busy={busy || !!running} send={send} onConcept={onConcept} onTrail={onTrail}/>}
   {activeEntry && !detail && <p role={boardError ? "alert" : "status"}>{boardError || "Opening hypothesis…"}</p>}
   {!activeEntry && openCards.length > 0 && <p className="text-muted-foreground">Select a hypothesis on the map or from the list. Ideas without an Atlas connection are available in the list.</p>}
   {openCards.length > 0 && <details open={!activeEntry}><summary className="cursor-pointer">Hypotheses ({openCards.length})</summary>
    <ul className="mt-1 space-y-1">{openCards.map(card => <li key={card.id}>
     <button type="button" className="w-full rounded px-1 py-1 text-left hover:bg-accent aria-pressed:bg-accent"
      aria-pressed={card.id === selected} onClick={() => onSelect?.(card.id)}>
      <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full" style={{backgroundColor: FRONTIER_PRIORITIES[card.priority].color}}/>{card.title}
     </button>
    </li>)}</ul>
   </details>}
   {archive.length > 0 && <details><summary className="cursor-pointer">Archived ({archive.length})</summary><ul className="mt-1 space-y-2">
    {archive.map(card => <li key={card.id} className="flex items-center justify-between gap-2">
     <span>{card.title}</span><button type="button" className={button} disabled={busy || !!running}
      onClick={() => void send({action: "archive-opportunity", id: card.jobId, opportunityId: card.id, archived: false})}>Restore</button>
    </li>)}
   </ul></details>}
  </>}
  {brief && <p className="text-muted-foreground">
   {new Date(brief.date).toLocaleDateString()} · {brief.usage ? `${frontierTokens(brief.usage).toLocaleString()} reported tokens · ${brief.usage.steps} model calls` : "No model usage recorded"}
   {brief.selected.length < 3 && " · Fewer than three directions qualified"}
   {brief.previous.some(id => !brief.selected.includes(id)) && ` · ${brief.previous.filter(id => !brief.selected.includes(id)).length} left the brief`}
   {brief.stale && " · Showing the previously saved brief"}
  </p>}
  {brief?.note && <p>{brief.note}</p>}
  {progress && <DiscoveryProgress progress={progress}/>}
  {!!other.length && <details className="space-y-1"><summary className="cursor-pointer">Other assessed directions</summary>{other.map(o => display(o, -1))}</details>}
  {job?.status !== "done" && job && <p role={job.error ? "alert" : "status"}>{job.interrupted ? "Discovery was interrupted. Resume from saved progress or cancel." : job.error || job.activity}</p>}
  {job?.status === "error" && job.error !== "Cancelled" && <button type="button" className={button} disabled={busy}
   onClick={() => void send({action: "resume", id: job.id})}>Retry from saved progress</button>}
  {running && <div className="flex flex-wrap gap-2">
   {job.interrupted && <button className={button} disabled={busy} type="button" onClick={() => void send({action: "resume", id: job.id})}>Resume</button>}
   <button className={button} disabled={busy} type="button" onClick={() => void send({action: "cancel", id: job.id})}>Cancel</button>
  </div>}
  {!running && <form className="space-y-2" onSubmit={event => {event.preventDefault(); void start("start");}}>
   <label className="block">Discovery mode<select className={field} value={modeValue} onChange={e => {
    setMode(e.target.value === "adaptive" ? "adaptive" : "single"); setBudget(null); setSettings({});
   }}><option value="single">Single pass</option><option value="adaptive">Auto-discovery</option></select></label>
   <details className="space-y-2"><summary className="cursor-pointer">Discovery settings</summary>
    <label className="block">Research goal<textarea className={field} required maxLength={1000} value={goalValue} onChange={e => setGoal(e.target.value)}/></label>
    <label className="block">Token budget target<input className={field} type="number" required step={1} min={FRONTIER_TARGET} max={100000} value={budgetValue} onChange={e => setBudget(e.target.value)}/></label>
    {adaptive && ([
     ["patience", "Consecutive low-gain iterations", 1, 5, 1],
     ["minGain", "Minimum improvement points", 1, 20, 1],
     ["minValue", "Minimum action priority", 0.1, 10, 0.01],
    ] as const).map(([key, label, min, max, step]) => <label key={key} className="block">{label}
     <input className={field} type="number" required min={min} max={max} step={step} value={settings[key] ?? policy[key]}
      onChange={e => setSettings({...settings, [key]: e.target.value})}/>
    </label>)}
   </details>
   <p className="text-muted-foreground">{state?.model ? `Uses ${state.model}. Selected evidence is sent to the provider and usage charges may apply.` : "Choose a Researcher model in Settings → Agent → Models."}</p>
   <div className="flex flex-wrap gap-2">
    <button className={button} disabled={busy || (!state?.model && !brief)}>{adaptive ? "Start auto-discovery" : brief ? "Start research session" : "Build session brief"}</button>
    {brief && <button className={button} disabled={busy || !state?.model} type="button"
     onClick={() => void start("refresh")}>Refresh brief</button>}
   </div>
  </form>}
  {error && <p role="alert">{error}</p>}
 </section>;
}
