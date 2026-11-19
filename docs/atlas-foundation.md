# Atlas foundation

Open **Atlas** to create subjects and concepts. Concepts have stable IDs, aliases, several memberships, one preferred display subject, and explicit links to canonical propositions. Each concept appears once. Search includes titles and aliases. Renaming keeps placement. Changing the preferred subject seeds the concept near its new anchor. Subject parents must exist and remain acyclic.

See [layout and locks](atlas-layout.md), [saved views](atlas-views.md), [typed links](atlas-relations.md), [sourced paths](atlas-queries.md), and [demo cleanup and removal](atlas-demo-and-removal.md). Birth-session groups still describe proposition provenance.

## Ownership and writes

[`src/core/atlas.ts`](../src/core/atlas.ts) defines commands, ports, and the canvas projection. [`src/store/atlas.ts`](../src/store/atlas.ts) owns the SQLite schema and migrations. [`src/server/atlas.ts`](../src/server/atlas.ts) checks canonical references and handles HTTP. The existing Canvas renders the result.

The extension lives at `LH_DATA_DIR/atlas.sqlite` and uses built-in `node:sqlite`. Saves use short-lived connections, `BEGIN IMMEDIATE`, foreign keys, and full synchronous durability. The preferred subject must also be a membership. Canonical propositions and arguments stay in the graph ledgers. A missing canonical reference remains visible for explicit unlinking.

Creation expects revision 0. Edits require the exact revision. A stale edit returns 409 and keeps the draft. `atlas-changed` tells clients to refetch, including on reconnect. Older responses cannot replace a newer snapshot.

Subject removal requires reassignment of dependent concepts and child subjects. It archives the subject and reserves its ID. Concepts, positions, and canonical ledgers are preserved. Subject restore has no UI.

## Notes and recovery

Concept Markdown lives at `concepts/<concept-id>-<sha256>.md`. The file is flushed before the database commits its locator. Omitted note content keeps the current file. Older files remain available on disk. Failed saves can leave unreferenced files. Missing, edited, or symlinked files fail visibly and are never overwritten during reconciliation.

Newer, malformed, and unrecognized databases are refused. Preserve the migration backup and use a matching app version when restoring it. Back up the full data root with the app stopped, or use a consistent SQLite backup for the database and preserve the rest of the root. The database alone cannot restore Markdown, managed sources, or drawing files. Include credentials separately. Product-level restore UI, large-graph, and live multi-window sign-off remain open.
