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
or checkpoint gates. Selective prediction/reconstruction follows the evidence-aware [learning policy](learning-policy.md), rather than a fixed questioning cadence. Quiz/probe/question/plan-init tools are
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

Teaching style applies to the conversation as well as the workspace: coherent
mathematical developments, initially spanning about 2–3 related main concepts when
appropriate, with equations and intuition connected. No routine acknowledgement
gates between ordinary sections. Expand or interrupt freely; preserve independent
reconstruction when the evidence-aware policy selects it. Essential assumptions
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

## Lesson map interaction repair (13 November 2026; R01–R05)

The lesson map retains the shared canvas renderer. A bounded D3 settle now includes
label collision clearance before the final rectangle check. Topics keep their
positions and camera while notes, progress or current focus change; dragging uses
an opt-in manual-node callback rather than reheating unrelated nodes. Tapping still
inspects without progressing the lesson. Background pan, wheel/pinch zoom, Fit and
one enlarge/shrink control are available; Escape closes the enlarged map.
Enlarging explicitly fits the available space. Positions are local to the mounted
map, not canonical Atlas coordinates or saved lesson content. Reloading starts from
the deterministic layout. The existing integration approval and lesson revision
contracts are unchanged.

## Live lesson tools and teaching route (13 November 2026; implemented)

`read_lesson` returns a fresh compact map: revision, current topic, ordered main
route, topic identities/coverage, ordinary associations and derivation summaries.
An optional topic ID returns its complete saved notes, actual neighbours and
Start/Finish targets. Reads never change focus or progress. The teacher is
instructed to read the topic before revising its notes.

`edit_lesson` applies a bounded change against one exact revision: edit topic
labels/notes/coverage/tangent flags, add topics, add/remove ordinary associations,
reorder all topic IDs, or change focus/objective. Omitted fields and unrelated
notes, identities and derivations remain intact. It cannot delete topics, reassign
an existing Atlas identity, finish a derivation or finish the lesson. The existing
Atlas-ID checks, retained derivations, atomic store write and post-save notification
are shared with `update_lesson`. A stale edit must read and rebase; no silent retry.
The result confirms the saved revision/topology and complete changed topics.
`update_lesson` remains for initial plans, deliberate restructuring and derivation
targets. Both tools stay within native history and the existing active turn.

The main teaching route is existing topic array order excluding tangents. The map
shows numbered topics and a solid path, with secondary associations dotted and
quieter. This path is derived only for display; it never creates an association or
asserts a prerequisite, implication, proof or mastery. Tangents remain separate
branches. Initial positions follow a compact reading path with a bounded D3 settle;
secondary associations cannot scramble teaching order. Manual node placement and
camera still survive note/progress/focus updates in the mounted map.

Existing schemaVersion 1 lessons need no migration or model-generated rewrite.
The lesson-topic fallback reader recognises successful `edit_lesson` focus changes;
inspection/failed edits never reattribute teaching. No new UI button row, model
role, automatic Atlas integration or FSRS event is added.

Validation: focused tests cover read-only snapshots, complete topic equations,
revision conflicts, restart, atomic failure, retained unrelated notes/derivations,
identity guards, route projection and a scripted native read → topic read → edit →
prose turn. No paid model run or real pen-hardware test was performed.

## Topic families and visible mathematics (14 November 2026; current design)

This supersedes the numbered snake/grid and separate two-column branch placement.
Keep the solid running thread between main topics in teaching order. Heads form a
compact open ring; supporting ideas occupy bounded local families near their head.
The thread is navigation, not a mathematical implication. Existing associations
remain dotted, with distant cross-references quieter.

Topics accept optional `kind: topic | detail | tangent`, `parentId` and `formula`
(one complete bare LaTeX expression, up to 800 characters). Parents must exist and
be acyclic; details require a parent, main topics cannot have one. Legacy `tangent`
remains compatible; non-route nodes keep it true. Old records without these fields
still load; an unambiguous saved main-topic association can provide a display parent
without rewriting history. The explicit current-lesson repair classified the
owner-requested supporting nodes as details and copied complete formulas from their
saved notes, preserving IDs, notes, coverage, connections and derivations through
normal revision-checked saves. Prior revisions remain archived.

Visible labels now show full titles and a separate KaTeX equation, without the
32-character cutoff. Longer equations scale to their label width, never receive
invented line breaks or truncation. Main discs are larger, details smaller; genuine
tangents retain their purple distinction. Variable label rectangles reserve space.
The teacher sees these fields through read_lesson, can edit them through edit_lesson,
and is instructed to use concise mathematical labels plus established equations.
Full-plan updates preserve omitted hierarchy/formula metadata.

