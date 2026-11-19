# Continuous lesson delivery — stage 1

Implemented 16 November 2026. Scope: teaching granularity and context optimization.
Stages 2 (durable prepared units/post-delivery synchronization) and 3 (bounded
prefetch) are deliberately deferred for owner review. No new UI or agent hierarchy.

## Audit and ownership

The native path remains input → admission/compaction → write-ahead user-message
save → per-turn learning agent → Pi streaming/tool loop → native history and usage
settlement. Views attach to the same server turn; disconnecting a view does not
abort the turn. Explicit abort and the one-active-turn gate remain unchanged.
Lesson writes still go through lessonTools → expectedRevision → atomic lesson
store → lesson-changed notification. Evidence and canonical mathematics remain
separate; source/PDF, scratchpad, review and Challenge workflows are reused.

Conflicts found: conversational instructions required an opening read_lesson and
edit_lesson before teaching each new topic, while also requesting fluent teaching
without acknowledgement gates. The older one-key-idea preference encouraged
fragmentation. These were reconciled in LEARNING_INSTRUCTIONS, tool descriptions,
AGENTS and current docs, rather than adding a competing prompt. The legacy
non-lesson probe/teach and Practice protocols are unchanged.

## Model context

`src/core/lesson-context.ts` builds the lesson snapshot. It carries the original
goal from lesson revision 1, the current objective, current focus, the ordered
main topics with coverage, and the exact active Start/Finish. Current topic notes
and the active derivation's topic retain their equations, assumptions and open
questions. The original goal can point to identical text in the objective or
in a retained user message. After a compaction cut it appears as text if needed.
The original goal is the initial saved objective. The full opening message is
kept in the transcript. A missing or unreadable first revision leaves the original
goal unknown.

The snapshot adds the parent topic, up to two upcoming route candidates and
nearby associations within the 24,000-character JSON budget. A working derivation
excludes the upcoming candidates. Long required notes and exact targets can exceed
the budget by themselves. Optional topics are included whole or listed as omitted.
Only `completeTopicIds` count as read notes. Use `read_lesson` for omitted notes,
the full topology or a fresh revision after a conflict. Route order and coverage
describe teaching progress.

The learning agent appends this fresh application-data message after native
history projection and protocol repair. An edit takes effect on the next inference,
even during a tool loop. The system instructions omit the mutable objective.
The snapshot never becomes a stored message, learner submission, or steering event.
The compaction budget still accounts for the snapshot. Native history, tool
execution and retry use their existing paths.

### Development inspector

Run `LH_CONTEXT_INSPECT=1 npm run dev:local` and look for `[lesson-context]` in
the server log. Each completed or aborted inference reports estimated input by
category, image count, and the retained native range and compaction marker.
Provider token counts are listed separately when admitted and present. The
estimates use the existing character heuristic and fixed image allowance, so
provider framing and vision token costs can differ. The inspector logs no
prompt text, tool payloads, image bytes or credentials.

Two deterministic fixtures compared with the prior projection. These are
input estimates. Common tools and policy text are excluded from both sides.

| Fixture | Before | P1 | Native history estimate |
| --- | ---: | ---: | ---: |
| 11-topic route, unchanged objective, 82 messages | 17,603 | 17,480 | 14,845 |
| Changed objective and active proof, after compaction | 2,782 | 2,701 | 78 |

The second request now includes the original goal too. The exact Start and
Finish and the compacted history span stay the same in the fixture.

### P2 — Saved chat lookup

The tutor can use `read_chat_history` on demand. It reads the full saved lesson
chat, including text before the active compaction cut.

- `search` matches every keyword case-insensitively and returns up to eight
  recent matching IDs with short excerpts. Pass `beforeId` for older results.
- `read` retrieves up to eight IDs in saved order. `around` returns the anchor
  and up to five neighbors on each side in saved order.
- Reads return exact saved text and tool results with IDs, order, timestamps,
  roles and tool-call references. Multiple text blocks are joined with a newline.
  The encoded text budget is 12,000 characters per response. If an entry is
  larger, read it alone with its `nextOffset` for the next exact slice. Old
  lookup results, private thinking and image bytes are outside this lookup.
  Drawings remain available through `read_scratchpad`.

### P3 — Select the reasoning episode

Start with `LH_LESSON_HISTORY=shadow npm run dev:local`. Shadow mode logs the
candidate for every inference while sending the existing projection. Use
`LH_LESSON_HISTORY=on` for an opt-in trial. Unset the flag to return to the
existing request path.

The only text cut starts at a learner's explicit `New standalone question:`
message. Include the complete independent problem after the prefix. The request
must have a known original goal, an available history tool and a closed previous
exchange. A working derivation, a topic marked Revisit, an intervening input,
an interrupted response or an uncertain tool group keeps the full active text.
Retries, resumed feedback and background requests use the full-text path. The
selector runs on the model-facing projection after compaction and preserves the
compaction summary. The live snapshot still carries both goals, the roadmap
and exact current mathematics. Saved chat remains accessible through P2.

