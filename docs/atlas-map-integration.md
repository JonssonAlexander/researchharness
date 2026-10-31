# Editable map review and approved Atlas integration

29 October 2026. R06–R09, R11, R14–R17. This is the concept/typed-association
slice of reviewed synchronization, not the complete Phase 3 semantic-sync engine.

## Workflow and meaning

A prepared second-pass map opens an editable review copy. Select a concept or
connection and expand Edit; change names, note Markdown/LaTeX, reasoning,
assumptions, uncertainty, endpoints, type and direction. Add concepts/connections,
or remove a concept with its incident draft connections. In the editable isolated
proposed map, hold Shift and drag between nodes to toggle their connection (either
direction). An existing pair's connections are removed; a new pair gets an untyped
association for review. A dashed guide follows the pointer without moving nodes.
Dropping on empty space/the same node, releasing Shift early or cancelling does
nothing. Save draft edits to retain the change. Main Atlas, comparison and
integrated/read-only views keep their normal gestures. Save draft edits before
leaving or integrating. Leaving with unsaved work asks before discarding it;
saving is explicit and does not call a provider. Saved review versions are retained;
model output, original handwriting and earlier readings remain unchanged. Text
changes to note blocks become added explanations with an owner-edit attribution.

Math in titles uses the existing content-span parser and installed KaTeX. Prose
is inserted as text, TeX uses untrusted-mode rendering, and labels follow the
existing renderer's camera, drag positions, label fade and visibility filters.
Ordinary labels retain the Canvas path. Formulae are typeset in the proposed
and main Atlas graph, and Markdown/math remains available in notes.

An amber dot means unresolved notation/meaning, thin explanatory notes, or
unverified reconstruction/background. The inspector names the reasons. This is a
transparent heuristic, not a correctness or mastery score. Source transcription
rationale ("visible text") is not a derivation. Literal labels do not need invented
proofs; mathematical explanations should supply definitions, conditions and useful
reasoning. The refinement prompt now requests that depth in separate attributed
blocks. Existing drafts are not automatically regenerated or sent to a provider.

Choose **Integrate…** to resolve each node as create, reuse, or exclude/defer.
Possible name/alias matches are shown; an exact existing name/alias cannot create
another node. A human chooses identity: substring candidates do not establish
mathematical equivalence. Reusing preserves the existing title, aliases,
proposition links, memberships and coordinates, and appends sourced notes rather
than replacing them. Two draft nodes cannot target one existing identity; merge
or defer them in the draft first. There is no automatic destructive Atlas merge,
redirect maintenance, or mathematical identity auditor in this slice.

Choose a subject for new concepts and explicitly select connections. A connection
can be kept as an ordinary mind-map association regardless of type or direction.
These map lines default to included for kept endpoints; review/exclude them
individually. Optionally, explicitly select a typed mathematical relation with
an owner-reviewed type and direction. Ordinary lines never imply a theorem. Excluding an endpoint also excludes its map lines from the submitted choices. Conditions come from the connection's assumptions. Analogy is
normalized symmetrically, other types keep their direction. Equal endpoints/type/
conditions reuse an accepted relation; a disputed/pending equivalent blocks
integration. No equality is inferred across different conditions. Ordinary associations are
not used by mathematical path queries or the proposition/argument ledger.

**Preview integration** persists the exact operations and shows counts. **In Atlas**
compares the proposed additions with the current Atlas concept projection;
proposition/argument-ledger nodes are not included in this comparison. Existing
positions remain fixed. New concepts retain the draft's relative force layout,
placed alongside the chosen subject/existing region. **Approve and integrate**
submits that exact digest and rechecks the current source, review and Atlas base.
Changes invalidate approval. Acceptance records source-backed typed associations
as external assertions, not checked arguments or formal implication chains.
Canonical Library proposition/argument ledgers are untouched. The source original
and captured image blobs are hash-verified again before committing.

The exact draft, selected/excluded operations and identity mapping stay in the
receipt. Full reasoning, assumptions and residual uncertainty stay in the review
and appended Markdown. Source-concept links and amber reasons appear in Atlas;
click the concept and open Atlas to inspect them. A later reinterpretation of the
same source/draft key cannot silently append competing notes: it requires review
as a correction to the existing notes. Integrated drafts are immutable, and a
repeated request returns the original receipt.

## Storage and recovery

SQLite schema **v9** introduced `map_reviews` (append-only review versions),
`map_integrations` (prepared operations and exact committed approval receipts),
and `map_concept_reviews` (per-integration source provenance and review reasons).
The v8 baseline is backed up using SQLite before migration. Newer schema versions
are refused. Proposal envelopes remain v1/v2/v3; editable reviews use envelope v1. New
integration receipts use v2, binding ordinary lines separately from typed
relations. Old committed v1 receipts keep their original digest and retry
behavior. Old uncommitted v1 previews require preparing again; their approval
is never silently expanded. Prepared model drafts keep their
original digest. Review digests bind the parent proposal digest, version and
complete editable content; approval digests bind choices, operations and Atlas
base. Review saves require their expected revision. At most 100 integration
previews per draft are retained. Prepared receipts are retained but only one
original committed receipt per proposal is permitted, plus explicit connection-only
repair receipts.

