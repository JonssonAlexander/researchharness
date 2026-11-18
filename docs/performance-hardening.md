# Performance repairs — 17 November 2026

Implements the six owner-reviewed Ponytail audit tickets (R01, R05, R08–R11,
R15–R17). These bounded changes do not identify the origin of the previously
observed 9.2 GB aged development-server footprint.

## Implemented behavior

1. Target cycle checks remember completed branches and maintain an active path.
   Shared prerequisites are visited once; cycles, unknown references and stale
   revisions remain rejected before writing.
2. Native PDF rendering always has a ceiling of 16 million rounded canvas pixels;
   callers may request a stricter ceiling. Oversized pages scale down and return
   actual DPI. Invalid DPI/regions/dimensions fail before painting. The PDF reader
   and lesson-page tools accept a normalized top-left `region: {x,y,width,height}`
   for detail without a huge full-page image. Tool output reports actual resolution
   and warns against claiming unreadable content was inspected. Browser article
   viewing, originals and annotation coordinates stay unchanged. Pixel limits do
   not cap all PDF decoder/native memory.
3. The chat store projects one record at a time and caches summaries only in memory.
   Local writes invalidate that session; external edits/replacements are detected
   with device/inode/size/mtime/ctime signatures. Deleted entries are pruned and
   malformed/future records stay isolated. Returned summaries are copied. Restart
   rebuilds the cache; canonical chat files and live busy/compaction merges stay
   unchanged. Listing still scans metadata and returns one row per session.
4. Learning-policy events use the SQLite adapter below. Activity receipt lookup is
   indexed, attribution reads turn/target events only, and routine insertion does
   not load historical activity. On-demand reports still read history.
5. Excalidraw changes provide a lazy scene reader retaining the latest scene without
   serializing it. Lesson/Practice, Review and article autosave hosts copy at flush,
   download or explicit submission. Versioned acknowledgements keep newer edits
   dirty; queued payloads use captured bytes. Scene restoration changes the pending
   reader immediately. Read-only viewers do not schedule saves. The 800 ms debounce,
   revisions, local-only autosave, immutable attempts and unload protection remain.
6. Native PDF loading occurs inside its teardown block. Failed loading/painting and
   success release the task. Cleanup preserves the existing policy of not masking
   the main error with a teardown error.

## Learning-policy storage and migration

`src/store/learning-policy.ts` uses native Node SQLite under `LH_DATA_DIR`:
`learning-policy/learning.sqlite`, schema `user_version=1`. Its directory is 0700
and database 0600. No new dependency/provider call is involved; existing
`atlas.sqlite` is unchanged. One application writer per data directory remains
the supported operating model.

Policy/evidence/target/turn/activity records retain their envelopes, receipt IDs,
order and per-session revision. A unique `(chat_id,id)` index enforces receipts;
event insertion and revision update share a transaction. Routine activity retrieves
one receipt and filtered context, then inserts one event. Full logical histories
remain accessible through the store port for reports and existing tools.

On first session access, its legacy JSON is validated and imported transactionally.
The session row marks completed import. Failed import rolls back; retry imports
once and preserves original JSON. Malformed, unsupported or conflicting sources
are refused. Retained JSON becomes a historical recovery copy, not a second writer
or current mirror. Do not run an older JSON-only build against migrated data: it
does not understand subsequent SQLite events.

Deletion first imports unmigrated data so a durable database copy exists. Rows and
the legacy file are then deleted inside a transaction; failed unlink rolls back
the database change. If the process dies after unlink but before commit, SQLite
rollback preserves the imported ledger. Session deletion scope is unchanged.

Connections close after each operation using SQLite's default rollback journal;
this adapter introduces no persistent WAL. Back up the entire data directory with
the app stopped, or use a consistent SQLite backup for an online procedure.
Include retained JSON and all other stores. Old JSON alone omits new events.
Restore the full directory together; never delete the database to rebuild from
stale recovery copies. Future database versions and corrupt contents fail closed.

## Validation

Focused regressions cover an 80-target overlapping graph, actual oversized PDF
pages/crops, failed loading/painting teardown, summary invalidation, transactional
import/retry/backup/deletion, receipts and lazy snapshots. A mounted editor wrapper
with a stubbed Excalidraw engine checks 100 pen/pan callbacks with an embedded image
perform zero scene serializations until capture; this is not a real-pen test.

Final commands, totals and measurements live in the workspace
`outputs/ponytail-audit-2026-11-17/implementation.md`. Absolute timings depend on disk
pressure and concurrent work. Cold/production memory comparison, long soak tests,
packaged Electron validation and owner pen-hardware acceptance remain unchecked.
