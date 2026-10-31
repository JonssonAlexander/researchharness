# Node emphasis and direct connection editing

30 October 2026; R01–R03, R08–R09, R14 and R16.

The home graph stays conceptual and uses the existing Canvas/D3 renderer. Select a
concept and choose Small, Normal or Prominent in its Atlas panel. Alternatively,
hold 1 (Small), 2 (Normal) or 3 (Prominent) and click a concept. The gesture
changes size without opening its panel; typing in fields is unaffected. Held keys
clear on focus loss. This changes the
node radius (0.65×, 1×, 2×); prominent labels are 1.15×. Camera, positions, force
layout, identity, claim status and learning evidence do not change. Emphasis is a
local working choice until Saved views → Save view or Update current view. Opening
another saved view restores its own emphasis, with legacy views using normal size.
Up to 500 explicit choices per view are supported. Reloading starts with normal
emphasis until a saved view is opened; the last camera remains device-persisted.

Click a dotted/dashed Atlas line to open all connections between that pair. At
crossings the closest segment within six screen pixels wins; nodes take priority.
Filtered links cannot be picked. Shift-drag between two concepts opens this same
editor without changing the graph. A node's panel also offers a connection chooser.
The proposed-map editor retains its existing Shift-drag toggle behavior.

Ordinary lines can be added, relabelled, redirected, rewired or removed with an
explicit Save/confirmed removal. Removed ordinary lines can be restored while the
pair's editor remains open, or by reopening the pair through the concept chooser.
Typed relationships retain the existing conditions, source, claim/review status,
revision checks and confirmed deletion editor. An ordinary line never creates a
mathematical claim or proof. Direction is inspected in the editor; this slice keeps
the existing dotted/dashed, headless drawing styles.

Imported/AI source lines are immutable. Owner changes are overlays in
`atlas_drawing_links`; removal is a retained tombstone. Original source files,
proposal/integration receipts and concept notes stay unchanged. Each subsequent
edit archives the previous overlay in `atlas_archive`. Current drawing projection
and local arrangement consume effective lines, including these edits. Source-bound
overlays disappear when their source line/revision is no longer active; new source
records do not silently inherit edits. Independent owner lines remain. Future
semantic reconciliation of owner edits against new imports is still pending.

Schema v13 adds optional JSON emphasis to `atlas_views`, and a hashed drawing-link
table. Existing v12 profiles get a consistent `.v12-<uuid>.bak` before transactional
DDL; failed DDL rolls back. Saves use the existing `/api/atlas`, one-writer
transaction and SSE refetch. Drawing edits require the current Atlas version;
view edits use the per-view revision and do not advance layout version. Concept
removal archives incident overlays and clears that concept's saved emphasis.

Focused tests cover view isolation/restart, stale saves, duplicate ordinary lines,
removal/restore history, immutable imports/notes/claims, migration backup/rollback,
filtered camera-aware picking, retained UI drafts and confirmed removal. No model
calls or renderer replacement are involved. Full semantic rename reconciliation,
canonical derivation navigation and independent learning assessment remain outside
this slice.
