# Atlas force layout and saved placement

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

## Compact subject overview

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
