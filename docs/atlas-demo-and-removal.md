# Demo data and confirmed removal

28 October 2026; Phase 2, R01, R09, R16 and R17.

## Try the demo

The owner-requested demo was loaded into the local app through `/api/atlas`.
It has three subjects (Probability, Analysis, Computation), nine concepts and nine
links. All subject/concept titles begin with `Demo ·`. The generator belongs to
both Probability and Analysis and renders once, in Analysis. Concepts have small
Markdown notes. Links are accepted for display but explicitly marked as unverified
hypotheses with placeholder citations. They are UI fixtures, not mathematical
evidence. No formal propositions, arguments, sessions or provider calls are created.

Open Atlas, or refresh and use **Fit graph** to bring all nodes into view. Try
**Find a connection** from **Demo · Brownian motion** to **Demo · Heat equation**.
Then use **Show path in graph** and inspect each step's status and citation.

**Atlas → Demo data** has **Load demo** and a confirmed **Remove demo** action.
Loading is disabled while any demo item remains. After cleanup, loading creates
new IDs so deleted identities are never silently reused. Fixture IDs use the
reserved `dea00000` UUID prefix and a per-load random batch suffix. Cleanup uses
that namespace, never mutable titles or aliases.

Removal preflights links from ordinary records into demo data and refuses shared
memberships, parent relationships or links. The owner must detach those first.
It then removes demo links, concepts and subjects, in order, with current revision
checks. Each operation is transactional, but the whole batch is not atomic. If it
stops partway, Remove demo can retry the remaining records. Concurrent new links
also block individual deletes. Confirming demo cleanup includes owner edits to
those fixture records; other identities are preserved.

## Remove individual items

- **Concept:** Edit concept → Delete concept → Confirm delete concept. All links
  must first be deleted. Memberships and proposition associations are removed;
  canonical propositions and arguments are preserved.
- **Link:** Edit link → Delete link → Confirm delete link. Both concepts remain.
  Retraction is still available when the desired action is to keep the link as a
  withdrawn claim. Deleting removes it from the live graph and query snapshot.
- **Subject:** Edit subject → Delete subject. Concepts and child subjects must
  first be reassigned, as before.

Stale removals fail with a visible error and retain the form. A removed concept or
link ID cannot be reused. New links can reuse the semantic key of a deleted link
under a new explicit identity; retracted live links continue to reserve their key.

## Schema and recovery

Schema v4 adds `atlas_archive(kind, id, record, removedAt)`. Each concept removal
stores its current record, including Markdown, before deleting its joins and row.
Its Markdown files remain on disk. Link removal stores its current record and all
revision records before deleting the live revision/current rows. Archiving and
removal commit in the same SQLite transaction. Subject removal retains its existing
`subject_archive` path. These actions remove live objects; they do not erase history.
There is no archive restore UI yet.

A v3 upgrade makes a consistent SQLite backup beside the database, then creates
its archive table transactionally. Earlier versions retain their existing upgrade
backups. Future versions are refused. Continue backing up the complete data root,
including retained Markdown files. To roll back the schema, stop the app and restore
the matching backup using the older app, retaining newer data separately.

## Checks

Fixture tests cover confirmed UI removal, stale edits, link dependencies, archived
notes/history, identity reuse refusal, demo cleanup/reload, interrupted cleanup
retry, preservation of owner records, shared dependency refusal and v3 migration.
No test removes the demo loaded for the owner; destructive checks use temporary data.
Real-browser visual sign-off remains pending. The owner can use the loaded sample
for that check. Full backup/restore UI and permanent erasure are not added here.

Passed: 81 focused tests, 22 Atlas tests under Electron, lint, typecheck, production
build and packaged Electron server smoke. The loaded demo has a four-step cited
fixture path from Brownian motion to Heat equation. Its import compared all
preexisting Atlas records and found them unchanged. The full suite was not rerun.
