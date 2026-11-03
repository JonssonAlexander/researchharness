# Challenges and saved Problems

As built, 1 November 2026. This is the long-problem branch of AGENTS §12, separate
from short Practice and the FSRS Review view.

Choose Practice → Challenge on the home composer. Select Atlas concepts, describe
an area, or both. The editable 45-minute default guides selection; nothing times
out the learner's attempt. A challenge session holds one problem. Existing short
practice prompts and native problem/conclude protocol remain unchanged.

The challenge agent can use the same bounded `search_atlas` and `read_atlas` tools
when graph access is enabled, including following exact connection/claim IDs.
It sees bounded recent challenge outcomes and current attempt metadata. It does
not interpret Atlas membership as mastery. Past problems are preferred; generated
problems require a complete solution and checking record. This is recorded AI
checking, not a formal verifier or a curated contest bank. Attributed sources and
checking limits remain inspectable. No extra autonomous checker or model job is
started merely to open the collection.

## Persistence and visibility

`ProblemStore` is an injected core port. Its owner-process filesystem adapter saves
one versioned JSON record per problem under `data/problems/` using atomic head
replacement and owner-only permissions. A record holds an immutable statement,
source, checking and solution, plus attempts and chronological outcome events.
The tool saves before returning a successful native problem acknowledgement.
Duplicate poses are idempotent by chat/call ID. A durable pose interrupted before
native settlement is recovered on the next idle chat input. Native history stays
native; the recovery adds a clearly marked saved-pose pair rather than inventing
learner work.

Attempts reference their chat/call IDs and the existing scratchpad storage. A
retry creates another chat and attempt on the same problem; no earlier hints,
messages or drawings are copied. Retry request tokens prevent duplicate attempts
on network retry. The original model selection is reused. A saved attempt's chat
cannot currently be deleted: the deletion endpoint explains that its evidence is
retained by the problem. Separate archival/deletion controls are future work.

Public projections omit unrevealed solutions, checking and hidden technique IDs.
Prior attempt debriefs are omitted until that attempt is explicitly selected.
Challenge-only native chat GET, SSR, Markdown export and live/reattach streams
redact private solution arguments, preparation reasoning and compaction summaries.
Model replay and server persistence retain the originals. Explicit reveal is its
own event, never an automatic solve. Actual model output prose cannot be proven
spoiler-free; the challenge policy forbids premature solution disclosure.

The statuses are In progress, Solved independently, Solved with hints and Set
aside. Outcome corrections append events. An explicit reveal while working blocks
an independent-solve label for that attempt. The model's conclusion preserves the
hint rung and verdict in native history and a short debrief in the problem record.
Defective/ambiguous flags are retained and excluded by selection guidance from
ability conclusions. These are evidence records, not calibrated mastery scores.

## UI and integration

Atlas → Problems opens a separate graph and searchable collection. Related
problems in concept inspection opens a filtered collection. Canonical concept IDs
form shared hubs; no name-based identity inference. Techniques are represented by
existing canonical concept IDs, concealed on unrevealed attempts to avoid cueing.
The main Atlas layout and FSRS colours remain untouched.

Challenge sessions use the lesson scratchpad's small/half/full modes, autosave,
immutable submitted snapshots, dictation and image-capable model dispatch. Local
strokes are not sent until Send attempt. A compact Problem details control holds
statement/source, outcome correction, explicit reveal and defective-item flag.

After completion or setting aside, Propose Atlas updates opens the existing
reviewed lesson-map/derivation integration. The source explicitly distinguishes
the private committed solution from learner work. Scratchwork is retained through
the existing attachment path. Accepted updates use canonical identity decisions
and existing integration receipts; the problem links the committed review ID once,
including retry after an interrupted receipt link. Reusable technique notes can
include recognition cues, mechanism, conditions and failure cases. No automatic
new concept/card is created by attempting, revealing or failing a problem. A
separately approved canonical integration follows normal Atlas enrolment rules.

`GET /api/atlas/problems` lists public records, optionally filtered by `conceptId`
or scoped to `chatId`. `id` and optional `attemptId` inspect a specific attempt.
`POST` accepts retry (idempotent request UUID) or an attempt event. Existing desktop
API access controls apply. Session creation accepts optional
`challenge: { workflow: "challenge", minutes: 45 }` only with kind practice.

## Validation

Focused tests cover failed-write refusal, duplicate pose/retry, durable recovery,
private native/stream/export projections, fresh retry isolation, independent and
assisted outcomes, defect/correction history, shared canonical hubs, scratchpad
capture and idempotent reviewed integration. Scripted native-agent tests exercise
Atlas lookup followed by a durable problem pose without a paid provider call.
Existing practice, scratchpad and integration tests remain in the check set.

No automatic challenge schedule, reminders, scientific difficulty calibration,
Anki scheduling from challenge outcomes, or automatic graph writes are added.
