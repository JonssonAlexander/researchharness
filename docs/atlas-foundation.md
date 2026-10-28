# Atlas foundation — first Phase 2 slice

Implemented 28 October 2026. This is an incremental implementation of R01–R03,
R09, R14, R16 and R17, not completion of Phase 2.

## Available behavior

In the graph view, open **Atlas**, create subjects, then create concepts. A concept
has a stable identity, title, aliases, several subject memberships, one preferred
display subject and links to existing propositions. Subject names, colors and
parentage are editable. Parents must exist and cannot form cycles.

Each concept appears once as a colored ring in the existing canvas. Its other
memberships remain visible in the inspector. Search includes titles and aliases.
The initial persisted placement is relative to its preferred subject anchor;
renaming retains placement, while changing the preferred subject moves that
concept only. Concepts are fixed in this slice; cluster dragging and locking are
not yet implemented. Birth-session proposition clusters retain their existing
meaning and rendering.

These are explicit manual edits. Models have no Atlas write tool. Existing
teaching, practice, provider routing and canonical graph extraction are preserved.
The Atlas panel currently requires the graph view to be enabled.

## Ownership and schema

`src/core/atlas.ts` defines validated commands, store ports and the pure canvas
projection. `src/store/atlas.ts` owns SQLite access. `src/server/atlas.ts` coordinates
canonical reference validation and HTTP responses; `app/api/atlas/route.ts` delegates
through the server barrel. `components/atlas-panel.tsx` owns the editor and fetch
hook. The existing canvas renders the projection; no second renderer is introduced.

The extension lives at `LH_DATA_DIR/atlas.sqlite`. It uses built-in `node:sqlite`
in Node 26 and Electron 44's bundled Node. No new package is required. Connections
are short lived; saves use `BEGIN IMMEDIATE`, foreign keys and full synchronous
durability. New directories/files request owner-only modes. The existing trusted
local-server assumptions still apply.

The concept/subject slice introduced schema v2. The current schema is v4 ([archives/removal](atlas-demo-and-removal.md));
[typed concept links](atlas-relations.md) add relation tables and document migration.
The foundation tables are:

| Table | Stored fields |
|---|---|
| `subjects` | `as_` ID, title, color, optional parent ID, revision, anchor x/y |
| `concepts` | `ac_` ID, title, JSON aliases, preferred subject ID, revision, x/y, Markdown hash locator |
| `concept_subjects` | Unique concept/subject pairs with foreign keys |
| `concept_propositions` | Unique concept/canonical proposition ID pairs |
| `subject_archive` | Removed subject ID, previous record JSON, UTC removal time |

The preferred subject must also be a membership. SQL enforces that association
with a deferred composite foreign key. Definitions of `n_` propositions and
`arg_` arguments stay exclusively in the upstream ledgers. Atlas saves validate
proposition IDs against those ledgers; missing links remain visible on reads so
owners can explicitly unlink them. No canonical definition is copied or changed.

Creation expects revision 0; edits require the exact current revision and increment
it. A stale edit returns 409 and the form retains its draft. Notifications use the
existing `atlas-changed` SSE vocabulary followed by authoritative refetch, including
reconnect. Older fetch responses cannot replace a newer snapshot.

An empty database initializes transactionally. Version 1 upgrades to version 2
after a consistent SQLite `VACUUM INTO` backup alongside the database. The upgrade
adds the note locator and subject archive in one transaction. To roll back, stop
the app and restore the v1 backup with the v1 app; preserve newer data separately. Future versions, unrecognized
nonempty databases and malformed records fail visibly. There is no automatic repair. Before a later schema change, add
an explicit migration and rollback/restore coverage. This first slice does not yet
store general entity audit timestamps or an accessible revision-history UI.
Note files have SHA-256 hashes; subject removals have UTC timestamps.

Back up with the app stopped, preserving the complete data root and separately
configured credentials as appropriate. For a live SQLite backup, use SQLite's
backup API; copying only the database file while a writer is active is insufficient.
A supported SQLite backup restored into a fresh directory is covered by tests.
A complete product backup/restore UI remains pending.

## Validation and outstanding gates

The initial slice passed on macOS: typecheck, lint, production build and the full
2,550-test suite.
Focused coverage exercises membership, single rendering, identity and placement
across reopen, stale writes, transaction rollback, hierarchy cycles, missing
canonical references, future/corrupt schema refusal, SQLite backup restore, HTTP
validation, retained UI drafts and out-of-order refetches. The 11 Atlas storage/API
tests also pass under Electron's bundled Node. Packaged server smoke checks pass
under both host Node and Electron, including `/api/atlas`, without provider calls
or real credential access.

An isolated production HTTP exercise also passed creation, many-to-many membership,
stale-write refusal and exact snapshot restoration after a server-process restart.

The notes/removal follow-up passed 118 focused tests (including graph and
Markdown rendering), lint, typecheck and the Atlas storage tests under Electron.
Migration rollback and a full-root note restore have dedicated test coverage.
Production build and packaged Electron server smoke also passed; the live app
returned 200 for home and Atlas. The full suite was not rerun for this bounded
follow-up.

Native browser automation was unavailable, so actual canvas interaction, visual
appearance, keyboard/focus behavior and zoom inspection have not received visual
sign-off. Windows/Linux execution, scale measurements and live multi-window
interaction remain unverified.

Subject removal is implemented through the subject edit form. Its confirmation
shows dependent concepts and child subjects. Reassign these first; the server
refuses removal while any remain. Revision checks guard stale saves. Removal
archives the subject record; concepts, positions and formal ledgers stay intact.
The archived ID cannot be reused. There is no restore UI yet.

Concept notes are edited with the concept and rendered through the existing
Markdown/LaTeX component. Files live at `concepts/<concept-id>-<sha256>.md` beneath
the data root; the database locator is the hash. Files are written and flushed
before their locator commits. Old files are retained; failed saves can leave
unreferenced files but cannot publish a partial note. An omitted note field
preserves its existing content. External file edits or missing files fail visibly
without overwriting that work; reconciliation UI remains pending. Symlinked note
files/directories and invalid locators are refused. Back up the full data root,
including Markdown files and SQLite; the database alone cannot restore notes.

Manual typed links with owner-entered citations are now available; see
[typed concept links](atlas-relations.md). Managed source revisions remain pending.

Read-only sourced concept paths and temporary focus are now available; see
[query semantics and limits](atlas-queries.md).

Remaining Phase 2 work includes
saved perspectives, timestamps/history, movable/lockable
subject clusters, hierarchy visualization and layout interaction acceptance. Rnote,
reviewed synchronization and handwriting belong to subsequent slices. The first
slice does not satisfy the full Phase 2 exit criteria.
