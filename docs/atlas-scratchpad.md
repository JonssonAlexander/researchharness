# Learning scratchpad

As built: learning sessions have a **Scratchpad** button in the top bar. One
embedded Excalidraw 0.18.1 editor changes between Small, Half and Fullscreen by
resizing its host; size changes retain the scene and undo/redo history. Small
(38%) and Half (50%) dock beside the transcript on the right, reserving space
instead of covering messages or the composer. The lesson sidebar yields that
space while the scratchpad is open. Narrow screens stack chat above the pad.
Start and Finish stay above the drawing in docked modes, with expandable text.
The existing dictation instance targets the scratchpad explanation while open.
Send/close waits for its final transcript. Fullscreen fills the viewport and
keeps just drawing, size controls, dictation, save status and Send visible. One
Details toggle reveals targets, explanation, download, feedback and attempt history;
feedback itself remains collapsed until requested. Errors remain visible. This
changes presentation only; saved scenes, attempts and delivery stay unchanged.

The editor is loaded only on demand. Fonts are served locally from the pinned
package, copied by postinstall/prebuild (`scripts/copy-scratchpad-assets.mjs`).
No hosted drawing service or collaboration backend is used. Scene images must be
embedded PNG/JPEG/WebP data, not external URLs; interactive embeds are disabled.
The editor provides pen, eraser, zoom/pan, text and undo/redo; actual tablet comfort
and palm rejection still require the owner's hardware evaluation.

## Saving and submission

`src/core/scratchpad.ts` owns browser-safe contracts, target binding, native attempt
markers and the image-resolution port. `src/store/scratchpad.ts` owns the source
files; `src/server/scratchpad.ts` validates chat/lesson identity, bounded requests
and source access. Thin `/api/chats/[id]/scratchpad` routes delegate through the
server barrel. The existing chat input endpoint remains the model dispatch owner.

Each session/derivation has a revision-checked current draft containing the full
Excalidraw scene (including binary assets and deleted elements), viewport and typed
or dictated explanation. Saves are serialized on the client and atomic on disk;
stale saves from another window are refused. A rolling previous draft supports
recovery without making a full archive for every pen stroke. Draft autosave makes
no model call and never clears the scene. A failed save keeps the local editor open
with Retry save and Download. Reload while unsaved triggers a browser warning;
an abrupt process/power loss can still lose strokes since the last completed save.

**Send attempt** finishes dictation, flushes the exact scene revision, exports that
snapshot to a PNG (up to 4096 pixels per side), and captures an immutable attempt
before delivery. Editable submitted scenes and their images remain available under
Attempts, with download and Continue from a copy. A session/derivation change gets
its own draft; attempts retain their original Start/Finish. Text-only attempts are
supported. Opening/closing, autosaving and changing size do not request feedback.

Source layout under the complete app data root:

- `scratchpads/<chat>/<target>/current.json` and `previous.json`;
- `scratchpads/<chat>/attempts/sa_<uuid>.json`: immutable scene, explanation,
  target, source/image hashes, ordered number and timestamp;
- matching `sa_<uuid>.png`: checked PNG export.

Limits: 16 MiB serialized scene, 10,000 elements, 20,000 explanation characters,
10 MiB PNG, 8192-pixel/32-megapixel validation ceiling. The normal exporter caps at
4096 pixels; a very large drawing can therefore lose small handwriting detail.
PNG structure, CRCs and bounded decompression are checked; attachment reads verify
the saved hash and refuse missing/corrupt assets. Paths are validated and symlinked
source directories/files refused. Include the whole scratchpads directory in
backups/restores. Explicit chat deletion removes its scratchpad sources too.

## Model transport and recovery

A client `scratchpad` event carries only the saved attempt ID. The server creates a
native learner marker with that stable ID, source context, text and image reference.
The existing write-ahead chat persist is the delivery receipt, before model dispatch.
Duplicate IDs acknowledge the same delivery without appending or launching a new
turn. An image-capability/missing-asset preflight refuses unsupported input before
new chat history is written. No drawing is silently sent as text alone.

The agent's injected attachment resolver loads the checked PNG only at its model
boundary, where Pi receives a real user image block. Native history never stores
repeated base64 copies. Compacted-away drawings are not reloaded; image references
get the existing fixed image-token estimate in context heuristics. Replay uses the
same resolution. The transcript renders the submitted image and learner explanation.
Text exports/summaries explicitly note that drawing pixels are not present; later
lesson distillation can use the recorded feedback and text but does not independently
reread these images in this slice.

