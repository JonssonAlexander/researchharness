# P1: incremental project evidence

Implemented 18 November 2026 on the existing local P0 checkout (`2aacd260` plus preserved, uncommitted lesson/performance/P0 changes). No dependency, agent or model call added.

## Use

Open a bound trail in Atlas. Choose **Review project changes**. Inspect recorded material, choose its target research node or a new branch, edit the description/interpretation/uncertainty, then approve once. Excluded entries are acknowledged too. Dismiss acknowledges the batch without attaching findings. For large indexes, review subsequent batches. Pending snapshots survive restart and can be reopened.

Source text and recorded metrics stay separate from the owner's interpretation. Handwritten handoff claims and external run outcomes are unverified assertions; neither approval nor a favorable metric establishes proof. The original root question, earlier evidence, canonical mathematical records and learning/mastery remain intact. A changed run is another version of the same external run ID; unchanged records are skipped.

## Files and limits

Default reads: P0's version-1 workspace manifest, selected trail's `brief.md`, `handoff.md`, `runs/index.jsonl`, and at most 20 changed/invalid run-record attempts. No recursive source ingestion or code execution. Acknowledgement stores a cursor so later batches can move past bad records. Later reviews leave room to retry unreadable or invalid run files from earlier batches, even when the index stays the same. Changed indexes reset the cursor. Previously acknowledged run hashes prevent duplicates. Invalid/missing records are reported individually. Preview never advances a checkpoint.

Metadata/individual records: 64 KiB each; manifest/index: 1 MiB each. Oversized required metadata is refused explicitly. Up to 20 run attempts per batch; warnings are bounded with an omission notice. These are operational limits, not silent evidence truncation.

Write a run JSON under the selected trail's `runs/`, then append its compact index entry. Example run:

```json
{"schemaVersion":1,"runId":"trial_001","trailId":"rt_<existing-uuid>","objective":"Measure estimator error","outcome":"failed","metrics":{"error":0.31},"limitations":["Single sample; no independent verification."]}
```

Index line (hash the exact JSON file bytes with SHA-256):

```json
{"schemaVersion":1,"runId":"trial_001","path":"trial_001.json","hash":"<64 lowercase hex characters>"}
```

The schema also accepts timestamp, codeReference, command, parameters, seed, environment, evaluators, outputs, limitations and artifacts. Run IDs allow 1–100 letters/digits/underscores/hyphens; indexed filenames must be `<runId>.json`. Missing reproducibility fields produce explicit warnings. Execution is never inferred from an outcome label. Existing Workbench records may be referenced with `workbench:{chatId,runId}` without copying artifacts; those external references are labelled unverified, not automatically resolved or imported.

Artifacts declare `{path,hash,mime}` with a project-relative path. Explicit inspection permits bounded text/CSV/JSON (64 KiB), PNG/JPEG/WebP/PDF (2 MiB). It verifies path, type and captured hash. Artifacts stay in the external project: evidence preserves their references, not a backup of their bytes. Keep referenced originals available. Changed/missing artifacts fail inspection explicitly.

Git summaries use bounded, read-only argv commands with hooks, fsmonitor, external diffs/text conversion and configured content filters disabled. They record HEAD, dirty status and compact file/baseline statistics. Non-Git/unborn/unavailable Git remains usable with an explicit limitation. **The dirty-tree fingerprint covers status and diff statistics, not exact source bytes.** Equal statistics can conceal code edits; it is not a reproducible code snapshot. Detailed source/patch inspection is not implemented.

## Storage, approval and API

Atlas SQLite schema **17** adds `research_import_reviews`, `research_import_checkpoints` and `research_evidence`. Existing v16 receives a `.v16-<uuid>.bak` before transactional migration; newer schemas are refused. Back up the complete application data root. Immutable bounded source text and run metadata live in review/evidence records in this same database.

Approval binds the proposal digest, trail/workspace identities and revisions, complete node revision set, checkpoint receipt and captured file/Git fingerprints. Required source bytes are rechecked before approval; stale state returns 409 and requires refresh. This checks a snapshot of externally editable files; it cannot lock an editor against changing them immediately after the last read. Database updates—new branches, evidence, trail revision, checkpoint and receipt—commit together. Failed transactions advance nothing. Repeating the same committed approval returns its receipt even if files later change; different decisions for that receipt conflict. Earlier interpretations remain in immutable evidence history.

`GET /api/research/integration?trailId=...` returns recent review summaries, a page of 20 evidence records and the workspace-specific checkpoint. Use `before=<evidenceId>` and `evidenceNext` to load older evidence without loading the full history. `?reviewId=...` retrieves the captured proposal. JSON POST actions are `prepare`, `apply` (including explicit dismissal), and approved `inspect`. Mutations use same-origin/desktop access boundaries and a 512 KiB request ceiling. Artifact inspection accepts review/source identity, never an arbitrary client path. Paths, symlinks, hashes, cross-trail run IDs and foreign manifests are checked. Imported strings render as text; no file content becomes agent instructions. Notifications reuse `research-trails-changed`.

Main files: `src/core/research-integration.ts`, `src/store/research-integration.ts`, `src/server/research-integration.ts`, `src/server/research-integration-http.ts`, `app/api/research/integration/route.ts`, and `components/research-integration.tsx`, composed through P0 and the existing barrels.

## Validation and scope

Targeted tests cover source discovery/batching, malformed/oversized records, identity and symlink refusal, artifact hashes, real Git metadata, source changes, approval/retry/conflicts, immutable prior evidence, restart persistence, migration backup/rollback/future refusal and existing P0 behavior. The focused P0/P1 run passed 10 tests; typecheck and changed-file ESLint passed. After the history pagination change, the affected approval/persistence test and typecheck/lint were rerun.

Open device check: capture a failed and a completed run in a real VS Code project, review them in the app, then reopen the trail after restart. Include two trails sharing one project and confirm each imports its own run records.

Optional AI synthesis, detailed code inspection, automatic Workbench resolution/recording helpers, chat-triggered import and background watching are omitted. Manual review is fully usable with zero model calls. P2/P3 remain future work. Per owner request: no full suite, production build, UI automation or device sign-off in this slice.
