# Conversational lesson workspace — first slice

30 October 2026; R01, R04–R05, R07–R11, R15–R17.

New teaching sessions started from Home or New session opt into `learning:true`
at creation. Existing sessions and direct API callers without that flag retain
upstream behavior; practice ignores the flag. This is compatible workflow context,
not a new interpretation of native probe/teach phases. Reopen old sessions as they
are; start a new teaching session to use this workspace.

The session has an always-present objective and concept map, current topic,
purple tangent branches and nested derivations. The assistant maintains the plan
through `update_lesson`; the owner can edit objectives/topic names, add connected
topics/tangents, select the current topic, create derivation targets and return to
the lesson. Active derivation targets can be edited with retained prior revisions.
Start and Finish stay visible when a derivation is open. Topic and
derivation lists work if Canvas is unavailable. Desktop uses a side panel; narrow
windows use a compact upper workspace with independently scrollable controls.
The existing chat composer and dictation remain the answer surface.

New learning turns bypass the prober and use a dedicated conversational policy:
concepts first, selected proofs, targeted hints/explanations, no compulsory quizzes,
prediction prompts or checkpoint gates. Quiz/probe/question/plan-init tools are
absent from this workflow's registry. Clarification can happen in ordinary prose.
Existing native history, one-active-turn claims, model routing, usage, replay,
interruptions, steers, job/read tools and practice retain their machinery. The
workflow supplies its own instructions instead of the legacy prober/teacher prompt
fragments; legacy custom prompt overrides remain for legacy sessions. Compaction
reads the current lesson afresh and budgets its actual instruction context.

Lesson maps are planning, not canonical claims, mathematical prerequisite edges or
mastery scores. `update_lesson` cannot mark work finished or remove retained
derivations. Only explicit owner buttons mark a derivation/lesson finished; reopening
and revisiting remain possible. Completion retains work; it does not yet distill or
integrate a map/proof graph. Automatic and manual legacy extraction are blocked for
these sessions so the unfinished review boundary cannot be bypassed. Atlas-linked
sessions still have their existing explicit notes review. General finished-session
to-canonical proposition/argument integration remains pending.

## Persistence and concurrency

`src/core/learning-session.ts` owns strict bounded schemas and the store port.
`src/store/learning-session.ts` persists `<data>/lessons/<chatId>/current.json`,
with `schemaVersion:1`, optimistic integer revision, status and plan. It archives
the previous full state as `revision-<n>.json` and atomically renames a private
replacement head. No SQLite or native chat format migration is needed. Include
the complete lessons directory in full data-root backups/restores; prior revisions
have no restore UI yet. Unknown future versions and unsafe IDs are refused.
Normal session deletion removes its lesson directory too.

Limits: 40 topics, 80 ordinary map connections, 20 retained derivations; each
objective/Start/Finish is at most 4,000 characters. Oversized canonical targets
are left for explicit bounded setup instead of truncating mathematical statements. Stable session-local IDs are
separate from optional Atlas concept references. No Atlas identity or canonical
record is created by a plan update.

Thin `/api/chats/[id]/lesson` GET/PUT delegates to the server service. UI saves
require an idle chat and exact lesson revision; model saves use the injected port
inside the existing active turn. Conflicts retain editor drafts and refetch current
state. `lesson-changed` extends the existing SSE notify/refetch/reconnect path;
revision comparisons prevent older responses replacing a newer view. Failed head
replacement leaves the current revision intact and previous revision retained.
This metadata store assumes the same one-process logical owner as the application;
it is not a multi-process collaborative editing service.

## Verification and remaining work

Isolated checks cover strict references, restart/history, stale/busy updates,
learner-owned completion, retained derivations, native-history preservation,
assessment-free tool registry, explicit creation opt-in and unchanged practice.
A scripted native turn exercises model map update → prose → persisted chat with
no pending question; legacy chat-flow regression tests also run without providers.
React checks cover pinned Start/Finish, returning to the lesson and retaining work.

No live model call, owner-data lesson creation, full production build or real pen
check was performed for this slice. Real browser layout/pacing sign-off remains.
Next: embedded fullscreen Excalidraw and retained multimodal attempts, with reviewed
finished-session maps and canonical arguments now implemented separately (see
[lesson integration](atlas-lesson-integration.md)). FSRS and
challenging practice remain separate later work.

Lesson-map readability follow-up: embedded maps reserve separate rectangles for
dots/labels after the upstream layout, use compact display handles (saved topic
names stay intact), and frame label bounds with initial zoom capped at 1×. The
map has more vertical space on desktop and refits on resize. Its optional renderer
label width does not change default Atlas/derivation rendering. Focused checks
exercise the reported long-label constellation, deterministic separation and
unchanged names; live browser visual sign-off remains pending.

Teaching style applies to the conversation as well as the workspace: one key idea,
useful equations/steps and brief intuition by default, with depth developed through
back-and-forth. Expand on request or when a real gap needs it. Essential assumptions
and genuine uncertainty remain explicit without repeated qualifications. This is
encoded in both conversational learning instructions and the legacy teacher prompt.

The embedded conversational-learning scratchpad is now implemented separately:
[sizes, submission, source retention and limitations](atlas-scratchpad.md).


## Lesson navigation and coverage (31 October 2026)

Topic clicks inspect locally and never save lesson focus. The single contextual
**Continue here** action saves the chosen focus (clearing an unrelated active
exercise), then sends an ordinary learner message through the existing chat turn
path. Failed saves do not dispatch teaching. Inspection remains available during
a response; writes still require an idle chat and the exact revision.

The compact Now/Next route follows topic array order, skipping tangents and topics
marked explored. Nodes optionally retain `progress: upcoming | explored | revisit`;
missing older values render as upcoming without rewriting history. Green/check
means discussed, never mastered; amber marks focus, purple tangents. The teacher
is instructed to update focus before transitioning, retain coverage, and use
revisit for open work. This remains model tool use, not an automatic classifier
of conversation progress, and existing sessions are not retrospectively graded.

Leaving a derivation preserves its targets and owner-controlled finish status;
inactive unfinished exercises display “awaiting your finish”. Agent updates clear
an active exercise belonging to a different current topic and preserve previously
recorded progress when omitted. Editing controls are under one disclosure.
No SQLite migration, canonical graph write or new provider call is introduced by
inspection or status display; schemaVersion 1 reads the optional field compatibly.
