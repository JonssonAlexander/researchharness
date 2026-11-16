# Evidence-aware mathematical learning (implemented 15 November 2026)

The product specification is `research_atlas_learning_policy.md` in the enclosing
workspace. This implementation applies to conversational lessons, including PDF
lessons and derivations. Legacy probe/teach, short Practice, Challenge and daily
FSRS keep their existing protocols. No new agent hierarchy or embedding model.

## Experience

The tutor first makes a small conceptual dependency map: central question,
objects, assumptions, important results and their connections. It reads the
attached article through the existing bounded text/page-image tools and consults
Atlas where relevant. The PDF workspace, comments, persistent article canvas,
Chat/Reading switch, dictation and scratchpad submissions remain unchanged.

Explanations can develop fluently. There is no every-step quiz, mandatory initial
test, acknowledgement gate or fixed prediction frequency. At meaningful strategy
changes the tutor calls `choose_learning_action`. Its deterministic priority rules
respect requested explanation/continuation/work, prerequisite gaps, importance,
effort, diagnostic value, vulnerable assumptions, opportunities for connection or
retrieval, and recorded independent evidence. Unknown understanding is not failure.
For important reachable ideas, independent reconstruction uses the existing saved
Start/Finish derivation and scratchpad, with progressive help after the attempt.
The learner can interrupt, request explanations or deeper tangents, and choose
when to finish. A recommendation never autoplays a lesson or forces a quiz.

## Ownership and evidence

- The lesson store owns the visible map, notes, focus and coverage. `explored`
  still means discussed, not understood.
- `src/core/learning-policy.ts` owns the pure policy, schemas, and time aggregation.
- `src/store/learning-policy.ts` owns local atomic, revisioned, append-only logical
  events in `data/learning-policy/<chatId>.json`. It uses existing atomic writes
  and single-process writer semantics. Native chat records remain authoritative.
- `src/server/learning-policy.ts` validates targets, sources and evidence and
  produces inspectable reports; the agent receives an injected service.
- Agent-only targets have stable IDs, revisions, an actual mathematical task and
  success criterion, importance, prerequisite target IDs, lesson topics, optional
  saved derivations, canonical concept IDs and uploaded or retained research PDF source pages. They are
  not another graph of mathematical truth and have no frontend target dashboard.
- `record_learning_evidence` accepts actual learner-message or explicitly submitted
  scratchpad IDs only. It retains message fingerprints, target revision, assistance,
  uncertainty, AI evaluator finding, and policy/model attribution. It never reads
  autosaved strokes as work, awards mastery, or certifies proof correctness.
- Corrections append `supersedes` references; old assessments remain inspectable.
  A known explanation on the same target prevents a clean independence claim.
  Delayed evidence requires a genuinely later submission at least a day after a
  prior recorded observation. This is a descriptive threshold, not a mastery rule.
- FSRS self-ratings and Challenge outcome/reveal/defect histories are queried by
  canonical concept IDs from their existing stores. They remain explicitly labelled
  reports, not automatically treated as proof, transfer or independent capability.
  No schedules, outcomes, canonical claims, or reviewed integration rules change.

## Policy timeline and inspection

Every constructed lesson turn records the effective composed system prompt hash
and snapshot, tool configuration hash/snapshot, semantic policy version, app Git
revision, actual provider/model/thinking level and native usage-turn ID. Target,
strategy and evidence writes reference that version. A long session may therefore
contain several versions. No past activity is retroactively attributed to a new
policy; missing historical attribution remains unknown. The app revision is the
running process's checkout revision; hashes distinguish effective prompt/tool
changes even during development. Bump the semantic version when changing rules.

Local JSON inspection/export:

- `GET /api/chats/<id>/learning`: full ledger, corrected evidence summary, time
  proxies and references to existing review/Challenge histories.
- `GET /api/learning`: policy timeline, per-session summaries and observations
  grouped by actual policy and semantic version. Exact prompt variants include
  objective/source context; semantic-version groups distinguish those variants
  from changes in teaching rules. Intended for inspection/qualitative diagnosis, with
  no causal ranking, adaptive parameters or made-up efficiency ratio.

Exports contain private learner text assessments and prompt snapshots; they use
no-store responses, never expose unrevealed Challenge solutions, and stay local.
Deleting a session deletes its learning ledger through the existing deletion flow.
Existing full-data backups include this folder; no older schema migration needed.

## Passive timing

The lesson chat (including Reading/scratchpad) and review attempt mount one shared
content-free browser hook. It submits bounded intervals for recent interaction,
model waiting, hidden and idle states. No keys, text, pen strokes or drafts are
recorded. Overlapping tabs are unioned in summaries. Missing intervals, background
throttling, closed browsers and off-keyboard thinking remain unobserved, not zero
learning. Interaction time is a conservative observable proxy, not cognitive time.
Timing never influences mastery or silently modifies teaching difficulty. It can
be compared alongside the source work and later outcomes without mandatory tests.

## Practical limits

Readiness and expected diagnostic value are still tutor judgments; software checks
provenance and applies transparent priorities, not mathematical truth. Evidence is
only as good as submitted work and evaluation; a hidden hint outside the app cannot
be detected. Models can omit a tool call; native history remains available, while
missing decision/evidence records remain missing. This is not a calibrated learner
model. Historical sessions begin accumulating records on their next lesson turn;
there is no speculative backfill. Real-model learning effectiveness and long-term
retention require actual use and delayed outcomes, not passing software tests.

Timing intervals also retain the saved topic/derivation and matching agent targets
at receipt. This is explicitly an estimated association, useful for inspecting
where time went; it is not cognitive focus or time-to-mastery. Joint targets can
share time. Intervals spanning a policy change retain separate policy spans;
pre-policy time remains unattributed. Longitudinal exports expose these gaps.