Overview starts with main topics. Tapping a head unfolds and frames its local
branch; tapping it again collapses it. All details shows the complete map. The
existing Fit/enlarge controls, pan/pinch and inspection remain. All lesson topics
stay accessible in a collapsed text list. Inspection/unfolding/geometry do not
change saved focus, progress, Atlas or FSRS.

Dragging remains directly under pointer control. On release, a bounded D3 local
settle moves a head's branch with it and clears neighbouring labels; distant
families stay fixed. The shared renderer eases the resulting positions over 220 ms,
without recentering the camera. A new drag cancels an in-flight animation. Position
arrangements are retained separately for overview/branch/all-detail views while
mounted; reload recomputes the deterministic family layout. Main Atlas physics
are unchanged.

Validation includes the expanded 9-head/24-detail constellation, label separation,
parent/cycle validation, exact title/equation rendering, safe KaTeX, local movement,
metadata preservation and existing native teacher/graph/integration checks. Browser
checks on the repaired lesson covered overview, all 29 formula labels, branch
expansion, branch movement and no ellipses or runtime errors. No paid model call
or real pen/tablet acceptance test was performed.

## Logical stages, live motion and lean context (14 November; current)

This supersedes the open-ring placement and release-only animation above. Main
nodes carry optional `question` (up to 300 characters) and `section` (up to 80),
with the existing mathematical title/formula retained underneath. The current
lesson's nine questions and three stages were restored through the normal API;
notes, equations, IDs and coverage stayed unchanged. Other legacy lessons remain
readable; the teacher supplies meaningful questions/stages as the lesson develops.

Stages progress left to right; families sit locally within their stage. These are
teaching organization, not inferred mathematical prerequisites. The solid lesson
thread remains. Section headings stay visible at overview scale. The current
node has a distinct ring and You are here label. A compact Now question identifies
the route position and restores follow mode. Initially the graph frames the current
family and includes saved one-hop neighbours and any required ancestors. Selecting
another topic or All details suspends automatic following. Physics/inspection do
not change focus or progress. New nodes seed near the parent's current position.

The renderer now drives an injected browser-local `createLessonMotion` using the
same stopped/ticked D3 engine as Atlas. Springs, collision and weak anchors respond
while the pointer is down, then decay after release; distant nodes stay pinned.
Moving a head moves its family's anchors, without teleporting children. Cancellation
restores the drag snapshot. No RAF runs permanently at rest. This replaces the
220 ms end-position interpolation, rather than layering another animation on it.

Map tools have always been deterministic local code; no separate model runs for
inspection, layout or each node write. The expensive teacher still decides what
to teach/change. Its stable system prompt now contains the objective rather than
the entire mutable map. The teacher now receives fresh bounded focus/route/target context at the model
boundary (16 November stage 1), reads only omitted/deeper topics with topicIds,
and batches meaningful writes. Focus need not be saved before every transition. Edit receipts
return revision/current IDs and changed IDs/counts without duplicating all notes.
Full notes and complete equations remain available through explicit reads. Existing
native conversation and compaction semantics are unchanged; nothing is silently
removed from history. Prompt budgeting uses the actual smaller instructions.

On the current saved lesson, removing the mutable map reduced this instruction
payload from about 31k to 7.3k characters (76%, not a claim of 76% total token/cost
savings). Stable-prefix behaviour is covered locally; actual provider caching and
quota savings need observation in subsequent real turns. No paid model test or
model/provider switch was performed. A cheap model dedicated to large map drafts
has not been introduced; the existing model settings remain authoritative.

Validation covers logical stage ordering, the expanded 33-node map, live motion
before release, distant anchors, settling/cancellation, questions with formulas,
current/related-node visibility, batched reads, compact receipts and prompt stability
across note/revision changes. Browser checks cover live branch motion, current
focus, questions and All details without changing the saved lesson revision.

Organic layout follow-up: stage coordinates now seed a bounded D3 force settle,
not fixed rows/columns. Relationship springs, repulsion and label clearance shape
the map around weak stage gravity; main-thread and supporting links retain their
styles. Existing live drag physics and current-topic navigation remain unchanged.
This is view geometry only. Reloading recomputes it without editing lesson data.

## Evidence-aware teaching

The November 15 [learning policy](learning-policy.md) supersedes blanket bans on
prediction as well as legacy every-step assessment. Coverage stays in this map;
agent-only targets, submitted-work evidence, timing proxies and policy lineage
are persisted separately. Existing workflows and reviewed integration remain intact.
