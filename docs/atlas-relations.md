# Typed concept links — as built

28 October 2026; Phase 2, R02, R08, R09, R14 and R16. This slice adds manual
concept-to-concept links, not canonical mathematical arguments or sourced queries.

## Use and meaning

Select a concept in Atlas, then **New link**. Choose source, target, type,
conditions, claim status, review status and optional source citations. A new link
starts as a proposed hypothesis. Saving is an explicit owner action; no model tool
can save or approve it. Accepted links require at least one nonempty citation.

| Type | Direction |
|---|---|
| Prerequisite | Source is required before target |
| Generalization | Source generalizes target |
| Analogy | Symmetric; endpoints stored in stable ID order |
| Counterexample | Source is a counterexample to target |
| Application | Source is applied to target |
| Hypothesis | Source has a hypothesized connection to target |

Claim status is separate from the owner's review decision. Claims can be hypotheses,
external assertions, numerical observations, proof sketches or checked arguments.
Review states are proposed, accepted, disputed and retracted. “Accepted” means the
owner retained a link, not that the app verified a theorem. A checked argument is an
owner assessment; there is no formal-verification claim or automated source check.

Accepted links appear as dashed, headless lines between concept rings in the existing
canvas. Click a concept to inspect link type and direction, conditions, statuses and
sources. Proposed, disputed and retracted links remain in the panel but do not appear
as accepted canvas links. The inspector has source/target navigation and editing.
Retract through **Edit link → Review status**; there is no destructive link deletion.

Source citations and page/section locators are plain owner-entered references. They
are not fetched, opened, uploaded, or represented as captured immutable sources.
Managed source revisions and evidence attachment selection remain future work.

## Domain and storage

`src/core/atlas-relations.ts` owns validation and analogy normalization.
`components/atlas-relations.tsx` is the inspector/editor. Existing `/api/atlas`, the
store port and SSE refetch path serve saves and snapshots; models gain no new tools.
The formal ledgers, argument derivation and force-layout links are untouched.

Schema v3 adds `relations` and `relation_revisions` to `atlas.sqlite`. A relation has
an `ar_` ID, concept endpoint foreign keys, type, conditions, separate claim/review
statuses, JSON citations, integer revision, UTC creation/update times and SHA-256
content hash. Every accepted save appends a full revision record in the same SQLite
transaction as its current row. These receipts include proposed and retracted saves,
not only review state “accepted.” Historical records are retained; a history UI is
not implemented.

Uniqueness is `(sourceId, targetId, relationType, trimmed conditions)`, independent
of review/claim status. Only analogy normalizes endpoint order. Reversed directed
links and different conditions are distinct. Retracted links still reserve their
identity/key; edit that link instead of recreating it. Self-links, missing endpoints,
unknown enums, stale revisions and duplicate identities/keys are refused. Persisted
rows are validated, hashed and checked for foreign-key corruption on read. Similar
names never trigger automatic identity merges.

Existing v2 databases get a consistent `VACUUM INTO` backup beside the original
before the transactional v3 migration. v1 databases retain their pre-upgrade backup
and pass through v2. Fresh databases initialize through the same schema steps.
Future versions are refused. A failed migration rolls back its schema changes.
Restore the matching backup with the older app while stopped to roll back; retain
newer data separately. Continue backing up the full data root, including Markdown.

## Limits and verification

No sourced path-query service, saved perspectives, inferred links, agent writes,
attachment-backed evidence, history UI or formal proof verification is added here.
Canvas lines use the current edge visibility setting; type/direction are inspected
in the panel rather than encoded into formal proof-arrow geometry.

Focused checks cover all six types, analogy symmetry, direction, deduplication,
conditions, citations, separate statuses, stale saves, revision history, preserved
canonical ledger bytes, accepted-only canvas projection, corrupted records, v2
upgrade/rollback, retained UI drafts and source/status inspection. Tests use isolated
data with no provider calls. Visual canvas interaction still needs real-browser
sign-off; no scale or Windows/Linux performance claim is made.

Passed locally: 125 focused tests, 19 Atlas tests under Electron, lint, typecheck,
production build and packaged Electron smoke. A disposable production HTTP check
verified relation save, stale-write refusal and restoration after process restart.
The live app served home and Atlas successfully. The full suite was not rerun.