With the flag on, the fallback omits old image blocks from before the current
input. Current P2 drawing attachments, pending feedback images and new tool
images still travel. Old scratchpad drawings can be retrieved by ID. Other old
images may need the original source tool. The native request state and saved
messages keep their existing tool calls, results and attachments.

The dev log groups inferences by run ID and reports baseline and candidate input
estimates, image counts, the native compaction range, retrieval calls and
provider usage when reported. Sum all inferences, including retrieval follow-ups.
Shadow mode estimates the projection but cannot predict whether the model will
need an extra lookup. In the paired scripted proof fixture, the first request
fell from 14,843 to 11,188 estimated input tokens. Forcing one historical lookup
raised the selected total to 22,443. The scripts check exact recovery and wire
shape. Live teaching quality and usage remain to be measured.

Compaction currently checks the saved record both before admission and after
settlement. These checks can summarize a prefix an enabled request would skip.
Before broader rollout, move the admission estimate to the actual per-request
projection, with the full fallback budgeted separately. A reported token count
from a shortened turn cannot serve as the full-history anchor. The settlement
kick should defer eligible lesson turns until the next input is known. Use the
same estimate for the compactor's internal recheck. This pass keeps the existing
trigger and summary behavior.

## Teaching behavior

The lesson prompt owns pacing, map use, and active derivation rules. The learning-policy guidance supplies strategy and evidence rules. Both compose into the same tutor prompt.

Initially favor one coherent mathematical development across about 2–3 closely
related main concepts when appropriate: definitions → equations → intuition and
consequences connected within the explanation, not concatenated mini-replies.
There is no rigid word count/concept quota or OK gate. Interruptions, tangents,
source questions and handwritten attempts still use the same chat and scratchpad.

Use the saved route rather than re-plan/read it every turn. Read necessary source
material first, then prioritize useful prose. Batch meaningful node/equation/link/
coverage changes; do not write focus before every explanatory section. Progress
means discussed, never independently understood. Graph organization follows
mathematical relationships, not a new node for every exchange.

The existing evidence-aware policy still selects independent work and respects
learner intent, prerequisites and assistance. An active reconstruction is a real
pause for an attempt, not a reason to autoplay/reveal a solution. Only the learner
finishes a derivation/lesson. The semantic policy version is `2026-11-16.1`.

Map tools remain synchronous revision-checked tools. A model may stream text and
then issue a maintenance call, but this stage does not guarantee tool ordering or
eliminate the inference following a tool result. Durable prepared sections,
post-delivery deltas and automatic continuation across separate responses are
stage 2, not hidden additions in this release.

## Measurement

New lesson usage entries have optional `turns[].delivery`:
firstTextMs (request entry → first learner-visible text observed on the admitted
server wire), totalMs (request entry → settlement, including tools/retrieval),
modelResponses (including failed/aborted responses), toolCalls by name,
successfulMapWrites, acknowledgementInput and aborted. Thinking/tool arguments
do not qualify as prose; explicit send_to_user output does. This is measured
before SSE coalescing, not browser paint or a semantic quality assessment.
Existing `steps` remain the admitted per-inference token/cost source. Delivery
metrics share usage admission: an early failure/abort with no admitted step has no
usage entry or persisted delivery timing. Missing historical timings stay missing;
aborted usage retains its existing limitations. totalMs is sampled during native
usage settlement; later housekeeping and client transport/paint are excluded.
No prefetch exists, so wasted-prefetch measurement is not applicable yet.
Repeated explanation quality requires qualitative inspection of native history;
it is not guessed from repeated words or engagement.

Read-only audit (no transcript contents printed):

```sh
node --import tsx scripts/inspect-lesson-delivery.ts /path/to/chats/chat_id.json
```

[The original lesson baseline](archive/lesson-delivery-baseline-2026-11-16.md) records the comparison data and validation limits.

## Remaining acceptance work

Observe real lessons under the new policy to compare first useful mathematical
text, total duration/token spend, map-write frequency and repeated explanations.
The measurements now exist; retained understanding still requires submitted work
and later evidence, never latency alone. Prepared-unit persistence, reading cursors,
invalidation and bounded cancellable prefetch remain explicitly unimplemented.


## Owner scope revision — 16 November

Stage 2 remains deferred. Saving a teaching-unit index alone would duplicate
organization already recoverable from native history without avoiding any model
calls. It was skipped rather than adding storage or claiming token savings.

Policy 2026-11-16.2 makes demos explicit-request only. Ordinary opening/conceptual
explanations use prose/equations/examples; dynamic subject matter alone does not
justify a demo. Legacy prompt and tool descriptions no longer encourage free
artifact dispatch, including substitution with visual jobs. Requested demos and
existing job safeguards remain available. This is model guidance, not a hard
semantic consent gate; real-model adherence and token savings need observation.