The existing extension owner applies concept, typed-relation and ordinary
source-map-association operations.
Content-addressed Markdown is written via a same-directory temporary file,
fsync, non-replacing publication and directory fsync before SQL references it.
A SQLite transaction commits all concept/relation rows, source links, review
markers, base revision and the exact approval receipt together. A crash before
COMMIT leaves no partially visible semantic update; staged unreferenced blobs
may remain. A crash after COMMIT returns the same receipt on retry. There is no
cross-file mutable-ledger transaction and no automatic replay of an unapproved
prepared record. Retrying requires the same explicit digest approval. This is
under the existing one-writer-per-profile contract, not multiprocess coordination.
Backups require SQLite plus concepts and mindmaps, as before.

## Validation and remaining gates

Isolated tests cover versioned edits, immutable originals/model output, exact
approval, changed bases/source/drafts, duplicate identity choices, existing-note
preservation, dependency checks, exact relation reuse, backup/restore and retries.
A forced SQL error after staged notes rolls back metadata. Subprocess exits after
blob publication, before SQL COMMIT and after COMMIT verify recovery. UI tests
check exact approval requests and error visibility; untrusted math labels are
checked without browser HTML injection. Native interaction/visual QA must be
reported separately; headless DOM tests do not certify appearance or pen use.
No paid model calls are needed for these checks.

Remaining Phase 3 work includes durable source/relation depiction semantics across
rewrites, mathematical proposition/argument proposals through Library's identity
auditor/merger, partial-operation dependency review across canonical stores,
redirect/merge maintenance, watchers and routing teacher extraction through the
same approval boundary. Owner review of one real map is still required.

Next product slice is the planned end-to-end learning loop: choose a sourced
concept, orient, attempt a mathematical explanation/derivation independently in
Understand (including scratchwork), receive feedback with assumptions and hints
retained, and propose any corrected knowledge through review. Understanding is
recorded as evidence about the learner, separately from mathematical status.
Then add research records and reproducible selected-project experiments, technique
practice, budgeted FSRS retrieval and separate challenging problems. Discovery
suggestions must cite actual gaps/evidence and remain hypotheses, not merely
nearby graph nodes. Broader reliability/scale and real pen/provider tests follow.

Verification on 29 October 2026: 114 targeted Node tests and 25 Electron-as-Node
runtime tests passed, alongside typecheck, targeted lint, production build and
packaged Electron/server smoke. A packaged HTTP round trip saved a review,
prepared an integration, rejected missing approval, committed 12 synthetic
concepts and returned the same receipt on retry. Its untyped connections were
correctly excluded. No live provider calls were made. Native browser interaction
was unavailable (`noWindowsAvailable`), so live visual/drag QA remains pending;
the screenshots obtainable before that failure do not establish the new view's
appearance. The owner's actual source was not integrated by engineering checks.


## Ordinary map lines and repair (schema v10)

The earlier v9 UI only integrated explicitly selected typed links, leaving ordinary
lines behind. Schema v10 adds `map_connections`, with source/target concept IDs,
proposal and connection keys, source revision/hash, observed direction, label,
origin, evidence, rationale, assumptions and uncertainty. The unique
(proposalId, connectionKey) preserves each reviewed depiction once. Rows have
strict envelopes and content hashes. The v9 database is backed up before upgrade;
future schema/envelope versions are refused. No migration automatically accepts
old omitted lines.

Main Atlas renders ordinary map associations as dotted lines without arrowheads;
accepted typed links retain their dashed appearance. Multiple source depictions
of the same pair draw one line, and an accepted typed link takes visual priority.
The source rows remain distinct for provenance. Concept inspection lists source
map associations, labels and uncertainty. They take part in local spatial layout,
never mathematical path finding, logical depth or proof derivation. Query focus
hides ordinary lines to avoid presenting them as steps of a typed path.

Only active, current source revisions project their depictions. Archiving a map
or importing a replacement hides the old source lines without deleting their
records or any mathematical relation. This is bounded source-depiction visibility,
not complete semantic reconciliation across rewrites. Removing a concept archives
its source-line records with the concept, then cascades active references; the
original integration receipt and drawing remain retained. Per-line post-integration
correction/removal UI is future work.

An already-integrated draft offers **Restore map connections…** → **Preview missing
connections**. The server uses only the original receipt's approved node mapping,
never title matching, new nodes, renames, notes changes or relation promotion.
Excluded/deleted endpoints are listed as skipped. Already-present connection keys
are omitted. The exact v2 repair receipt binds the original receipt ID, source,
review, Atlas base and full proposed associations. **In Atlas** shows their placement;
**Approve and restore connections** commits that digest. A changed source/base or
competing repair invalidates approval. Repeated commit returns the saved receipt;
subsequent preview finds zero missing lines. The original receipt is immutable.

