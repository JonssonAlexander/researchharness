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

`src/core/lesson-context.ts` owns a pure, bounded projection of the existing lesson:
revision/status, current focus, main route/coverage, current topic plus next two
route candidates' complete notes, nearby saved associations, and active derivation.
A working derivation excludes automatic next-topic candidates. Route adjacency is
only a planning hint; it does not establish a mathematical dependency. Explicit
saved associations remain distinct from route order.

The JSON budget is 24,000 characters (usually much smaller). Whole omitted topics
and oversized targets are explicit; formulas/notes are never partially clipped.
Only completeTopicIds count as read notes for subsequent edits. `read_lesson`
still retrieves omitted/deeper material, the full topology or fresh conflict state.
This does not duplicate source documents or inject unsubmitted handwriting.

`createLearningAgent` reads this projection through the injected lesson store at
every model-bound conversion, after native compaction/protocol repair. It appends
one explicitly labelled application-data message to the projected request only.
It never enters Agent state, native history, subscription input-cause detection,
steering queues or learner evidence. It cannot accumulate on repeated requests.
The mutable map does not alter the system-prompt prefix. The existing compaction
budget includes the model-only tail. Missing/deleted lessons are marked unavailable.
No background writes or alternate persistence authority were added.

## Teaching behavior

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

## Measurement and baseline

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

Available owner regression: `chat_mwhv1059_1fef6789`, 95 native messages:

| Observation before this change | Count |
|---|---:|
| User messages / short acknowledgements | 11 / 9 |
| Admitted model steps | 45 |
| Tool calls | 38 |
| read_lesson calls | 15 |
| Map write calls / successful calls | 12 / 11 |
| Reported input/output/cache tokens across all steps | 1,366,757 |
| Sum of 45 provider-reported model durations | 894,022 ms |

These are accumulated inference tokens, not unique context or subscription quota.
Provider-duration sum is not complete-turn latency. Historical first useful text
and complete-turn timings were not recorded and cannot be reconstructed reliably.
The owner's current regression lesson snapshot is 2,569 characters including its
label (revision 12, 18 nodes, 7 main topics, one current topic with active target).
The saved record/map were inspected read-only and remain unchanged.

A scripted native test develops covariance structure and estimation in one
response: 1 model call, 0 map reads/writes, 0 acknowledgement turns. This proves
that the optimized path needs no bookkeeping calls; it does NOT measure a real
model's new teaching behavior, wall-clock improvement or token savings. Other
checks cover live refresh after edits, stable prefix, bounded whole-topic
omission, active targets, text-before-tool delivery, stale-write rejection,
restart persistence and deterministic latency counting. Validation: typecheck, lint and diff checks passed; 201 tests passed across
lesson/evidence, chat/retry/compaction, subscription admission/accounting, Practice,
turn recovery and PDF/source suites (including nine new delivery tests). No paid
model or browser/pen test was run for this stage.

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
