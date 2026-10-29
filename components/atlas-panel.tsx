"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	type AtlasCommand,
	type AtlasPathFocus,
	type AtlasConcept,
	type AtlasSnapshot,
	type AtlasSubject,
	type GraphNode,
} from "@/src/core";
import { AtlasMindmaps } from "./atlas-mindmaps";
import { AtlasViews, type AtlasViewActions } from "./atlas-views";
import { AtlasDemo } from "./atlas-demo";
import { AtlasQuery } from "./atlas-query";
import { AtlasRelations } from "./atlas-relations";
import { MessageResponse } from "./ai-elements/message";
import { useServerEvent, useServerResync } from "./server-events";

const EMPTY: AtlasSnapshot = { concepts: [], subjects: [], relations: [] };
const field = "w-full rounded-md border bg-background px-2 py-1.5 text-xs";
const button = "rounded-md border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50";

export function useAtlas() {
	const [snapshot, setSnapshot] = useState(EMPTY);
	const [error, setError] = useState<string | null>(null);
	const sequence = useRef(0);
	const refresh = useCallback(async () => {
		const request = ++sequence.current;
		try {
			const response = await fetch("/api/atlas", { cache: "no-store" });
			const value = await response.json();
			if (request !== sequence.current) return;
			if (!response.ok) throw new Error(value.error || "Atlas is unavailable.");
			setSnapshot(value);
			setError(null);
		} catch (error) {
			if (request === sequence.current)
				setError(error instanceof Error ? error.message : "Atlas is unavailable.");
		}
	}, []);
	useEffect(() => {
		void refresh();
		return () => {
			sequence.current++;
		};
	}, [refresh]);
	useServerEvent("atlas-changed", () => {
		void refresh();
	});
	useServerResync(() => {
		void refresh();
	});
	async function save(command: AtlasCommand) {
		const response = await fetch("/api/atlas", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(command),
		});
		const value = await response.json();
		if (!response.ok) throw new Error(value.error || "Atlas could not be saved.");
		await refresh();
	}
	return { snapshot, error, refresh, save };
}

