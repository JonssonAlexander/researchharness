# Spaced Review

Implemented first slice, 31 October 2026. **Review** opens a separate full-Atlas
canvas from graph home or minimal home. It uses saved concept positions and the
existing renderer, with read-only node selection; it never saves positions,
recolours the main Atlas, changes concept notes or promotes mathematical claims.
Node colour comes directly from the enrolled target's FSRS recall estimate:
blue at 90–100%, gold at 30–90% (excluding 90%), vivid red below 30%. Unreviewed, unenrolled or
source-stale targets are neutral; paused cards retain their known recall colour.
Edges use the arithmetic mean of both endpoints' recall estimates (neutral when
either is unknown). Select a node to see its percentage. There is no separate assistance state, marker or
concept-mastery score. The colour is an estimated scheduling signal, not validated
understanding of everything attached to a concept.

## Cards and daily selection

Approved lesson/map integration automatically enrols one basic front/back target per
concept with useful notes. Opening Review catches up earlier integrations and interrupted
enrolment. Existing targets (including paused or edited cards) are left intact.
Cards use the latest approved source notes locally, without an extra model call;
very short labels and references exceeding 12,000 characters are skipped rather
than truncating mathematics. Manual selection/editing remains optional. Existing concept notes
prefill the reference answer; edit it to the intended recall target. The initial
slice has one stable target per concept, automatic integration enrolment, pause/unpause and
versioned edits. It never enrols unrelated bare Atlas nodes or generates multiple cards per concept.
If source notes/title/claim references change, the target waits outside the deck
until explicitly checked/saved. Rewriting its question or answer creates a new
target version with new scheduler state; previous activity/event evidence remains.

The planner takes due targets, oldest due first, and groups 3–4 connected targets
when actual accepted concept connections permit it. Otherwise it uses individual
cards. Temporary groups never become additional FSRS cards. Estimated time and
activity budgets bound the offered deck: default six activities / twelve minutes,
configurable with a server-enforced absolute ceiling of twenty activities per
study day. Each connected question counts once. Nothing due means no forced work.
Skipped shown questions consume a daily slot but do not grade recall; failed or
cancelled-before-presentation preparation does not. Excess work stays due. Day
boundaries use the saved IANA timezone (initially Europe/Stockholm), not UTC dates.

Press **Daily review** once to run the selected daily activities in sequence. It
resumes any current attempt, automatically prepares connected questions when
needed and advances after rating/skipping. Generation failure or an unavailable /
changed model falls back to individual cards. The button's adjacent disclosure
states the selected model, source text and usage; entering the queue authorizes
only that day's bounded selection. Leaving stops automatic advancement; reopening
can resume the active attempt and select the remaining deck. An active attempt is excluded from the remaining queue; short-interval relearning
can become due again later within the same daily budget. Explicit manual card review
remains available. Questions are prepared just in time, not through a background
paid generation job.

Single cards run locally without a model: attempt mentally or write, explicitly
show the answer, then Again / Hard / Good / Easy. Connected questions send only the
selected enrolled fronts/backs to the configured strong/teaching model after starting Daily review with the visible model/usage disclosure. Up to two model calls share a twenty-minute
limit. The model solves/checks a short basic symbolic/conceptual question and
precommits its reference and one assessment criterion per target before display.
No numerical plug-and-chug, advanced puzzle, hidden-technique challenge or long
proof is requested. The selected model must still match the preview; no silent
provider fallback is made. Model checking is not mathematical verification.

Each connected target receives its own explicit self-rating; Not tested/flawed
leaves its recall ungraded. Seeing a solution is not successful independent recall.
A wrong reference can be skipped/left unrated without penalizing a target. Individual cards are the automatic fallback when a group cannot be prepared. Generation failure preserves
source snapshots and received usage, records no rating and requires an explicit
retry. A preparing review left by a restart can be cancelled, not automatically
redispatched. External usage may be incomplete after an ambiguous provider failure.

## Attempts and scheduling

Review text autosaves locally with a revision check and serialized flush. Existing
Excalidraw and dictation tools support the same basic review; drawing scenes use
the scratchpad source adapter under `scratchpads/ra_<id>/review`. Reveal flushes
work, checks the exact drawing revision, captures the immutable scene/image via
the existing PNG validator, and retains it under `_retained`. Work is available
with the review outcome and as an editable `.excalidraw` download. Autosaving or
revealing does not invoke a vision model; this slice is self-rated Anki-style
review, not an automatic handwriting grader or conversational practice tutor.
Closing/switching views flushes work, and only explicit ratings change schedules.

