# Conversational lesson workspace

New Teach sessions opt into `learning:true`. Existing sessions and API callers without the flag retain the legacy flow. Practice ignores it. Lessons use the same native history, one-active-turn gate, model selection, usage, jobs, interruptions, and replay. Their dedicated tutor uses the [learning policy](learning-policy.md) and [bounded delivery context](lesson-delivery.md). Legacy probe, quiz, question, and plan-init tools belong to the legacy flow.

## Work through a lesson

The objective and editable map stay available beside the conversation. Main topics form a solid teaching thread in array order. Detail nodes sit with a parent, tangents remain branches, and ordinary associations stay dotted. The thread describes lesson order. Proof and mastery live elsewhere.

Begin with an objective and a conceptual map. Develop related ideas, results, and derivations in coherent exchanges. Let the learner choose depth, help, and tangents. The approved pacing targets are 30–60 minutes for a substantial lesson and roughly 2–4 exchanges for a focused derivation. These are guides. The learner controls finishing.

A derivation keeps **Start** (assumptions, definitions, and allowed results) and **Finish** (the precise target) visible. Returning to the lesson preserves the target, active work, and prior revisions. Continue on the same editable [scratchpad](atlas-scratchpad.md) and submit handwriting plus text or dictation explicitly. Review prior attempts, assistance, and gaps before drawing conclusions about independence.

Clicking a topic inspects it. **Continue here** saves focus and sends a normal learner turn only if the save succeeds. Unrelated active derivations are cleared from focus with their work retained. Now/Next follows the main route and skips explored topics and tangents. Older lessons without progress fields read as upcoming. Coverage describes what was discussed.

The owner finishes or reopens a lesson or derivation. **Review lesson** prepares the [explicit integration proposal](atlas-lesson-integration.md). Finishing retains the work and can open review, while generation requires a separate action. The review keeps the conceptual map, exact arguments, gaps, and source evidence distinct. One explicit approval applies reviewed changes. Existing Atlas-linked chats can still use the earlier reviewed notes path. Legacy extraction cannot bypass lesson review.

See [Atlas-aware context](atlas-aware-lessons.md) and [lesson source attachments](atlas-lesson-sources.md) for start options and limits. Real-device acceptance should exercise a full lesson and derivation with the owner's pen setup, persistent orientation, tangent return, restored attempts, and review without duplicate claims.

## Map and tools

Main nodes may carry a question, logical stage, full title, and complete LaTeX formula. Topic families unfold locally, and **All details** shows the whole map. A text list remains available without Canvas. The current focus can be followed or inspected independently. Fitting, enlarging, dragging, and inspecting affect the view only. D3 uses stage and family anchors, springs, repulsion, and label clearance. Drag moves local anchors, distant nodes stay fixed, and cancel restores the drag snapshot. The mounted map retains local positions. Reload recomputes them.

- `read_lesson` returns a compact current map or the complete notes, neighbours, and targets for requested topics. Reads cannot change focus or coverage.
- `edit_lesson` batches bounded changes against the exact revision. It can revise labels, notes, coverage, families, associations, order, focus, or objective. It cannot delete topics, reassign a bound Atlas identity, or finish work on the owner's behalf. Rebase stale edits after reading.
- `update_lesson` handles initial plans, deliberate restructures, and derivation targets. Omitted hierarchy/formula metadata and unrelated retained work survive edits. Model-only context includes whole nearby notes within its budget and directs the tutor to explicit reads for omissions.

## Persistence and concurrency

[`src/core/learning-session.ts`](../src/core/learning-session.ts) owns the bounded schema. [`src/store/learning-session.ts`](../src/store/learning-session.ts) keeps `lessons/<chatId>/current.json` and archived `revision-<n>.json` under the data root. Version 1 reads older optional fields. Unknown formats and unsafe IDs are refused. Session deletion removes its lesson directory. Include the whole directory in backups. Archived revisions have no restore UI.

Limits are 40 topics, 80 connections, and 20 derivations. Objective, Start, and Finish are each capped at 4,000 characters, LaTeX formulas at 800, questions at 300, and sections at 80. Oversized canonical targets require explicit setup. Lesson IDs are session-local, with optional Atlas references.

The lesson API requires an idle chat and exact revision for UI writes. Agent writes use the injected port inside the active turn. Head changes are atomic. Conflicts retain drafts and refetch saved state. `lesson-changed` drives refetch on events and reconnect. Older responses cannot replace newer revisions. Run one writer per data root.
