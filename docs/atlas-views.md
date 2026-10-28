# Subject movement and saved views

28 October 2026; R01, R02, R03, R09, R14, R16 and R17.

Drag a visible subject title to move its entire preferred-member group. This is a
rigid translation: internal offsets stay unchanged; other subjects and formal
propositions stay still. Hidden preferred members move too. Additional memberships
and child subjects do not move. Locks prevent movement. A local simulation must
finish before starting a subject drag. Pointer cancellation restores saved positions.

The strict `subject-move` command carries a subject ID, x/y delta and global Atlas
revision. The store computes the exact members and translates them with the anchor
in one transaction. A concurrent membership/edit/lock invalidates the command.
All destinations must be finite and within ±1,000,000; at most 2,000 members move.
Failure displays an error and refetches authoritative placement. There is no force
settling after a rigid move. Ordinary concept dragging retains local settling.

Atlas → Saved views saves a name, camera and graph search text. Open a saved name
to restore those settings; it never restores or writes node positions. Camera x/y
represent the world point at the window centre, so resizing does not change the
saved focal point. Zoom uses the existing 0.02–40 bounds. Existing per-device last-
camera persistence stays intact. Clear temporary path focus before saving a view;
path results, node selections, rendering preferences and cluster locks are not
view-specific. Opening a view clears temporary path focus. Removing a view requires
confirmation and retains its complete record in the existing Atlas archive.

Schema v6 adds one `atlas_views` table to the same SQLite database, with unique
names, camera JSON, search text and per-view revisions. Existing v5 databases get
a `.v5-<uuid>.bak` baseline before the transactional upgrade; old migration backup
rules and future-schema refusal remain. Views are included in normal SQLite backup
and restore. View edits have optimistic revision checks, a 100-view limit, and do
not advance the layout revision or rebuild the canvas. No additional packages,
providers, background jobs or endpoints were added.

Tests cover rigid movement, shared memberships, locks, bounds, stale transactions,
view reopen persistence, duplicate names, validation, archival, schema v5 backup,
and restoring/removing views in the React harness. Native Chrome checks verified
rigid group dragging, saved camera/search restoration and unchanged node records
after view operations. The temporary test view was archived and the test movement
reversed. Passed: 115 focused tests, 32 Atlas/layout tests under Electron, lint,
typecheck, production build and packaged Electron server smoke. Hierarchical group movement/locking and further subject
hierarchy visualization remain pending.
