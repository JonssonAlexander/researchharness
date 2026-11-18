# Research trails and workspaces: current implementation

This describes the local P0 implementation, not completion of the P0 acceptance gates. The design and later phases are in the workspace-level `research-trails-p0.md` and `research-roadmap.md`. Implementation is present; remaining acceptance gaps are recorded under Verification.

## Data and ownership

Atlas SQLite is authoritative for trail, node and workspace metadata. Schema version 16 adds `research_trails`, `research_nodes`, `research_workspaces` and `research_mutation_receipts`. Records are validated on read and write. The Atlas database's existing version gate refuses newer schemas; an existing v15 database receives a `.v15-<uuid>.bak` backup before migration. A failed migration rolls back its transaction. Research metadata does not replace or modify canonical proposition/argument ledgers or mathematical relations.

- A trail (`rt_<uuid>`) has a short title, root node, investigation status (`active`, `paused`, `resolved`, `abandoned`), optional archive timestamp, optional workspace, anchors with an optional primary anchor, origin and revision. Archive preserves the trail and project files.
- A node (`rn_<uuid>`) belongs to one trail and holds a title, notes, kind and related concept IDs. The root is a question and owns the question text. Parentage is a same-trail tree, not a mathematical edge. Cycles and cross-trail parents are refused.
- A workspace (`rw_<uuid>`) holds a label, canonical local root, revision and provision state (`pending`, `ready`, `repair-needed`). Several trails may share it; a trail binds at most one workspace.
- New concept links must exist when saved. Later deletion retains the historical ID; reads expose missing IDs. List projection includes the union of anchor and node-linked concepts. Node details are fetched separately from the regular Atlas snapshot.

Revisions reject stale edits. Create, branch, workspace registration and binding use client request IDs and durable receipts for retry safety; the same ID with different command content is rejected. Updates are transactions in the Atlas database. A research status or green thread signals an investigation, not proof, accepted mathematical knowledge, or learner mastery.

Limits currently enforced by the store include 1,000 trails, 200 workspaces, 500 nodes per trail, 32 nodes along a lineage, 50 concept links per record, 160 characters per title and 16,000 characters per node body. The selected-trail overlay supports all 500 nodes and the full 32-node lineage; a renderer test covers late and deep node selection without changing canonical data.

## Interaction and API

The Atlas inspector offers trail creation, anchors, node edits and branching, status/archive, workspace actions and hide/compact/selected overlay modes. Chat exposes a creation action with chat provenance; a lesson action includes the current lesson topic when available. Native source references are checked against the stored conversation and lesson. Unanchored trails remain available in the research list. Green markers and selected lineage are drawn as a separate overlay rather than canonical graph edges.

`GET /api/research` returns a compact trail/workspace list; `?conceptId=<id>` filters by anchor or node link, and `?trailId=<id>` returns a trail, its nodes and bound workspace. `POST /api/research` accepts the strict command schemas in `src/core/research-trails.ts`: `create`, `edit-trail`, `add-node`, `edit-node`, `bind`, and approved `workspace-bind`, `workspace-create`, `workspace-rebind`, `workspace-repair`, `workspace-open` actions. Workspace metadata's internal `workspace` command is refused at the HTTP boundary. Mutations require same-origin checks, JSON and a body of at most 65,536 bytes. Stale revisions return a conflict; the server emits `research-trails-changed` and clients refetch, including after reconnect or a possibly partial provisioning failure.

The relevant implementation is `src/core/research-trails.ts`, `src/store/research-trails.ts`, the v16 migration in `src/store/atlas.ts`, `src/server/research-trails.ts`, `src/server/research-workspaces.ts`, `app/api/research/route.ts`, and `components/research-trails.tsx` with the graph overlay in `components/graph-canvas.ts`. P0 actions do not invoke a model, execute project code, import experiments or interpret files.

## Project files and recovery

Binding uses an explicitly supplied existing folder path or creates a named folder under `~/Documents/Research Atlas Projects`. The service validates the canonical real path and rejects filesystem root, home, the application data root and its ancestors/descendants, protected configuration locations, traversal, and symlinked scaffold paths. It does not recursively scan the project or alter its source, Git configuration, dependencies or `.gitignore`. Opening resolves a registered workspace ID, requires a ready workspace and verified manifest, and on macOS launches VS Code with argv rather than a shell; other platforms report that opening is unsupported.

The workspace root contains this portable identity/interchange scaffold:

```text
.research-atlas/
  workspace.json
  trails/<trailId>/
    brief.md
    handoff.md
    runs/index.jsonl
```

`workspace.json` has `schemaVersion: 1`, a stable `workspaceId` and trail entries with `relativePath: trails/<trailId>`. The absolute root stays in local SQLite. The manifest is size- and schema-checked and a foreign workspace ID is refused. Missing scaffold files are published without clobbering existing files; manifest updates use atomic writes and synchronization. `brief.md` and `handoff.md` are editable working material, initialized once and not automatically rewritten or imported. `runs/index.jsonl` starts empty; P0 does not invent run records. The owner controls whether to commit `.research-atlas/`; private references, secrets and large generated data need separate care.

Provisioning records `pending` before writing and attempts to mark failures `repair-needed`. Retry/repair checks identity and fills missing files without replacing edits. If a folder moves, explicitly rebind the registered workspace to its new canonical path; the existing manifest must have the same workspace ID. A missing or foreign manifest is refused for rebind. If creation crashes after making the directory but before registering it in SQLite, creation cannot resume as the same registered workspace: explicitly bind that existing folder. Archiving never deletes the folder.

## Verification and remaining gates

Verified 18 November 2026 against application baseline `2aacd260` with the owner's pre-existing lesson/performance changes preserved. No dependencies added; no commit created.

- Typecheck, full lint and diff whitespace checks passed.
- Focused P0 storage, workspace, HTTP and UI tests passed. Updated historical migration fixtures: 140 tests passed. Graph canvas: 40 tests passed, including the full 500-node/deep-branch projection.
- Initial whole-suite run exposed historical migration fixtures retaining newly created v16 tables while pretending to be older databases. Fixtures were corrected; the final whole-suite rerun was stopped when the owner requested wrap-up. No complete final-suite pass is claimed.
- Actual isolated Next dev runtime on macOS, disposable data, Safari: created an anchored trail and child branch through native controls; selected-trail controls loaded correctly. No configured models or provider calls were needed.
- Real HTTP workflow bound a disposable dirty Git project, shared it between two trails and linked two concepts. Source bytes and tracked Git status stayed unchanged; repairing preserved owner-edited handoff text. Manifest contained one workspace and two stable trail IDs. Fixture evidence and reproducible API smoke script are in workspace `outputs/research-trails-p0/`.
- Explicit native Open in VS Code action returned HTTP 200 from the real macOS opener. Computer-use access to Code was not approved, so the opened window/folder was not visually verified. Browser connector was unavailable; Safari native controls supplied the UI check. No screenshot artifact was captured.

Remaining device gates: visual green geometry/zoom review, process restart and reopen, moved-folder rebind, and simultaneous-window convergence. Storage/workspace tests cover persistence and rebind semantics, but these do not replace those device checks. Do not mark every P0 acceptance checkbox complete yet. Temporary smoke server and full-suite rerun were stopped at wrap-up. P1's changed-work import and evidence review, and later autonomous workflows, remain future work.
