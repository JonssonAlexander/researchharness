# Editable map review and approved Atlas integration

29 October 2026. R06–R09, R11, R14–R17. This is the concept/typed-association
slice of reviewed synchronization, not the complete Phase 3 semantic-sync engine.

## Workflow and meaning

A prepared second-pass map opens an editable review copy. Select a concept or
connection and expand Edit; change names, note Markdown/LaTeX, reasoning,
assumptions, uncertainty, endpoints, type and direction. Add concepts/connections,
or remove a concept with its incident draft connections. Save draft edits before
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
needs an owner-reviewed type and direction; an untyped/unclear drawn association
stays in the source draft until resolved. Excluding an endpoint requires excluding
its connection. Conditions come from the connection's assumptions. Analogy is
normalized symmetrically, other types keep their direction. Equal endpoints/type/
conditions reuse an accepted relation; a disputed/pending equivalent blocks
integration. No equality is inferred across different conditions.

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

SQLite schema **v9** adds `map_reviews` (append-only review versions),
`map_integrations` (prepared operations and exact committed approval receipts),
and `map_concept_reviews` (per-integration source provenance and review reasons).
The v8 baseline is backed up using SQLite before migration. Newer schema versions
are refused. Proposal envelopes remain v1/v2/v3; editable reviews and integration receipts
use envelope v1 and refuse unsupported versions. Prepared model drafts keep their
original digest. Review digests bind the parent proposal digest, version and
complete editable content; approval digests bind choices, operations and Atlas
base. Review saves require their expected revision. At most 100 integration
previews per draft are retained. Prepared receipts are retained but only one
committed receipt per proposal is permitted.

The existing extension owner applies only concept/typed-relation operations.
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
