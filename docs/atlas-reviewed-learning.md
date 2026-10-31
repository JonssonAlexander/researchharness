# Subjects, discovery and learning feedback

Implemented 29 October 2026 for R02–R09, R14–R16. This is a bounded extension
of the existing Atlas importer and session machinery, not completion of phases 3–5.

## Owner flow

* Before integrating a proposed map, choose an existing subject or supply a new
  title and colour. The exact integration preview includes its subject. Both new
  and reused concepts gain membership; reused names, notes and positions survive.
  An already imported map has **Assign subject**, with an explicit confirmation.
* **Mind maps → Grid** expands the panel to three card columns on wide screens
  (two/one on smaller screens). A map title highlights its current linked nodes
  and their connecting lines. **Center map** frames them and closes the panel;
  neither action changes positions. **Clear map highlight** restores the overview.
* **Arrange** proposes organic, radial/flower, or most-connected-centre positions.
  Scope is the highlighted map, otherwise the inspected concept's preferred
  subject, otherwise Atlas. Preview and Cancel do not write graph positions or knowledge. Save uses the
  existing revision-checked layout command. Locks and unrelated nodes survive;
  the existing 150-node local-arrangement bound applies. The renderer is unchanged
  in ownership: this adds drawing/preview methods to the existing Canvas/D3 view.
* Integration offers **Run AI review**, displaying the actual auditor model and
  data disclosure. Identity verdicts and connection discovery are separate outputs
  of one bounded submit-agent pass. Suggested identities need owner selection;
  new connections start unselected. Clearing suggestions permits manual review.
  **In Atlas** shows the proposed addition against current knowledge. Exact-name
  duplicates remain blocked. Similarity alone cannot merge mathematical objects.
* Selecting a concept offers Explain, Derive, Complete a proof and Practice. A
  selected typed connection also offers **Study this connection**. These seed the
  existing home composer; sending starts the ordinary teach/practice session with
  stable Atlas IDs, bounded notes and linked Library propositions/argument context.
  Concept IDs are never presented as formal proposition targets.
* Atlas-linked sessions offer **Review for Atlas**. Explicitly review their text,
  choose reuse/new/exclude identities and connections, inspect notes/arguments,
  select supported observations, self-report the outcome, preview and approve. Existing definitions/positions are
  preserved. Additional notes are sourced, not replacements. Repeated approval
  of a session revision reuses its receipt; another token cannot integrate that
  revision again. A later transcript revision can propose further enrichment.

## Mathematical evidence and personal evidence

AI connections distinguish association, missing argument and AI proof sketch.
Sketches retain conditions, rationale, uncertainty, source/model and their full
argument in the saved review and endpoint notes. Acceptance never upgrades a
sketch to checked mathematics. Unspecified links are ordinary associations,
not automatically analogies or implications. Typed links retain the existing
relation schema; matching type/endpoints/conditions reuse accepted relations
without overwriting their evidence. Alternative explanations/sketches remain
sourced notes about the same concepts.

An upper amber dot flags source/mathematical review. A lower blue/green dot
indicates retained self-reported learning evidence (with help/independent), not
verified mastery. Inspecting a node shows transcript-anchored observations,
assistance, date and session link. No calibrated mastery scores or FSRS events
are generated. Reading an AI proof never marks it independently reconstructed.

AI associations can be explicitly removed and archived. Deleting a concept
archives its incident ordinary lines; source/review records and notes survive.

## Contracts, ownership and recovery

SQLite v12 backs up a v10 database before adding:

* `mindmaps.subjectId`: optional primary organization, separate from map title.
* `atlas_sync_reviews`: version-1 captured source/review, model/usage, findings,
  exact digest and (for a lesson) approved choices/outcome and committed receipt.
* `atlas_learning_sessions`: validated, immutable session-to-Atlas context.
* `atlas_associations`: reviewed ordinary AI associations, separate from typed
  relations and revision-bound source-map depictions.

A backed-up v11→v12 follow-up also supports a dev owner that loaded the initial
subject/review migration before associations were added. Fresh and v10 databases
run both migrations.