Repair receipts share the existing integration journal, but the uniqueness rule
now limits one *original* committed integration per proposal while permitting
separate explicit repairs. All association inserts, journal receipt and global
Atlas version commit in one SQLite transaction. No model call is made. Preview
alone leaves graph data unchanged. Only the explicit approved repair adds lines.

Focused checks cover untyped/unclear lines, preservation of annotations, legacy
v1 repair, excluded/deleted endpoints, stale/concurrent repairs, rollback/retry,
source archive/replacement projection, row tampering, upgrade/backup/restore and
separation from mathematical path queries. UI tests cover preview-before-approval
and exact digest submission. Live graphical appearance remains a separate gate.

Verification for this slice (29 October 2026): 132 targeted checks passed,
with the added connection-row tamper case also passing in the 20-test store run.
The 19-test Electron store run, typecheck, targeted lint, production build and
packaged Electron/server smoke passed. A real, uncommitted repair preview for
stoch init found 15 missing lines and skipped 4 excluded-endpoint connections;
it proposed zero new concepts or typed relations. No model calls or semantic
writes to the owner's graph were made by that preview. Source originals and old
approval receipts were preserved. Live visual appearance remains unverified.


29 October follow-up: integration envelope v3 requires an existing/new subject,
applies membership to reused concepts, and can include explicitly selected AI
identity/bridge review results. Committed v1/v2 receipts retain their old meaning.
See [reviewed discovery and learning](atlas-reviewed-learning.md) for schema v12,
approval bindings, UI and remaining Library synchronization gates.

### Repair excluded identities (29 October 2026)

A repair can now explicitly map previously excluded/removed draft nodes to existing
Atlas concepts, then restore their incident source lines. It cannot create nodes,
remap a surviving approved identity, collapse two draft nodes into one, edit notes
or promote a mathematical claim. The exact preview binds these additional identity
choices, any subject membership and capture-reference updates, and all missing lines.
Earlier repair mappings are recovered from committed receipts; the original receipt
remains immutable. Subject memberships preserve existing preferred placement. All
updates share one SQL transaction; a failed insert rolls back membership and source
references too. No database schema migration is needed.

New import UI keeps potential identity matches visibly undecided until explicitly
resolved. An undecided match cannot silently become Exclude/defer. Intentional
exclusions are listed before approval with a warning about dropped lines and
possible fragmentation.
# Reviewed additive updates — 30 October 2026

A new proposal for a previously integrated map now prepares an integration
envelope v4. Previously approved, unambiguous identities from that map are
preselected when titles still agree; conflicting, removed or changed-name
identities require review. Current saved integration choices resume after reload.
No global name matching automatically authorizes a merge.

The update preview lists added, changed and unchanged note contributions, with
previous/proposed text. Changed readings are appended with an explicit update
label; existing owner notes, source originals and earlier integration receipts
remain intact. Unchanged contributions (ignoring source/draft/evidence metadata)
are not appended again. New source references and membership use the same atomic
commit. Accepted typed relations are reused by their existing semantic key;
matching source lines in the same revision are reused by endpoints/direction/label.

This is an **additive update**, not full rewrite reconciliation: omitted concepts,
source lines and mathematical claims are retained. Changed depiction metadata can
remain alongside earlier evidence. Explicit removal/reconciliation is pending.
There is no schema migration; unsupported envelope versions are refused. Legacy
receipts retain their original digest meaning. Exact retries return the existing
receipt, stale previews fail, and SQL failures roll back the entire update.
Failed UI approval clears the obsolete preview instead of leaving an active
approval button beneath an error.
# Reviewed drawing reconciliation — 30 October 2026

Updates prepared with the optional `reconcile` choice use integration envelope
v5. The UI enables drawing reconciliation for updates and offers an explicit
additive-only alternative. The preview groups added, changed and missing lines,
lists nodes leaving this drawing, and retains the previous/proposed note review.
The In Atlas comparison omits lines scheduled for retirement.

One digest-bound approval archives replaced/missing source lines in
`atlas_archive` (`kind=map-connection`) before removing their active rows. The
archive includes the original connection and retiring integration ID. Omitted
previously integrated nodes lose their current drawing reference only: concepts,
notes, memberships, typed mathematical relations, AI associations, original files,
old captures and approval receipts remain. Changed arrows are source depictions,
not changes to mathematical claims. Reconciliation is scoped to this map's
captures, never another map or general Atlas relations. Historical lines and
originals remain inspectable through retained records; no archive restore UI is
provided. Older proposals cannot use repair to resurrect lines after a newer v5
update. New source revisions receive their own references; old captures remain.

Archival, line insertion, reference updates and the receipt share one SQL
transaction. Failed inserts roll back archival/deletion; exact retries return the
committed receipt and stale bases cannot commit. No schema migration is needed.
Legacy v1–v4 receipts/previews keep their original semantics. Interpretation
completeness and semantic identity ambiguity still require review; renames are
not inferred from similar wording.