export function AtlasPanel({
	atlas,
	selectedId,
	onSelect,
	onClose,
	propositions,
	onFocus,
	onRelax,
	viewActions,
}: {
	atlas: ReturnType<typeof useAtlas>;
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	onClose: () => void;
	propositions: GraphNode[];
	onFocus?: (focus: AtlasPathFocus | null) => void;
	onRelax?: (subjectId: string | null) => void;
	viewActions?: AtlasViewActions;
}) {
	const [editing, setEditing] = useState<Extract<AtlasCommand, { kind: "concept" | "subject" }> | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const selected = atlas.snapshot.concepts.find((c) => c.id === selectedId);
	useEffect(() => {
		setEditing(null);
		setError(null);
	}, [selectedId]);
	function editConcept(concept?: AtlasConcept) {
		setError(null);
		setConfirmDelete(false);
		setEditing(
			concept
				? {
						kind: "concept",
						id: concept.id,
						title: concept.title,
						aliases: concept.aliases,
						markdown: concept.markdown ?? "",
						subjectIds: concept.subjectIds,
						preferredSubjectId: concept.preferredSubjectId,
						propositionIds: concept.propositionIds,
						expectedRevision: concept.revision,
					}
				: {
						kind: "concept",
						id: `ac_${crypto.randomUUID()}`,
						expectedRevision: 0,
						title: "",
						aliases: [],
						subjectIds: [],
						preferredSubjectId: null,
						propositionIds: [],
					},
		);
	}
	function editSubject(subject?: AtlasSubject) {
		setError(null);
		setConfirmDelete(false);
		setEditing({
			kind: "subject",
			id: subject?.id ?? `as_${crypto.randomUUID()}`,
			expectedRevision: subject?.revision ?? 0,
			title: subject?.title ?? "",
			color: subject?.color ?? "#65a3dc",
			parentId: subject?.parentId ?? null,
		});
	}
	async function submit(command: AtlasCommand | null = editing) {
		if (!command || busy) return;
		setBusy(true);
		setError(null);
		try {
			await atlas.save(command);
			if (command.kind === "concept") onSelect(command.id);
			if (command.kind === "concept-delete") onSelect(null);
			setEditing(null);
		} catch (error) {
			setError(error instanceof Error ? error.message : "Could not save Atlas.");
		} finally {
			setBusy(false);
		}
	}
	return (
		<aside
			aria-label="Atlas concepts"
			className="lh-no-drag absolute bottom-36 right-3 top-14 z-20 flex w-80 max-w-[calc(100%-1.5rem)] flex-col rounded-xl border bg-card/95 p-3 shadow-xl backdrop-blur"
		>
			<div className="mb-3 flex items-center justify-between text-sm font-medium">
				<span>Atlas</span>
				<button type="button" aria-label="Close Atlas" onClick={onClose} className={button}>
					×
				</button>
			</div>
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
				{atlas.error && (
					<p role="alert" className="text-xs text-destructive">
						{atlas.error}
					</p>
				)}
				{viewActions && <AtlasViews views={atlas.snapshot.views ?? []} save={atlas.save} actions={viewActions} />}
				<AtlasMindmaps snapshot={atlas.snapshot} selectedId={selectedId} refresh={atlas.refresh} />
				{editing ? (
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							void submit();
						}}
					>
						<h2 className="text-xs font-medium">
							{editing.expectedRevision ? "Edit" : "New"} {editing.kind}
						</h2>
						<label className="block space-y-1 text-xs">
							Name
							<input
								required
								autoFocus
								maxLength={160}
								className={field}
								value={editing.title}
								onChange={(e) => setEditing({ ...editing, title: e.target.value })}
							/>
						</label>
						{editing.kind === "subject" ? (
							<>
								<label className="flex items-center justify-between text-xs">
									Colour
									<input
										aria-label="Subject colour"
										type="color"
										value={editing.color}
										onChange={(e) => setEditing({ ...editing, color: e.target.value })}
									/>
								</label>
								<label className="block space-y-1 text-xs">
									Parent subject
									<select
										className={field}
										value={editing.parentId ?? ""}
										onChange={(e) => setEditing({ ...editing, parentId: e.target.value || null })}
									>
										<option value="">None</option>
										{atlas.snapshot.subjects
											.filter((s) => s.id !== editing.id)
											.map((s) => (
												<option key={s.id} value={s.id}>
													{s.title}
												</option>
											))}
									</select>
								</label>
							</>
						) : (
							<>
								<label className="block space-y-1 text-xs">
									Notes (Markdown / LaTeX)
									<textarea
										className={field}
										rows={8}
										maxLength={16000}
										value={editing.markdown ?? ""}
										onChange={(e) => setEditing({ ...editing, markdown: e.target.value })}
									/>
								</label>
								<label className="block space-y-1 text-xs">
									Aliases
									<input
										key={editing.id}
										className={field}
										defaultValue={editing.aliases.join(", ")}
										onChange={(e) =>
											setEditing({
												...editing,
												aliases: e.target.value
													.split(",")
													.map((s) => s.trim())
													.filter(Boolean),
											})
										}
									/>
								</label>
								<fieldset className="space-y-1 text-xs">
									<legend className="mb-1 text-muted-foreground">Subjects</legend>
									{atlas.snapshot.subjects.map((subject) => (
										<label key={subject.id} className="flex items-center gap-2">
											<input
												type="checkbox"
												checked={editing.subjectIds.includes(subject.id)}
												onChange={(e) => {
													const ids = e.target.checked
														? [...editing.subjectIds, subject.id]
														: editing.subjectIds.filter((id) => id !== subject.id);
													setEditing({
														...editing,
														subjectIds: ids,
														preferredSubjectId: ids.includes(editing.preferredSubjectId ?? "")
															? editing.preferredSubjectId
															: (ids[0] ?? null),
													});
												}}
											/>
											{subject.title}
										</label>
									))}
									{!atlas.snapshot.subjects.length && (
										<p className="text-muted-foreground">Add subjects to organise your concepts.</p>
									)}
								</fieldset>
								{editing.subjectIds.length > 0 && (
									<label className="block space-y-1 text-xs">
										Display in
										<select
											className={field}
											value={editing.preferredSubjectId ?? ""}
											onChange={(e) => setEditing({ ...editing, preferredSubjectId: e.target.value })}
										>
											{atlas.snapshot.subjects
												.filter((s) => editing.subjectIds.includes(s.id))
												.map((s) => (
													<option key={s.id} value={s.id}>
														{s.title}
													</option>
												))}
										</select>
									</label>
								)}
								<fieldset className="space-y-1 text-xs">
									<legend className="mb-1 text-muted-foreground">Linked propositions</legend>
									{propositions.map((p) => (
										<label key={p.id} className="flex items-start gap-2">
											<input
												type="checkbox"
												className="mt-0.5"
												checked={editing.propositionIds.includes(p.id)}
												onChange={(e) =>
													setEditing({
														...editing,
														propositionIds: e.target.checked
															? [...editing.propositionIds, p.id]
															: editing.propositionIds.filter((id) => id !== p.id),
													})
												}
											/>
											<span title={p.statement}>{p.name}</span>
										</label>
									))}
									{editing.propositionIds
										.filter((id) => !propositions.some((p) => p.id === id))
										.map((id) => (
											<label key={id} className="flex items-center gap-2">
												<input
													type="checkbox"
													checked
													onChange={() =>
														setEditing({
															...editing,
															propositionIds: editing.propositionIds.filter((p) => p !== id),
														})
													}
												/>
												Unavailable proposition
											</label>
										))}
									{!propositions.length && (
										<p className="text-muted-foreground">Propositions from your sessions will appear here.</p>
									)}
								</fieldset>
							</>
						)}
						{editing.kind === "subject" && editing.expectedRevision > 0 && (
							<div className="space-y-2 border-t pt-2 text-xs">
								<button
									type="button"
									disabled={busy}
									className={button}
									onClick={() => setConfirmDelete(!confirmDelete)}
								>
									Delete subject
								</button>
								{confirmDelete && (
									<>
										<p>Delete this subject? Concepts and propositions stay.</p>
										{atlas.snapshot.concepts
											.filter((c) => c.subjectIds.includes(editing.id))
											.map((c) => (
												<p key={c.id}>Move concept first: {c.title}</p>
											))}
										{atlas.snapshot.subjects
											.filter((s) => s.parentId === editing.id)
											.map((s) => (
												<p key={s.id}>Move child subject first: {s.title}</p>
											))}
										<button
											type="button"
											className={button}
											disabled={
												busy ||
												atlas.snapshot.concepts.some((c) => c.subjectIds.includes(editing.id)) ||
												atlas.snapshot.subjects.some((s) => s.parentId === editing.id)
											}
											onClick={() =>
												void submit({
													kind: "subject-delete",
													id: editing.id,
													expectedRevision: editing.expectedRevision,
												})
											}
										>
											Confirm delete
										</button>
									</>
								)}
							</div>
						)}
						{editing.kind === "concept" && editing.expectedRevision > 0 && (
							<div className="space-y-2 border-t pt-2 text-xs">
								<button
									type="button"
									disabled={busy}
									className={button}
									onClick={() => setConfirmDelete(!confirmDelete)}
								>
									Delete concept
								</button>
								{confirmDelete && (
									<>
										<p>
											Remove this concept and its memberships? Propositions stay. Notes and a copy of this
											concept are archived.
										</p>
										{atlas.snapshot.relations
											.filter((r) => r.sourceId === editing.id || r.targetId === editing.id)
											.map((r) => (
												<p key={r.id}>Delete link first: {r.relationType}</p>
											))}
										<button
											type="button"
											className={button}
											disabled={
												busy ||
												atlas.snapshot.relations.some(
													(r) => r.sourceId === editing.id || r.targetId === editing.id,
												)
											}
											onClick={() =>
												void submit({
													kind: "concept-delete",
													id: editing.id,
													expectedRevision: editing.expectedRevision,
												})
											}
										>
											Confirm delete concept
										</button>
									</>
								)}
							</div>
						)}
						{error && (
							<p role="alert" className="text-xs text-destructive">
								{error}
							</p>
						)}
						<div className="flex gap-2">
							<button disabled={busy} className={button} type="submit">
								{busy ? "Saving…" : "Save"}
							</button>
							<button
								disabled={busy}
								className={button}
								type="button"
								onClick={() => {
									setEditing(null);
									setError(null);
								}}
							>
								Cancel
							</button>
						</div>
					</form>
				) : (
					<>
						<div className="flex gap-2">
							<button type="button" className={button} onClick={() => editConcept()}>
								New concept
							</button>
							<button type="button" className={button} onClick={() => editSubject()}>
								New subject
							</button>
						</div>
						<AtlasDemo snapshot={atlas.snapshot} save={atlas.save} />
						<AtlasQuery
							snapshot={atlas.snapshot}
							selectedId={selectedId}
							onSelect={onSelect}
							onFocus={onFocus}
						/>
						{selected && (
							<section className="space-y-2 border-b pb-3 text-xs">
								<div className="text-muted-foreground">Concept</div>
								<h2 className="text-sm font-medium">{selected.title}</h2>
								{selected.aliases.length > 0 && (
									<p className="text-muted-foreground">{selected.aliases.join(", ")}</p>
								)}
								{selected.markdown && <MessageResponse mode="static">{selected.markdown}</MessageResponse>}
								<AtlasRelations
									key={selected.id}
									conceptId={selected.id}
									snapshot={atlas.snapshot}
									save={atlas.save}
									onSelect={onSelect}
								/>
								<div className="flex flex-wrap gap-1">
									{atlas.snapshot.subjects
										.filter((s) => selected.subjectIds.includes(s.id))
										.map((s) => (
											<span
												key={s.id}
												className="rounded border px-1.5 py-0.5"
												style={{ borderColor: s.color }}
											>
												{s.title}
												{s.id === selected.preferredSubjectId ? " · home" : ""}
											</span>
										))}
								</div>
								{selected.propositionIds.map((id) => {
									const p = propositions.find((p) => p.id === id);
									return (
										<div key={id} className="border-l pl-2">
											<strong>{p?.name ?? "Unavailable proposition"}</strong>
											{p && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{p.statement}</p>}
										</div>
									);
								})}
								<button type="button" className={button} onClick={() => editConcept(selected)}>
									Edit concept
								</button>
							</section>
						)}
						<input
							aria-label="Find concepts"
							placeholder="Find concepts…"
							className={field}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
						<div className="space-y-1">
							{atlas.snapshot.concepts
								.filter((c) =>
									[c.title, ...c.aliases].some((s) => s.toLowerCase().includes(query.toLowerCase())),
								)
								.map((c) => (
									<button
										key={c.id}
										type="button"
										onClick={() => onSelect(c.id)}
										className={`block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent ${c.id === selectedId ? "bg-accent" : ""}`}
									>
										{c.title}
									</button>
								))}
							{!atlas.snapshot.concepts.length && (
								<p className="text-xs text-muted-foreground">Create a concept to begin your Atlas.</p>
							)}
						</div>
						<details className="text-xs">
							<summary className="cursor-pointer text-muted-foreground">Subjects</summary>
							<p className="mt-2 text-muted-foreground">Drag a subject title in the graph to move its group.</p>
							<div className="mt-2 space-y-1">
								{atlas.snapshot.subjects.map((s) => (
									<div key={s.id} className="flex items-center gap-1">
									<button
										type="button"
										onClick={() => editSubject(s)}
										className="block w-full rounded-md px-2 py-1 text-left hover:bg-accent"
									>
										<span style={{ color: s.color }}>●</span> {s.title}
									</button>
									<button type="button" className={button} aria-label={`Arrange ${s.title}`} disabled={busy || s.locked} onClick={() => onRelax?.(s.id)}>Arrange</button>
									<button type="button" className={button} aria-label={`${s.locked ? "Unlock" : "Lock"} ${s.title}`} disabled={busy} aria-pressed={!!s.locked}
										onClick={() => void submit({kind: "subject-lock", id: s.id, expectedRevision: s.revision, locked: !s.locked})}>
										{s.locked ? "Unlock" : "Lock"}
									</button>
									</div>
								))}
							</div>
						</details>
					</>
				)}
			</div>
		</aside>
	);
}
