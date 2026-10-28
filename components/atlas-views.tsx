"use client";

import { useState } from "react";
import type { AtlasCommand, AtlasView } from "@/src/core";

export interface AtlasViewActions {
	canSave: boolean;
	capture: () => Pick<AtlasView, "camera" | "query"> | null;
	restore: (view: AtlasView) => void;
}
const button = "rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50";
export function AtlasViews({ views, save, actions }: {
	views: AtlasView[]; save: (command: AtlasCommand) => Promise<void>; actions: AtlasViewActions;
}) {
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);
	async function submit(command: AtlasCommand) {
		setBusy(true); setError(null);
		try { await save(command); setTitle(""); setRemoving(null); }
		catch (error) { setError((error as Error).message); }
		finally { setBusy(false); }
	}
	return <details className="space-y-2 rounded border p-2 text-xs">
		<summary className="cursor-pointer font-medium">Saved views</summary>
		<p className="text-muted-foreground">Remember the camera and search filter. Node positions stay shared.</p>
		<form className="flex gap-1" onSubmit={event => {
			event.preventDefault();
			const current = actions.capture();
			if (!current || !actions.canSave || busy) return;
			void submit({kind: "view", id: `av_${crypto.randomUUID()}`, expectedRevision: 0, title, ...current});
		}}>
			<input aria-label="View name" className="min-w-0 flex-1 rounded border bg-background px-2 py-1" required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} />
			<button className={button} disabled={busy || !actions.canSave || !title.trim()}>Save view</button>
		</form>
		{!actions.canSave && <p className="text-muted-foreground">Show the full graph before saving a view.</p>}
		{views.map(view => <div key={view.id} className="flex flex-wrap items-center gap-1">
			<button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" disabled={busy} onClick={() => actions.restore(view)}>{view.title}</button>
			{removing === view.id ? <>
				<button type="button" className={button} disabled={busy} onClick={() => void submit({kind: "view-delete", id: view.id, expectedRevision: view.revision})}>Confirm removal</button>
				<button type="button" className={button} disabled={busy} onClick={() => setRemoving(null)}>Cancel</button>
			</> : <button type="button" className={button} aria-label={`Remove view ${view.title}`} disabled={busy} onClick={() => setRemoving(view.id)}>Remove</button>}
		</div>)}
		{error && <p role="alert" className="text-destructive">{error}</p>}
	</details>;
}
