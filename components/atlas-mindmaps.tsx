"use client";

import { useEffect, useRef, useState } from "react";
import {MapProposalDialog} from "./map-proposal-review";
import type { AtlasSnapshot, Mindmap, MindmapInput } from "@/src/core";

const button = "rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50";
const field = "w-full rounded border bg-background px-2 py-1 text-xs";
const asset = (revision: string, kind: "original" | "preview") => `/api/atlas/mindmaps?revision=${revision}&kind=${kind}`;

export function AtlasMindmaps({snapshot, selectedId, refresh}: {
	snapshot: AtlasSnapshot; selectedId: string | null; refresh: () => Promise<void>;
}) {
	const [editing, setEditing] = useState<Omit<MindmapInput, "filename"> | null>(null);
	const [original, setOriginal] = useState<File | null>(null), [preview, setPreview] = useState<File | null>(null);
	const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
	const abort = useRef<AbortController | null>(null);
	useEffect(() => () => abort.current?.abort(), []);
	const maps = snapshot.mindmaps ?? [];
	function edit(map?: Mindmap) {
		const latest = map?.captures.find(c => c.id === map.currentRevision);
		setEditing({id: map?.id ?? `mm_${crypto.randomUUID()}`, captureId: `mr_${crypto.randomUUID()}`,
			expectedRevision: map?.revision ?? 0, title: map?.title ?? "",
			conceptIds: latest?.conceptIds.filter(id => snapshot.concepts.some(c => c.id === id)) ?? (selectedId ? [selectedId] : []),
			manualPreviewAcknowledged: false});
		setOriginal(null); setPreview(null); setError(null);
	}
	async function archive(map: Mindmap) {
		setBusy(true); setError(null);
		try {
			const response = await fetch("/api/atlas/mindmaps", {method: "PATCH", headers: {"content-type": "application/json"},
				body: JSON.stringify({id: map.id, expectedRevision: map.revision, archived: !map.archived})});
			const value = await response.json(); if (!response.ok) throw new Error(value.error);
			await refresh();
		} catch (error) { setError((error as Error).message); }
		finally { setBusy(false); }
	}
	async function upload(event: React.FormEvent) {
		event.preventDefault(); if (!editing || !original || busy) return;
		setBusy(true); setError(null); abort.current = new AbortController();
		try {
			const form = new FormData();
			form.set("metadata", JSON.stringify({...editing, filename: original.name}));
			form.set("original", original); if (preview) form.set("preview", preview);
			const response = await fetch("/api/atlas/mindmaps", {method: "POST", body: form, signal: abort.current.signal});
			const value = await response.json(); if (!response.ok) throw new Error(value.error);
			await refresh(); setEditing(null); setOriginal(null); setPreview(null);
		} catch (error) {
			setError((error as Error).name === "AbortError" ? "Import cancelled. Refresh the list before retrying if the save had already finished." : (error as Error).message);
		} finally { setBusy(false); abort.current = null; }
	}
	const linked = (map: Mindmap) => !selectedId || map.captures.some(c => c.conceptIds.includes(selectedId));
	return <details className="space-y-2 rounded border p-2 text-xs">
		<summary className="cursor-pointer font-medium">Mind maps{selectedId ? " · linked to this concept" : ""}</summary>
		<p className="text-muted-foreground">Import a saved .rnote file. Your original stays untouched; revisions and previews stay local. Concept links are references, not proof.</p>
		{!editing ? <button type="button" className={button} disabled={busy} onClick={() => edit()}>Import Rnote</button> :
			<form className="space-y-2" onSubmit={upload}>
				<label className="block">Map name<input className={field} required maxLength={160} disabled={busy} value={editing.title}
					onChange={e => setEditing({...editing, title: e.target.value})} /></label>
				<label className="block">Rnote original · up to 32 MB<input className="block w-full" type="file" accept=".rnote" required disabled={busy}
					onChange={e => { setOriginal(e.target.files?.[0] ?? null); setEditing({...editing, manualPreviewAcknowledged: false}); }} /></label>
				<details>
					<summary className="cursor-pointer text-muted-foreground">Optional PNG preview · up to 10 MB</summary>
					<p>Use this if automatic preview generation is unavailable.</p>
					<input aria-label="PNG preview" className="block w-full" type="file" accept=".png,image/png" disabled={busy}
						onChange={e => { setPreview(e.target.files?.[0] ?? null); setEditing({...editing, manualPreviewAcknowledged: false}); }} />
					{preview && <label className="flex gap-2"><input type="checkbox" required disabled={busy} checked={editing.manualPreviewAcknowledged}
						onChange={e => setEditing({...editing, manualPreviewAcknowledged: e.target.checked})} />This PNG was exported from the exact Rnote file selected above.</label>}
				</details>
				<details><summary className="cursor-pointer">Link concepts ({editing.conceptIds.length})</summary>
					{snapshot.concepts.map(c => <label key={c.id} className="flex gap-2"><input type="checkbox" disabled={busy}
						checked={editing.conceptIds.includes(c.id)} onChange={e => setEditing({...editing, conceptIds: e.target.checked ? [...editing.conceptIds,c.id] : editing.conceptIds.filter(id => id !== c.id)})} />{c.title}</label>)}
				</details>
				<button className={button} disabled={busy || !original || !editing.title.trim() || (!!preview && !editing.manualPreviewAcknowledged)}>{busy ? "Importing…" : "Save map revision"}</button>{" "}
				<button type="button" className={button} onClick={() => busy ? abort.current?.abort() : setEditing(null)}>Cancel</button>
			</form>}
		{error && <p role="alert" className="text-destructive">{error}</p>}
		{maps.filter(m => !m.archived && linked(m)).map(map => <MindmapCard key={map.id} map={map} snapshot={snapshot} selectedId={selectedId}
			busy={busy} onEdit={() => edit(map)} onArchive={() => void archive(map)} />)}
		{maps.some(m => m.archived && linked(m)) && <details><summary className="cursor-pointer text-muted-foreground">Archived maps</summary>
			{maps.filter(m => m.archived && linked(m)).map(map => <div key={map.id} className="flex items-center gap-2">
				<span>{map.title}</span><button type="button" className={button} disabled={busy} onClick={() => void archive(map)}>Restore</button>
			</div>)}
		</details>}
	</details>;
}
function MindmapCard({map, snapshot, selectedId, busy, onEdit, onArchive}: {
	map: Mindmap; snapshot: AtlasSnapshot; selectedId: string | null; busy: boolean; onEdit: () => void; onArchive: () => void;
}) {
	const [revision, setRevision] = useState<string | null>(null), [confirm, setConfirm] = useState(false);
	const [review,setReview] = useState(false);
	const [brokenPreview, setBrokenPreview] = useState<string | null>(null);
	const current = map.captures.find(c => c.id === map.currentRevision)!;
	const latest = selectedId && !current.conceptIds.includes(selectedId) ? [...map.captures].reverse().find(c => c.conceptIds.includes(selectedId))! : current;
	const capture = map.captures.find(c => c.id === (revision ?? latest.id))!;
	return <section className="space-y-2 rounded border p-2" aria-label={`Mind map ${map.title}`}>
		<h3 className="font-medium">{map.title}</h3>
		<label className="block">Source revision<select className={field} value={capture.id} onChange={e => setRevision(e.target.value)}>
			{map.captures.map((c,i) => <option key={c.id} value={c.id}>{i+1} · {new Date(c.capturedAt).toLocaleString()}{c.id === map.currentRevision ? " · current" : ""}</option>)}
		</select></label>
		{capture.previewHash && brokenPreview !== capture.id ? <a href={asset(capture.id,"preview")} target="_blank" rel="noreferrer">
			{/* eslint-disable-next-line @next/next/no-img-element -- bounded local source PNG; no image optimization or external host. */}
			<img src={asset(capture.id,"preview")} alt={`Preview of ${map.title}, source revision ${map.captures.indexOf(capture)+1}`} className="max-h-48 w-full rounded bg-white object-contain" onError={() => setBrokenPreview(capture.id)} />
		</a> : <p className="text-muted-foreground">Preview unavailable for this revision. The original remains downloadable.</p>}
		<p className="text-muted-foreground">{capture.validation === "rnote-cli" ? "Rnote format checked" : "Rnote format unchecked"} · {capture.previewKind === "manual-png" ? "Owner-supplied PNG" : capture.previewKind === "rnote-thumbnail" ? "Rnote thumbnail" : "No preview"}</p>
		{capture.notice && <p>{capture.notice}</p>}
		{capture.conceptIds.length > 0 && <p>References: {capture.conceptIds.map(id => snapshot.concepts.find(c => c.id === id)?.title ?? "Removed concept").join(", ")}</p>}
		<a className="underline" href={asset(capture.id,"original")}>Download Rnote original</a>
		<p className="text-muted-foreground">Edit the downloaded copy in Rnote, then import it as a new revision here.</p>
		<div className="flex flex-wrap gap-1">
			<button type="button" className={button} disabled={busy} onClick={()=>setReview(true)}>Interpret / review</button>
			<button type="button" className={button} disabled={busy} onClick={onEdit}>Import new revision</button>
			{confirm ? <><button type="button" className={button} disabled={busy} onClick={onArchive}>Confirm archive</button>
				<button type="button" className={button} disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></> :
				<button type="button" className={button} disabled={busy} onClick={() => setConfirm(true)}>Archive map</button>}
		</div>
		{review&&<MapProposalDialog key={capture.id} map={map} capture={capture} snapshot={snapshot} onClose={()=>setReview(false)} />}
	</section>;
}
