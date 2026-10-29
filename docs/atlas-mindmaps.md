# Rnote import, revision previews and concept references

28 October 2026; first Phase 3 slice, R06, R09, R14, R16 and R17.

## Available workflow

Atlas → Mind maps → Import Rnote accepts a saved `.rnote` file, a map name and
optional concept references. Selecting a concept before opening the importer
preselects that reference. Multiple concepts may reference the same source; these
are references, not mathematical support, extracted claims or proof edges.

The browser uploads a managed copy; the selected external original is never
changed or moved. Download any retained original to edit in Rnote, then use
**Import new revision** on the existing map. The stable map ID survives filename
changes and rewrites. The revision selector keeps previous originals, previews
and reference selections available. Concept inspection also shows a map linked
only in an older revision, with that source revision selected. Removed concepts
remain historical IDs and display as removed; their source bytes are not deleted.

On macOS the adapter uses `/Applications/Rnote.app/Contents/MacOS/rnote-cli`.
`RNOTE_CLI` may select an administrator-configured absolute executable path on any
host. It runs `test` on the captured temporary copy and requires an explicit
success message, then calls `thumbnail --size 1024`. There is no shell, external
path supplied by a request, network/model call, arbitrary file opener or mutation
of an external original. Validation has a 60-second timeout and thumbnail generation
has a 30-second timeout, with bounded output;
request cancellation kills the process. Only a small non-provider environment is
passed. Temporary files are removed after success, failure or cancellation.

An absent/unusable executable leaves the format explicitly **unchecked**. An
installed validator that rejects/times out does not import the file. Preview-only
failure preserves the original and records the failure. An optional manual PNG
requires the owner to confirm it came from the exact selected original; this is
an owner assertion, not automated verification of correspondence. Both the source
and preview hashes are bound to that capture. Thumbnails are overview previews,
not full-page image exports or model interpretation inputs.

Archive requires confirmation, keeps every source and preview, and offers Restore.
There is no permanent-erasure UI. Imports remain independent of interpretation; use **Interpret / review** to inspect
or explicitly request a proposal. Watchers,
automatic external-save capture, native Edit launching, full-page/multipage exports,
editable proposal review, approval receipts and canonical synchronization are still pending.
Saved interpretation drafts and a read-only source review are now available; see
[map proposals](atlas-map-proposals.md).
No teaching, extraction, provider or graph-layout policy was changed by this slice.

## Storage, retries and limits

Schema v7 adds `mindmaps` and `mindmap_captures` to `atlas.sqlite`; an existing v6
database gets a `.v6-<uuid>.bak` baseline before transactional upgrade. Earlier
backup chains and future-schema refusal remain. Source capture JSON has its own
version 1 envelope and refuses future versions. Mind map metadata has its own
optimistic revision; it does not advance the graph layout revision.

Immutable original bytes live in `mindmaps/revisions/<sha256>.rnote`; previews in
`mindmaps/previews/<sha256>.png`. Files are owner-only, content-addressed, staged,
fsynced and atomically linked into place before SQL references commit. Existing
blobs are verified and reused. Directory symlinks, symlinked blobs, changed bytes,
missing assets and broken revision identities fail visibly. Assets are resolved
by validated revision IDs, never paths from a request. Serving verifies byte
hashes; PNG responses use a fixed MIME type, no sniffing, sandbox CSP and no-store.
Originals are downloads with encoded filenames, not active browser documents.

A stable capture token binds the exact import metadata, original hash and any
manual preview hash. Repeating the token/payload returns the committed capture;
reusing it for different input is rejected. A metadata transaction interrupted
after blob writes can leave unreferenced blobs; retries reuse them. Such blobs
are retained, not automatically erased. This file-first, reference-last protocol
covers this bounded import operation; it is not the future multi-store semantic
synchronization journal. Complete backup must include SQLite **and** `mindmaps/`.

Limits: 32 MB compressed original, 128 MB gzip expansion, 10 MB PNG, 43 MB total
request, and 200 unique concept references. PNGs must be noninterlaced, 8-bit,
at most 8192 per dimension and 16 million pixels; CRC, chunk structure, bounded
inflation and scanline filters are checked. SVG, HTML, animated PNG, PDF and JPEG
are not accepted as manual previews in this slice. Unsupported files receive an
explicit error. Native file internals are not reverse-engineered or rewritten.

## Verification

Installed Rnote CLI 0.12.0 imported a generated Xournal fixture into a genuine
`.rnote`, validated it and generated a visible PNG. The first adapter invocation
in the check took 10.94 seconds; the second took 0.21 seconds on that small fixture.
These are observed runs, not a large-map or cold-launch performance guarantee.

29 October 2026: an owner file that hit the original 15-second validation cutoff
was independently accepted by Rnote CLI. The adapter now allows 60 seconds for
validation and 30 for a thumbnail, distinguishes timeout from rejection, and shows
local preparation progress. The exact adapter subsequently validated that file
and produced a 60,467-byte thumbnail in 6.89 seconds; no source was imported and
no model request was made by that diagnostic check.

Focused tests cover exact original retention, immutable revisions/reference
history, reopen/backup restore, stale saves, retry token conflicts, injected SQL
failure after blob writes, archives/restoration, missing/corrupt/symlinked assets,
PNG validation, upload limits, safe responses, schema migration/rollback and future
source envelopes. The React harness covers source inspection and rejected archive.
A native Chrome file-picker import against a temporary-data standalone server
showed the generated preview and selected concept reference without a provider.
A second native revision retained the first original byte-for-byte; the browser
selector restored its earlier preview. Archive and Restore retained both captures.
Passed: 123 focused tests, 39 Atlas/layout/source tests under Electron, lint,
typecheck, production build and packaged Electron server smoke. The main owner
profile matched its pre-check snapshot; only temporary test data was imported. Full handwritten-map usability and
all remaining Phase 3 acceptance scenarios are still open.