The app pins MIT-licensed `ts-fsrs@6.0.0` and FSRS-7 using the modern DefaultScheduler
API. Model defaults, effective parameter values, library/model versions, initial
state, target versions and UTC event times are retained. Desired retention is
visible/editable; changing it affects future ratings without silently moving all
existing due dates. Parameter fitting is not implemented. Recall probability is
computed with the library's forgetting curve, never a custom forgetting model.

`Correct last review’s ratings` appends correction events and replays effective
chronological history; it does not count another daily activity or erase the
original rating. A rewritten target cannot be modified by an earlier version's
rating. Repeated identical rating submissions acknowledge the receipt rather than
advancing memory twice. Edits/ratings from stale windows fail without overwriting.
After revealing, each rating shows its next-review interval from the real FSRS
scheduler, using the captured pre-review card, configuration and revealed-at time.
These are read-only previews; the chosen rating uses the same inputs to commit.
Group rating options show the separate interval for each concept. Corrections to
older reviews omit previews because replay may include later events.
Only one activity is active at once; active targets cannot be rewritten mid-review.

## Persistence and recovery

Schema v15 backs up a v14 database before creating `retrieval_items`,
`retrieval_activities`, `retrieval_events` and `retrieval_settings`. These are hashed
JSON records with indexed activity days/status and item events. Mathematical
concepts/claims remain in their existing stores. Short SQLite transactions persist
schedules, immutable review events and the activity receipt together. A failed
transaction leaves the revealed activity resumable and records no partial grade.
Source files are captured before their reference is committed; interrupted file
captures can leave unreferenced local files, safely retried through stable tokens.
Include the entire data root, SQLite metadata and scratchpad files in backups.

The existing server event bus carries `review-changed`; UI refetches on events,
reconnect/focus and a one-shot next-due/study-day-boundary timer. There is no new
standing polling loop. Snapshot reads use today's activities/current/last activity
rather than loading the entire historical deck. Source cards and review history
are retained if a concept is removed; absent concepts are not scheduled.

Tests cover real FSRS scheduling and configuration round trips, duplicate receipts,
corrections, per-target cluster outcomes, target/source revisions, count/time limits,
UTC/DST boundaries, isolated migration/backup, corruption refusal, rollback,
restart, drawing retention, native scripted question submission and the UI reveal /
rating path. They do not establish mathematical accuracy of a real model, real pen
comfort, pedagogical calibration or a live paid-provider run. AI-written lesson-to-card refinement, Anki/APKG import/export, long problems, technique scheduling and
personal parameter optimisation remain separate later work.

Official API used: [ts-fsrs quick start](https://open-spaced-repetition.github.io/ts-fsrs/guide/quick-start)
and the pinned package's README/types, including the FSRS-7 memory state.

Validation follow-up, 1 November: 180 focused tests passed; the complete suite
passed 2,715/2,760 in the restricted environment. All 45 failures involved local
server/home-temp permissions; the affected files passed on targeted reruns
(109 tests). Typecheck and lint passed. A temporary-profile Chrome run exercised
card preparation, typed attempt, reveal and rating through the real HTTP/UI path.
Electron's bundled Node 24.22 also initialized the pinned FSRS scheduler. No paid
model call or owner-data card enrolment was used. Production build remains
unverified: Turbopack hit a process/port restriction, and the Webpack fallback hit
the existing client-barrel `node:crypto` import through `coverage.ts`. Development
compilation and the browser card flow passed; this is not packaged-release sign-off.

Daily review validation, 1 November: 92 focused retrieval/UI/canvas tests passed,
including automatic two-card advancement, interval previews matching committed
FSRS dates, and endpoint-mean retention colours. Typecheck and targeted lint
passed. The owner-profile Review screen was visually checked without dispatching
a paid question or recording an outcome. Live provider question preparation was
not rerun for this UI change.


Card help: reveal after attempting, then use **Check my answer** to assess your
saved answer/drawing, using the question/key as context. It gives feedback only,
never replacement card text. The separate **Fix card** button proposes a short
checked question/key for a single target. Incomplete notes may be supplemented
with established mathematics, labelled AI-authored with explicit assumptions;
this never implies prior learning. Authorship and model provenance stay with the saved card. Nothing changes until **Save
repaired card**; it creates a new target version with a fresh schedule and retains
prior history. A deferred/untaught topic can be paused instead, preserving its
schedule. These explicit model calls use the configured teaching model (up to two
calls, twenty-minute limit), retain usage and never choose your FSRS rating. This
is model feedback, not formal mathematical verification.
