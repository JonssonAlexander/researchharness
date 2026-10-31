# Atlas force layout and saved placement

28 October 2026; R01, R02, R03, R09, R16 and R17.

## Current behavior

Concepts now use LearnHarness's `createGraphSimulation` (D3 link springs and
repulsion), rather than unconditional pins and isolated manual movement. The same
canvas, camera, zoom-gated labels, hover, soft subject regions and formal graph
remain. Concepts use filled subject-coloured dots. Accepted semantic links remain
dashed and headless, and act as undirected springs **only for spatial layout**;
their stored direction, type and mathematical status are unchanged.

Dragging reheats a local concept simulation. Release unpins the dragged concept,
lets nearby concepts settle and saves the resulting positions together. A weak
spring toward saved placements preserves spatial memory; a weaker spring toward
the subject anchor keeps the region recognizable. Cross-subject endpoints remain fixed and no longer exert link springs on a local
subject: a reference to a distant topic must not stretch its shape. Unrelated subjects and canonical proposition nodes do
not move. Successive drags/arrangements in different subjects before settling
combine only those explicitly touched regions into the same bounded layout.

New/re-homed concepts and newly accepted or endpoint-changed links trigger settling
in the affected source/preferred subject when an Atlas snapshot updates in an open
client. Initial loading, reloading, renaming, note edits and temporary query filters
do not initiate relayout. This is client-side interaction, not a background server
layout job. Existing maps are not silently rearranged on upgrade.

Atlas → Subjects offers **Arrange** and **Lock / Unlock** for each subject. Arrange
uses the same warm-started engine. Lock freezes concepts whose preferred placement
is that subject; it is a spatial lock, not a restriction on editing knowledge.
Memberships in additional subjects do not create extra copies or extra lock rules.
Whole-subject dragging and named camera/search views are now available; see
[subject movement and saved views](atlas-views.md). Parent/descendant lock inheritance
and an interactive hierarchy layout remain pending. `subject-position` remains an anchor-only maintenance command; the separate
`subject-move` operation translates members atomically.

## Storage and conflicts

Schema v5 adds `subjects.locked` (existing subjects default unlocked) and a global
`atlas_layout_version`. Existing v4 databases receive a `.v4-<uuid>.bak` SQLite
backup before a transactional migration. Earlier versions retain their existing
backup/upgrade chain. Future schemas are refused. No canonical graph or Markdown
format changes.

The strict `layout` command sends a global expected revision and a unique list of
concept positions. The store saves the entire batch or none, increments moved
concept revisions, and rejects stale snapshots, missing concepts and locked
subjects. Every successful Atlas edit advances the global revision, so a topology
change or a lock in another window invalidates an older simulation. Invalid saves
show a visible error and reload authoritative coordinates. `subject-lock` uses the
subject's own optimistic revision. Explicit `concept-position` commands remain for
fixtures and maintenance, but cannot move a locked concept.

Finite coordinates are bounded to ±1,000,000. Local work is limited to 150 moving
concepts, 500 total nodes including fixed boundary endpoints and 2,000 incident
accepted links. Exceeding a limit shows an error instead of moving a partial subset.
Formal proposition drag/settle uses its original simulation and positions ledger;
Atlas positions are never sent to that ledger. Pointer cancellation releases pins.

The previous sample-title cleanup is retained: no “Demo ·” prefixes; reserved IDs,
notes and citations still identify removable illustrative fixtures. New subjects
and concepts retain their near-subject seed positions, then local forces provide
spacing. Subject headings remain above their topmost member. The owner's prior
node/label size preferences remain unchanged by this correction.

## Validation

Focused tests cover deterministic local settling, link influence, input purity,
drag/release, fixed cross-subject boundaries, explicit locks, work limits, combined
regions, atomic batch rollback, stale topology, schema v4 backup/upgrade and reopen
persistence. Existing Atlas, graph renderer helpers, graph filters and upstream
layout tests are included. Subject controls are exercised in the React harness.

Native Chrome checks exercised a real Brownian motion drag: the other four
Probability concepts settled and every concept outside that subject stayed fixed.
Lock disabled Arrange; trying to drag the locked concept opened inspection without
changing coordinates. The subject was then unlocked. Reload restored the saved layout. Arrange Analysis moved only its two concepts.
The final checks passed: 111 focused tests, 29 Atlas/layout tests under Electron,
lint, typecheck, production Turbopack build and packaged Electron server smoke. These checks do not establish large-
graph performance or complete the remaining Phase 2 workflow gates.


## Compact subject overview (31 October)

Organic arrangement now lays out each preferred subject independently, with
stronger centring and collision spacing, then packs the subject regions with a
180-world-unit gutter. Cross-subject links do not merge the regions. A selected
map/subject still limits the operation; locked and unrelated nodes stay fixed.
The existing preview/save controls and revision-checked position command remain
in charge. No initial-load relayout, schema change or mathematical edits occur.

In the main Atlas, inter-subject ordinary and typed links share a quieter dashed
bridge pass. They brighten with zoom and their incident links brighten on hover;
query focus restores full bridge visibility. Picking still uses all actual edges.
Derivation counts appear with close-up labels or hover, rather than dominating
the overview. Embedded lesson/proof maps retain their prior rendering. These are
conceptual associations: the arrangement does not claim a curriculum or proof order.
