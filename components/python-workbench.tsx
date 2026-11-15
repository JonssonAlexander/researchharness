"use client";
import Image from "next/image";
import { useContext, useEffect, useState } from "react";
import type { PythonProject, PythonResult, PythonRun } from "@/src/core";
import { ChatActionsContext } from "./chat";
import { JobsContext } from "./jobs-context";
async function request(chatId: string, body?: unknown, query = "") {
    const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workbench${query}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error ?? "Workbench unavailable.");
    return data;
}
const button = "rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40";
export function PythonRunCard({ result }: {
    result: PythonResult;
}) {
    const actions = useContext(ChatActionsContext);
    return <section className="space-y-2 rounded-lg border bg-card p-3 text-sm" data-testid="python-result">
  <div className="flex items-center justify-between gap-2"><strong>{result.title}</strong><span className="text-xs text-muted-foreground">Python · {result.status}</span></div>
  {result.outputs.map(output => <a key={output.name} href={`/api/chats/${actions?.chatId}/workbench?run=${result.runId}&asset=${encodeURIComponent(output.name)}`} target="_blank" rel="noreferrer"><Image unoptimized loading="eager" width={1200} height={800} className="max-h-[480px] w-full rounded object-contain" alt={`${result.title}: ${output.name}`} src={`/api/chats/${actions?.chatId}/workbench?run=${result.runId}&asset=${encodeURIComponent(output.name)}`}/></a>)}
  {result.stdout && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{result.stdout}</pre>}
  {result.stderr && <details><summary className="text-xs text-muted-foreground">Execution log</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{result.stderr}</pre></details>}
  <button className={button} onClick={() => actions?.openWorkbench?.(result.runId)}>Code & parameters</button>
 </section>;
}
export function PythonWorkbenchPanel({ chatId, runId, onClose }: {
    chatId: string;
    runId: string | null;
    onClose: () => void;
}) {
    const jobs = useContext(JobsContext), [project, setProject] = useState<PythonProject | null>(null), [runs, setRuns] = useState<Pick<PythonRun, "id" | "title" | "status" | "kept">[]>([]), [selected, setSelected] = useState(runId), [run, setRun] = useState<PythonRun | null>(null), [code, setCode] = useState(""), [parameters, setParameters] = useState("{}"), [seed, setSeed] = useState(0), [title, setTitle] = useState("Experiment"), [folder, setFolder] = useState("My experiments"), [interpreter, setInterpreter] = useState("/usr/bin/python3"), [create, setCreate] = useState(true), [network, setNetwork] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false), [supported, setSupported] = useState(true);
    const refresh = async () => { const data = await request(chatId); setProject(data.project); setRuns(data.runs); setSupported(data.supported); if (data.suggestedInterpreter)
        setInterpreter(data.suggestedInterpreter); };
    useEffect(() => { void refresh().catch(e => setError(e.message)); }, [chatId, jobs]); // existing jobs channel; no extra polling
    useEffect(() => { if (!selected)
        return; void request(chatId, undefined, `?run=${encodeURIComponent(selected)}`).then(({ run }) => { setRun(run); setCode(run.code); setTitle(run.title); setParameters(JSON.stringify(run.parameters, null, 2)); setSeed(run.seed); }).catch(e => setError(e.message)); }, [chatId, selected]);
    useEffect(() => { if (!selected || run?.status !== "running")
        return; void request(chatId, undefined, `?run=${encodeURIComponent(selected)}`).then(({ run }) => setRun(run)).catch(e => setError(e.message)); }, [chatId, selected, jobs]);
    const act = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Workbench unavailable.");
    }
    finally {
        setBusy(false);
    } };
    return <aside role="dialog" aria-label="Python Workbench" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l bg-background shadow-xl">
  <header className="flex items-center justify-between border-b p-3"><h2 className="font-medium">Python Workbench</h2><button className={button} onClick={onClose}>Close</button></header>
  <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm">
   {!supported && <p>Local execution currently requires macOS. No unrestricted execution fallback is used.</p>}
   {project ? <div className="space-y-2"><p className="break-all text-xs text-muted-foreground">{project.path} · network {project.network ? "on" : "off"}</p><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => void act(async () => { await request(chatId, { action: "open" }); })}>Open in VS Code</button><button className={button} disabled={busy} onClick={() => void act(async () => { await request(chatId, { action: "configure", project: null }); await refresh(); })}>Disable access</button></div></div> : <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Enable one project for this session. Python may read its files; code and results may enter the conversation. Runs write only to their own folders. Existing files stay editable in VS Code. Don’t select a folder containing secrets.</p>
    <label className="block text-xs">Project<select className="mt-1 w-full rounded border bg-background p-2" value={create ? "new" : "existing"} onChange={e => { setCreate(e.target.value === "new"); setFolder(e.target.value === "new" ? "My experiments" : ""); }}><option value="new">Create in Documents / Research Atlas Experiments</option><option value="existing">Use an existing folder</option></select></label>
    <input aria-label="Project folder" className="w-full rounded border bg-background p-2" value={folder} onChange={e => setFolder(e.target.value)} placeholder={create ? "Project name" : "/absolute/path/to/project"}/>
    <label className="block text-xs">Python interpreter<input className="mt-1 w-full rounded border bg-background p-2" value={interpreter} onChange={e => setInterpreter(e.target.value)} placeholder="/path/to/project/.venv/bin/python"/></label>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={network} onChange={e => setNetwork(e.target.checked)}/>Allow network (for data downloads such as yfinance)</label>
    <button className={button} disabled={busy || !supported} onClick={() => void act(async () => { await request(chatId, { action: "configure", project: { path: folder, interpreter, network, create } }); await refresh(); })}>Enable project</button>
   </div>}
   <p className="text-xs text-muted-foreground">Ask in chat to simulate or calculate. The agent can inspect saved runs and rerun with changed assumptions. Install packages yourself in the selected Python environment.</p>
   {runs.length > 0 && <label className="block text-xs">Experiments<select className="mt-1 w-full rounded border bg-background p-2" value={selected ?? ""} onChange={e => setSelected(e.target.value)}><option value="">Choose a run</option>{runs.map(r => <option key={r.id} value={r.id}>{r.kept ? "★ " : ""}{r.title} · {r.status}</option>)}</select></label>}
   {run && <div className="space-y-3">
    <input aria-label="Experiment title" className="w-full rounded border bg-background p-2" value={title} onChange={e => setTitle(e.target.value)}/>
    <textarea aria-label="Python code" className="min-h-64 w-full rounded border bg-muted/30 p-2 font-mono text-xs" value={code} onChange={e => setCode(e.target.value)} spellCheck={false}/>
    <div className="flex gap-2"><label className="flex-1 text-xs">Parameters (JSON)<textarea className="mt-1 w-full rounded border bg-background p-2 font-mono" value={parameters} onChange={e => setParameters(e.target.value)}/></label><label className="w-24 text-xs">Seed<input type="number" className="mt-1 w-full rounded border bg-background p-2" value={seed} onChange={e => setSeed(Number(e.target.value))}/></label></div>
    <div className="flex flex-wrap gap-2">
     <button className={button} disabled={busy || !project} onClick={() => void act(async () => { const data = await request(chatId, { action: "run", requestId: crypto.randomUUID(), input: { title, code, parameters: JSON.parse(parameters), seed, timeout: run.timeout } }); setSelected(data.runId); await refresh(); })}>Run as new experiment</button>
     <button className={button} disabled={busy} onClick={() => void act(async () => { await request(chatId, { action: "keep", runId: run.id, kept: !run.kept }); setRun({ ...run, kept: !run.kept }); await refresh(); })}>{run.kept ? "Kept" : "Keep run"}</button>
     <button className={button} disabled={busy || !project} onClick={() => void act(async () => { await request(chatId, { action: "open", runId: run.id }); })}>Edit in VS Code</button>
     <button className={button} disabled={busy} onClick={() => void act(async () => { const data = await request(chatId, { action: "load-code", runId: run.id }); setCode(data.code); })}>Load file edits</button>
    </div>
    <details className="text-xs text-muted-foreground"><summary>Environment & reproducibility</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap">{JSON.stringify({ environment: run.environment, inputs: run.inputs, codeHash: run.codeHash, startedAt: run.startedAt, finishedAt: run.finishedAt, limitations: run.limitations }, null, 2)}</pre></details>
   </div>}
   {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
 </aside>;
}
