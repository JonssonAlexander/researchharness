# Atlas placement and concept dragging

28 October 2026; R02, R03, R09, R16 and R17.

Concepts can now be dragged individually in the existing canvas. They remain
anchored against force simulation but accept direct pointer movement. A click still
opens inspection. A drag changes only that node and saves its x/y using a revision-
checked `concept-position` command through `/api/atlas`. Release does not reheat the
simulation or send concept coordinates into the formal graph positions ledger.
Failed/stale saves show an error and refetch authoritative state. Coordinates are
finite and bounded to ±1,000,000 world units. Renames and note edits preserve them.

The renderer's optional `draggable` flag separates user movement from force
anchoring. Its optional `onNodeMove` callback is independent of the existing formal
node drag/settle callback. Formal proposition behavior is preserved. Position saves
increment the same entity revision, so another window cannot silently overwrite a
concurrent edit. These commands change no Markdown or canonical proposition data.

`subject-position` updates an anchor only; this is not a subject-cluster dragging UI
and does not move existing members. Whole-cluster drag, locking and local relayout
remain pending. No schema migration is needed; x/y already exist in schema v4.

New subjects seed on a two-column grid and new concepts on rows near their preferred
subject. Existing owner positions are preserved. The loaded sample was explicitly
rearranged into a compact Probability/Analysis/Computation layout. Sample titles no
longer have a “Demo ·” prefix. Cleanup still uses its reserved IDs, and fixture notes
and citations still identify the content as illustrative. New sample loads use the
same tidy placement. Subject headings sit above their topmost member rather than
on top of the node/link area; existing birth-session labels retain their centroid.

For the owner's local graph, node size was increased from 2 to 4 world units and
label size from 3 to 12 through the existing render-settings API. Other preferences
and upstream global defaults were preserved. These remain adjustable with the gear.
The zoom visibility gate still transitions from subject headings to node names.

Validation includes persistence across store reopen, revision conflicts, invalid
coordinates, unchanged metadata/other nodes and existing graph helper coverage.
Native Chrome inspection verified the overview and readable node labels at closer
zoom. An actual Brownian motion drag saved new coordinates; after browser reload,
the coordinates remained and the other sample nodes had not moved. The test node
was then returned to its compact sample location. The owner's other records were
compared during sample renaming/repositioning and stayed unchanged.

Passed: 82 focused tests, 23 Atlas storage/API tests under Electron, lint, typecheck
and production build. The full suite was not rerun for this bounded change.
