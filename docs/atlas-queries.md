# Sourced connection queries — as built

28 October 2026; Phase 2, R02, R09 and R14. This is a deterministic, read-only
concept path query over the existing Atlas snapshot. It adds no schema, endpoint,
provider call, search index or persistence owner.

## Use

Open **Atlas → Find a connection**, choose two distinct concepts and click
**Find path**. The selected concept supplies the initial source. The result shows
one shortest path, each step's traversal direction, relation type, conditions,
review/claim statuses, source citation and page/section locator. Clicking a concept
opens its inspector without changing the submitted query.

Only accepted links with a nonempty source citation are traversed. Analogy can run
in either direction; every other relation follows its stored source-to-target
direction. Original records are returned with each step, including for a reverse
analogy traversal. Proposed, disputed, retracted, uncited or dangling links do not
establish a path. Hypotheses and numerical observations retain their labels even
when the owner accepted their link. The query does not verify citations, derive a
new relation or claim that mixed concept links compose into a mathematical proof.

**Show path in graph** temporarily limits the existing canvas to path concepts and
the specific path relations. **Show full graph**, clearing the query, closing Atlas
or entering the concept/subject editor removes that focus. Existing text search
still applies. Camera and saved positions are retained; no knowledge or placement
record is written. Query results recompute from authoritative SSE refetches; if a
link is retracted, its outdated path and graph focus are removed.

## Bounds and failure states

`src/core/atlas-query.ts` uses breadth-first search, sorting adjacency lists by stable
relation ID so equal-length choices are deterministic. The bounds are six links,
2,000 visited concepts and 10,000 total relation records. They are protective limits,
not measured performance guarantees. Reaching a bound reports that a path may exist
outside the search. Exhausting the reachable search reports “No supported path
found” in the chosen direction. Missing/equal endpoints produce a selection prompt.

`components/atlas-query.tsx` provides the form and result inspection. AtlasPanel
hosts it; GraphView applies temporary visibility and relation filters using the
existing renderer. All persisted mathematical definitions remain in the formal
ledgers, and Atlas links remain separate from logical implication edges.

## Validation and remaining work

Focused tests cover shortest paths and deterministic ties, all relation directions,
reverse analogy, mixed claim statuses, omitted review states/citations, cycles,
dangling endpoints, depth/visit/record limits, original-record preservation, UI
source inspection, temporary focus and removal of stale results on retraction.
Tests use fixtures and make no model calls. Real-browser visual/interaction checks
remain pending because native browser automation was unavailable in this session.

This slice returns one shortest concept path. Alternative paths, formal argument
queries with joint premises, text/semantic discovery, managed source snapshots and
saved perspectives remain future work. No query creates knowledge or saves a view.

Validation: 76 focused tests passed, including storage, Atlas UI and existing graph
helpers. Lint and typecheck passed. Production build and packaged Electron smoke
passed. The live app served home and Atlas successfully. The full suite was not rerun for this read-only slice.
