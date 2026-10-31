"use client";

import { useEffect, useMemo, useState } from "react";
import { findAtlasPath, type AtlasPathFocus, type AtlasSnapshot } from "@/src/core";

const field = "w-full rounded-md border bg-background px-2 py-1.5 text-xs";
const button = "rounded-md border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50";
export function AtlasQuery({
	snapshot,
	selectedId,
	onSelect,
	onFocus,mapId,
}: {
	snapshot: AtlasSnapshot;
	selectedId: string | null;
	onSelect: (id: string) => void;
	onFocus?: (focus: AtlasPathFocus | null) => void;mapId?:string|null;
}) {
	const [sourceId, setSourceId] = useState<string | null>(null);
	const [targetId, setTargetId] = useState("");
	const [query, setQuery] = useState<{ sourceId: string; targetId: string } | null>(null);
	const [focused, setFocused] = useState(false);
	const result = useMemo(
		() => (query ? findAtlasPath(snapshot, query.sourceId, query.targetId) : null),
		[query, snapshot],
	);
	useEffect(()=>{if(mapId){setFocused(false);setQuery(null);}},[mapId]);
	const source = sourceId ?? selectedId ?? "";
	const name = (id: string) => snapshot.concepts.find((c) => c.id === id)?.title ?? "Unavailable concept";
	useEffect(() => {
		if (!onFocus) return;
		onFocus(
			focused && result?.status === "found"
				? {
						conceptIds: [result.steps[0]!.fromId, ...result.steps.map((s) => s.toId)],
						relationIds: result.steps.map((s) => s.relation.id),
					}
				: null,
		);
	}, [focused, result, onFocus]);
	useEffect(() => () => onFocus?.(null), [onFocus]);
	function clear() {
		setQuery(null);
		setFocused(false);
	}
	return (
		<details className="space-y-2 rounded border p-2 text-xs">
			<summary className="cursor-pointer font-medium">Find a connection</summary>
			<p className="text-muted-foreground">
				One shortest path through accepted links with citations. A connection is not a proof; citations are
				owner-entered and unverified.
			</p>
			<form
				className="space-y-2"
				onSubmit={(e) => {
					e.preventDefault();
					setFocused(false);
					setSourceId(source);
					setQuery({ sourceId: source, targetId });
				}}
			>
				<label className="block space-y-1">
					From concept
					<select
						className={field}
						value={source}
						onChange={(e) => {
							setSourceId(e.target.value);
							clear();
						}}
					>
						<option value="">Choose concept</option>
						{snapshot.concepts.map((c) => (
							<option key={c.id} value={c.id}>
								{c.title}
							</option>
						))}
					</select>
				</label>
				<label className="block space-y-1">
					To concept
					<select
						className={field}
						value={targetId}
						onChange={(e) => {
							setTargetId(e.target.value);
							clear();
						}}
					>
						<option value="">Choose concept</option>
						{snapshot.concepts.map((c) => (
							<option key={c.id} value={c.id}>
								{c.title}
							</option>
						))}
					</select>
				</label>
				<button type="submit" className={button} disabled={!source || !targetId || source === targetId}>
					Find path
				</button>
				{query && (
					<button type="button" className={button} onClick={clear}>
						Clear query
					</button>
				)}
			</form>
			<div aria-live="polite" className="space-y-2">
				{result?.status === "invalid" && <p>Choose two distinct concepts that still exist.</p>}
				{result?.status === "no-path" && (
					<p>No supported path found through accepted, cited links in this direction.</p>
				)}
				{result?.status === "limited" && (
					<p>
						Search limit reached (6 links, 2,000 concepts or 10,000 records). A path may exist beyond this
						search.
					</p>
				)}
				{result?.status === "found" && (
					<>
						<p>
							{name(query!.sourceId)} → {name(query!.targetId)} · {result.steps.length} link(s)
						</p>
						<ol className="space-y-2">
							{result.steps.map((step, index) => (
								<li key={step.relation.id} className="space-y-1 rounded border p-2">
									<p>
										{index + 1}.{" "}
										<button type="button" className="underline" onClick={() => onSelect(step.fromId)}>
											{name(step.fromId)}
										</button>
										{step.relation.relationType === "analogy" ? " ↔ " : " → "}
										<button type="button" className="underline" onClick={() => onSelect(step.toId)}>
											{name(step.toId)}
										</button>
									</p>
									<p>
										{step.relation.relationType} · {step.relation.reviewStatus} ·{" "}
										{step.relation.claimStatus.replaceAll("-", " ")}
									</p>
									<p className="whitespace-pre-wrap">
										Conditions: {step.relation.conditions || "None recorded"}
									</p>
									{step.relation.evidence.map((e, i) => (
										<p key={i} className="whitespace-pre-wrap border-l pl-2">
											{e.citation}
											{e.locator ? ` · ${e.locator}` : ""}
										</p>
									))}
								</li>
							))}
						</ol>
						{onFocus && (
							<button type="button" className={button} onClick={() => setFocused(!focused)}>
								{focused ? "Show full graph" : "Show path in graph"}
							</button>
						)}
					</>
				)}
			</div>
		</details>
	);
}