Delivery state is derived from durable chat history: ready, submitted, answered or
failed. A ready snapshot offers explicit Retry send. A submitted attempt with no
live turn offers Resume feedback without another learner message; after an ambiguous
crash this can consume additional provider allowance. Failed feedback uses the
existing conversation Retry flow. There is no claim of exactly-once execution at
an external provider after a crash; source snapshots and local message identities
are idempotent. Autosaved or unsuccessful work is never automatically integrated
into canonical mathematical knowledge.

This slice serves conversational learning sessions. Legacy question-tool/Practice
scratchpad binding, OCR/transcription editing, very large multi-page submission and
new understanding/FSRS evidence workflows remain later work. It does not alter the
existing Practice protocol or create a custom drawing engine.

Validation: isolated store/HTTP and scripted Pi tests cover stale/failed saves,
immutable/idempotent snapshots, export/capture failure, actual image transport,
source replay, unsupported vision and retained work. A paid vision call, microphone
recording and real tablet assessment must be reported separately from those tests.

API reference used alongside the pinned installed types:
[Excalidraw export utilities](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export).

Native Chrome smoke check: opened the editor in the existing lesson, observed the
pen/eraser/zoom/undo/redo controls, changed Small/Half/Fullscreen hosts and closed
without drawing, recording audio or sending an attempt. This is not a tablet lag
or palm-rejection measurement. Scripted delivery tests cover actual image blocks,
duplicate submission, a completed-feedback resume, and a text-only model refusal;
422 refusals are surfaced once rather than retried as busy-turn conflicts. Resume
binds the attempt ID and refuses stale/failed targets instead of making a second
unrelated response. Tailwind scans app/components/src/lib explicitly, keeping
binary font assets and generated build artifacts out of class discovery.

## Lesson integration attachments

New lesson reviews capture up to 200 nonempty scratchwork snapshots from the saved
lesson's topic/derivation pads: immutable submitted attempts plus the latest saved
draft when its exact revision is not already represented by an attempt. Empty pads
are skipped. There is no additional Save step, provider call or image upload. The
existing editor autosave is used; strokes not yet saved are not captured. Changing
saved scratchwork invalidates a prepared approval just like changing lesson text.

A preview image is useful for quick reading, but cannot preserve editable strokes.
The toolbar Save dialog alone would create a separate file without a durable node
reference and could be moved or overwritten. Both are therefore kept: submitted attempts retain their PNG plus complete local
`.excalidraw` scene/assets; unsent drafts retain the scene and explanation and can
be opened in the read-only local viewer without first exporting a PNG. Download
Excalidraw uses the saved native scene; import that file into Excalidraw to edit a
copy. Viewing/downloading never overwrites the working pad or reviewed attachment.

`Scratchwork` stays collapsed beneath concept notes, focused-map nodes, canonical
result/explicitly cited claim details, and reviewed lesson maps/derivations. Entries
show newest revisions first. References use exact original topic IDs and the reviewed
concept identity mapping. A topic pad is associated with included results for that
topic; this does not assert that every scribble proves every result. A submitted
attempt can also link to a specific claim when its message ID appears in that
claim's reviewed evidence. No semantic guess is made from similar titles. Unmatched
notes remain available in the saved lesson review rather than being assigned by AI.
Zero-new-concept reviews can link notes to an existing bound topic concept.

Files live at `scratchpads/_retained/sw_<sha256>.json` and optional matching `.png`.
The content-addressed manifest binds source chat/pad, revision, timestamp and scene /
image hashes. Image first, manifest last allows an interrupted write to retry.
Scene and image reads check hashes and regular files/directories. References are
optional additive fields on the existing hashed review/source/artifact, so no SQLite
schema migration is needed; legacy reviews remain readable. References participate
in source/approval digests, canonical-write preflight and the existing transactional
receipt. Repeated approval does not append duplicate attachments. The review-bound
`/api/atlas/lessons/scratchwork` endpoint serves only an attachment named by that
prepared/applying/committed review, including after source chat deletion.

These retained copies intentionally survive deletion of working chat pads. Include
`_retained` in full data-root backups. Failed/stale reviews may leave local retained
copies; automatic garbage collection is not implemented. Existing committed reviews
are not rewritten or retroactively enriched. Generate a fresh review for new saved
scratchwork. Real pen/visual acceptance remains an owner check.