All records have content hashes and runtime validation. Integration envelope v3
adds the proposed subject and optional audited suggestions/digest. Committed v1/v2
receipts remain readable and retryable; older uncommitted previews must be prepared
again. Source-only repair uses the original identity mapping as before.

Domain validation/projections remain pure core. The injected submit agent has no
store or writing tools. Server composition resolves the configured auditor for
map review and the session's conversation model for lesson review; there is no
silent billed-provider fallback. It retrieves explicit identities/neighbours and
text candidates, capped at 80 concept summaries, 1,600 note characters per concept
and 60,000 note characters total, with at most 160 typed links. The complete Atlas
is not uploaded. A lesson captures up to 80,000 transcript characters; map review
source JSON is capped at 160,000 characters. This is bounded text retrieval, not
a complete semantic search or guaranteed discovery of every useful connection.

Each explicit AI review permits at most two submit turns and five minutes.
Running/failed/cancelled records retain reported calls and source text; unreported
usage is not shown as zero. Refreshing an existing prepared review explicitly
requests another pass. An abandoned running review can be marked failed on an
explicit retry after six minutes; no provider call restarts automatically.

Prepared reviews bind source hash, saved draft revision and Atlas base revision.
Map approvals include selected suggestions in the existing deterministic plan and
digest. Lesson approvals bind the persisted review digest and exact choices;
source messages and Atlas version are checked again. New IDs are reserved from
the review/operation token. Notes are immutable content-addressed files, followed
by one SQL transaction for references, membership, links, observations and receipt.
A rollback leaves only unreferenced blobs. No canonical Library ledgers are written.
Notify-then-fetch uses the existing `atlas-changed` event.

Atlas-linked teaching sessions bypass legacy automatic extraction and its manual
coverage endpoint; they use explicit Review for Atlas. Ordinary upstream sessions
retain their previous extraction behavior. This does not claim the broader planned
teacher-extraction approval migration is complete.

## Validation and remaining gates

Deterministic fixtures cover subject membership and stale confirmation; conservative
identity reuse; selected cross-map suggestions; source/Atlas version binding;
proof-sketch provenance; ordinary-link exclusion from proof paths; transactional
failure/retry; duplicate source/token protection; historical association removal;
record tampering/future versions; v10 backup migration; bounded deterministic
layout; and existing importer/renderer/UI regressions. Provider work uses fakes.

Remaining: real-provider mathematical quality evaluation, owner browser/pen workflow,
canonical proposition/argument synchronization through Library with cross-store
journaling, identity redirects/corrections, whole-map rewrite reconciliation,
watchers, richer editable learning observations, scratchpad retention/vision,
research experiments and retrieval scheduling. The new notes/associations are
useful knowledge enrichment; they are not formal proof certificates or a completed
proof-chain learning engine.

Validation record, 29 October 2026: 201 focused regression tests passed, including
existing graph context and practice protocols; 36 store/synchronization tests also
passed in Electron's Node runtime. Typecheck, targeted lint and diff whitespace
checks passed. The live Chrome owner view was checked for Grid, persistent map
selection/highlight and camera-only centering; its API returned 26 concepts,
9 typed links and 15 source-map lines after the backed-up v12 migration. No live
model request or semantic integration was performed on the owner's profile.

Production packaging remains unvalidated: Turbopack cannot bind its CSS worker
port in this execution environment, including after requesting network access.
The Webpack fallback also fails on `node:crypto` through `core/coverage.ts` and the
public barrel. No compiler configuration or unrelated module refactor was added
to bypass those failures. Standalone packaging/smoke was not claimed against an
old build. The local development app remains running on port 3005.

Layout correction: arrangement saves send only `{id,x,y}`, stripping the private
index/velocity/fixed fields D3 adds to Organic simulation nodes. Flower now uses
a hub-rooted radial spanning tree with branch-sized angular sectors; the centrality
preset uses degree-based radial forces around a pinned hub. Disconnected components
are placed separately. These are spatial presets, not mathematical assertions.
