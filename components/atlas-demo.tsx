"use client";
import { useState } from "react";
import {
	createAtlasDemo,
	isAtlasDemoId,
	removeAtlasDemo,
	type AtlasCommand,
	type AtlasSnapshot,
} from "@/src/core";

export function AtlasDemo({
	snapshot,
	save,
}: {
	snapshot: AtlasSnapshot;
	save: (c: AtlasCommand) => Promise<void>;
}) {
	const [busy, setBusy] = useState(false),
		[confirm, setConfirm] = useState(false),
		[error, setError] = useState<string | null>(null);
	const present = [...snapshot.concepts, ...snapshot.subjects, ...snapshot.relations].some((r) =>
		isAtlasDemoId(r.id),
	);
	async function run(remove: boolean) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const commands = remove ? removeAtlasDemo(snapshot) : createAtlasDemo(crypto.randomUUID().slice(-12));
			for (const command of commands) await save(command);
			setConfirm(false);
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Demo update failed. You can clear partial demo data and retry.",
			);
		} finally {
			setBusy(false);
		}
	}
	const button = "rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50";
	return (
		<details className="space-y-2 rounded border p-2 text-xs">
			<summary className="cursor-pointer">Demo data</summary>
			<p>
				3 subjects, 9 concepts and 9 illustrative links. Demo claims and citations are placeholders. Removal
				keeps an archive.
			</p>
			<button type="button" className={button} disabled={busy || present} onClick={() => void run(false)}>
				{busy ? "Working…" : "Load demo"}
			</button>
			{present && (
				<button type="button" className={button} disabled={busy} onClick={() => setConfirm(!confirm)}>
					Remove demo
				</button>
			)}
			{present && confirm && (
				<>
					<p>
						Remove all demo subjects, concepts and links, including your edits to them? Your other items stay.
					</p>
					<button type="button" className={button} disabled={busy} onClick={() => void run(true)}>
						Confirm remove demo
					</button>
				</>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
		</details>
	);
}
