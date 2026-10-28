"use client";

import { useState } from "react";
import {
	CLAIM_STATUSES,
	RELATION_TYPES,
	REVIEW_STATUSES,
	type AtlasCommand,
	type AtlasRelation,
	type AtlasSnapshot,
	type RelationInput,
} from "@/src/core";

const field = "w-full rounded-md border bg-background px-2 py-1.5 text-xs";
const button = "rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50";
const words = (s: string) => s.replaceAll("-", " ");
const meaning = {
	prerequisite: "Source is a prerequisite for target",
	generalization: "Source generalizes target",
	analogy: "Source and target are analogous (both ways)",
	counterexample: "Source is a counterexample to target",
	application: "Source is applied to target",
	hypothesis: "Source has a hypothesized connection to target",
};

export function AtlasRelations({
	conceptId,
	snapshot,
	save,
	onSelect,
}: {
	conceptId: string;
	snapshot: AtlasSnapshot;
	save: (command: AtlasCommand) => Promise<void>;
	onSelect: (id: string) => void;
}) {
	const [draft, setDraft] = useState<RelationInput | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const name = (id: string) => snapshot.concepts.find((c) => c.id === id)?.title ?? "Unavailable concept";
	const links = snapshot.relations.filter((r) => r.sourceId === conceptId || r.targetId === conceptId);
	function edit(relation?: AtlasRelation) {
		setError(null);
		setDraft(
			relation
				? {
						kind: "relation",
						id: relation.id,
						expectedRevision: relation.revision,
						sourceId: relation.sourceId,
						targetId: relation.targetId,
						relationType: relation.relationType,
						conditions: relation.conditions,
						claimStatus: relation.claimStatus,
						reviewStatus: relation.reviewStatus,
						evidence: relation.evidence,
					}
				: {
						kind: "relation",
						id: `ar_${crypto.randomUUID()}`,
						expectedRevision: 0,
						sourceId: conceptId,
						targetId: snapshot.concepts.find((c) => c.id !== conceptId)?.id ?? "",
						relationType: "prerequisite",
						conditions: "",
						claimStatus: "hypothesis",
						reviewStatus: "proposed",
						evidence: [],
					},
		);
	}
	async function submit() {
		if (!draft || busy) return;
		setBusy(true);
		setError(null);
		try {
			await save(draft);
			setDraft(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Link could not be saved.");
		} finally {
			setBusy(false);
		}
	}
	return (
		<section aria-label="Concept links" className="space-y-2 border-y py-2 text-xs">
			<h3 className="font-medium">Concept links</h3>
			<p className="text-muted-foreground">
				Dashed lines show accepted concept links. They are not proof arrows.
			</p>
			{draft ? (
				<div className="space-y-2">
					<fieldset disabled={busy} className="space-y-2">
						{(["sourceId", "targetId"] as const).map((key) => (
							<label key={key} className="block space-y-1">
								{key === "sourceId" ? "Source concept" : "Target concept"}
								<select
									className={field}
									value={draft[key]}
									onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
								>
									<option value="" disabled>
										Choose concept
									</option>
									{snapshot.concepts.map((c) => (
										<option key={c.id} value={c.id}>
											{c.title}
										</option>
									))}
								</select>
							</label>
						))}
						<label className="block space-y-1">
							Link type
							<select
								className={field}
								value={draft.relationType}
								onChange={(e) =>
									setDraft({ ...draft, relationType: e.target.value as RelationInput["relationType"] })
								}
							>
								{RELATION_TYPES.map((v) => (
									<option key={v} value={v}>
										{words(v)}
									</option>
								))}
							</select>
						</label>
						<p>{meaning[draft.relationType]}</p>
						<label className="block space-y-1">
							Conditions and scope
							<textarea
								className={field}
								maxLength={4000}
								rows={3}
								value={draft.conditions}
								onChange={(e) => setDraft({ ...draft, conditions: e.target.value })}
							/>
						</label>
						<label className="block space-y-1">
							Claim status
							<select
								className={field}
								value={draft.claimStatus}
								onChange={(e) =>
									setDraft({ ...draft, claimStatus: e.target.value as RelationInput["claimStatus"] })
								}
							>
								{CLAIM_STATUSES.map((v) => (
									<option key={v} value={v}>
										{words(v)}
									</option>
								))}
							</select>
						</label>
						<label className="block space-y-1">
							Review status
							<select
								className={field}
								value={draft.reviewStatus}
								onChange={(e) =>
									setDraft({ ...draft, reviewStatus: e.target.value as RelationInput["reviewStatus"] })
								}
							>
								{REVIEW_STATUSES.map((v) => (
									<option key={v} value={v}>
										{words(v)}
									</option>
								))}
							</select>
						</label>
						<p className="text-muted-foreground">
							Accepted means you chose to keep this link. Claim status is your assessment; sources are not
							verified by the app.
						</p>
						{draft.evidence.map((source, index) => (
							<fieldset key={index} className="space-y-1 rounded border p-2">
								<legend>Source {index + 1}</legend>
								<label className="block">
									Citation
									<textarea
										className={field}
										maxLength={2000}
										value={source.citation}
										onChange={(e) =>
											setDraft({
												...draft,
												evidence: draft.evidence.map((s, i) =>
													i === index ? { ...s, citation: e.target.value } : s,
												),
											})
										}
									/>
								</label>
								<label className="block">
									Page, section or reference
									<input
										className={field}
										maxLength={1000}
										value={source.locator}
										onChange={(e) =>
											setDraft({
												...draft,
												evidence: draft.evidence.map((s, i) =>
													i === index ? { ...s, locator: e.target.value } : s,
												),
											})
										}
									/>
								</label>
								<button
									type="button"
									className={button}
									onClick={() =>
										setDraft({ ...draft, evidence: draft.evidence.filter((_, i) => i !== index) })
									}
								>
									Remove source
								</button>
							</fieldset>
						))}
						<button
							type="button"
							className={button}
							disabled={draft.evidence.length >= 20}
							onClick={() =>
								setDraft({ ...draft, evidence: [...draft.evidence, { citation: "", locator: "" }] })
							}
						>
							Add source
						</button>
					</fieldset>
					{error && (
						<p role="alert" className="text-destructive">
							{error}
						</p>
					)}
					<div className="flex gap-2">
						<button type="button" disabled={busy} className={button} onClick={() => void submit()}>
							{busy ? "Saving…" : "Save link"}
						</button>
						<button type="button" disabled={busy} className={button} onClick={() => setDraft(null)}>
							Cancel link
						</button>
					</div>
				</div>
			) : (
				<>
					{links.map((r) => (
						<article key={r.id} className="space-y-1 rounded border p-2">
							<div>
								<button type="button" className="underline" onClick={() => onSelect(r.sourceId)}>
									{name(r.sourceId)}
								</button>
								{r.relationType === "analogy" ? " ↔ " : " → "}
								<button type="button" className="underline" onClick={() => onSelect(r.targetId)}>
									{name(r.targetId)}
								</button>
							</div>
							<p>
								{words(r.relationType)} · {words(r.reviewStatus)} · {words(r.claimStatus)}
							</p>
							<p className="text-muted-foreground">{meaning[r.relationType]}</p>
							{r.conditions && <p className="whitespace-pre-wrap">{r.conditions}</p>}
							{r.evidence.map((e, i) => (
								<p key={i} className="whitespace-pre-wrap border-l pl-2">
									{e.citation}
									{e.locator ? ` · ${e.locator}` : ""}
								</p>
							))}
							{!r.evidence.length && <p className="text-muted-foreground">No source cited</p>}
							<button type="button" className={button} onClick={() => edit(r)}>
								Edit link
							</button>
						</article>
					))}
					{!links.length && <p className="text-muted-foreground">No links yet.</p>}
					<button
						type="button"
						className={button}
						disabled={snapshot.concepts.length < 2}
						onClick={() => edit()}
					>
						New link
					</button>
				</>
			)}
		</section>
	);
}
