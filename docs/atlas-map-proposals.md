# Saved map interpretation proposals

29 October 2026; R06, R07, R09, R14, R16 and R17. This is the interpretation and
read-only preview slice of AGENTS.md §8.1, not the approval/commit workflow.

## Owner workflow and appearance

Open a map revision and choose **Interpret / review**. The wider review dialog
keeps a drawing pane and suggestion pane side by side, stacked on narrower
windows. Source images support Fit/zoom, view selection and highlighted evidence
regions. Suggestions retain transcription, conditions, uncertainties and questions.
Existing identity suggestions are labelled possible matches; other identities
remain for review. No Accept, Approve or Apply action exists in this slice.

Opening the dialog only reads local state and model configuration. **Interpret
revision** explicitly sends saved images and the names/aliases of up to 40
linked concepts (10 aliases each) to the configured **vision** slot. It does not
send concept Markdown, chat histories or the rest of the vault. The destination
is shown before dispatch and rechecked on POST. Missing configuration, a changed
destination or a text-only model refuses without sending the source. There is no
provider fallback. Existing foreground subscription routing is reused.

Rnote's supported `export doc --output-file map.svg --no-pattern` command preserves
one whole canvas from the hash-verified captured original. The temporary SVG is
never served or sent to a model. The existing resvg dependency produces a 2048-pixel
overview and four or six 3072-pixel detail views (longest edge), in row order with
20% overlap. The entire canvas is retained, including empty margins. A normalized
rectangle locates every detail in the overview. All views and this position manifest
travel in **one** model request. Paper-page cuts and thumbnail fallback are not used.

An owner-confirmed PNG is still used directly as one image. Limits remain eight
images, 20 MB total, 10 MB per PNG, and the existing per-image pixel/format checks.
The temporary SVG is bounded at 32 MB; external image/style references and document
entities are refused. Rnote export has a 60-second timeout; async rasterization has
a separate 30-second bound and fresh per-view native cancellation signals. Rnote
exports text as glyph outlines, so system-font scanning is unnecessary. No new
renderer or native dependency was added. Temporary files are always removed.
A source failure with no retained images or usage shows "Model not called".

29 October 2026: an owner attempt failed at 30.112 seconds with no retained pages
or recorded calls, confirming the original export timeout. After raising the bound,
the exact saved revision exported six validated 1685 × 2381 pages (1,549,420 bytes
total) in 6.19 seconds in a warm local check. No provider was called by the check;
the existing failed attempt remains intact for an explicit owner retry.

Interpretation uses the existing extraction `runSubmitAgent`/`runSubagent` seam,
with an optional image message, the shared LLM semaphore, injected settings-resolved
engine and existing usage folds/pricing. The model has only a schema-validated
submit tool. It cannot retrieve arbitrary files, run tools or write any graph.
At most two calls allow schema repair; each is capped at 8,000 output tokens (or
the model's smaller limit). Source preparation is bounded as above. After images
are retained, model work (including the shared queue and any schema repair) has
a separate five-minute deadline. User/request cancellation interrupts either
stage; a model deadline is recorded as failed with an explicit timeout message,
not as a user cancellation. No automatic retry occurs. The review screen shows
whether source pages are being prepared or the model response is awaited.

An owner six-page attempt reached the original combined 120-second deadline
at 120.067 seconds without a completed usage record. This establishes the local
cutoff, not successful provider completion. Deadline/cancellation regression tests
use an injected abort signal, with no live request: export finishes before the
model deadline begins, timeout retains pages, and the same token never retries.
The source/proposal/UI checks pass (29 tests), along with type checking and
targeted lint. Live provider completion remains an owner-triggered acceptance check.

New findings separate labels/formulas, observed drawn connections and proposed
mathematical meaning. The prompt asks for reading first, tracing arrows second,
and conservative typed interpretation third, within the same bounded submit call.
An unlabelled arrow may remain a depiction with no mathematical relation. Observed
connections retain direction/labels and may cite several views; their existence
does not assert a theorem. This is a separation of output fields, not an independent
OCR stage, a second model audit or a guarantee of complete transcription.

Every suggestion cites an image index, quote and optional normalized image-local region. Draft
keys must be unique, relationship endpoints distinct and resolvable, and existing
IDs must match exact supplied names/aliases. These are conservative candidate
checks, not complete identity auditing or mathematical verification. Generalization,
prerequisite, analogy, application, counterexample and hypothesis preserve the
Atlas relation directions. Nothing becomes an accepted relationship or theorem.

## Retention, concurrency and recovery

Schema v8 adds one `map_proposals` table. Existing v7 data receives a
`.v7-<uuid>.bak` backup before transactional migration; future schemas are refused.
New proposal envelopes use version 2, while version 1 stays readable with its
original digest behavior. Version 2 adds per-image layout/dimensions bound into the
prepared digest; image and layout counts must agree. Both versions retain source revision/hash,
base Atlas revision, bounded identity context, model stamp, page hashes, timestamps,
status, findings, digest and per-call usage. Readable page bytes reuse the existing
immutable PNG blob store. Backup includes SQLite and `mindmaps/` together.

A durable running intent precedes model dispatch. One running attempt per source
revision is enforced transactionally. Request-token retries return the retained
attempt; prepared proposals are reused without another model call unless the owner
explicitly chooses **Reinterpret with map layout**. That requests a fresh attempt
against the existing saved source, with an explicit usage disclosure. The
interpretation-attempt selector reopens older results without calling a provider. A terminal
proposal cannot be overwritten. Prepared content has a digest binding the exact
source, base, context, model, pages and findings. Modified content or broken
identities fail visibly. View state and graph positions are not proposal content.

Failure, cancellation and a restart preserve the attempt and any recorded usage.
An interrupted attempt is marked failed on recovery and is never automatically
redispatched. Explicit retry creates another retained attempt and may spend again.
Earlier attempts remain visible in the dialog; unreported usage is not labelled
zero, and API-dollar figures are read-time estimates through existing pricing.
Subscription runs are identified as plan usage. There are at most 20 attempts per
source revision. One application writer per data directory remains required.

The Atlas base revision includes layout changes, so the stale notice is deliberately
conservative. A newer source revision does not alter the saved proposal. Approval
and application must later revalidate source/base versions and exact approved
content through their owning services and operation journal. They are not available
here. This slice also does not retrofit the existing teacher/notes extraction
pipeline with the global semantic approval boundary; that remains Phase 3 work.

## Verification and limits

The whole-canvas update exported the exact saved owner revision into one overview
(2048 × 1929) and four overlapping details (3072 × 2894 each), 942,450 bytes
total, in 11.79 seconds in a warm local run. No model was called. Geometry/pixel
tests cover full coverage, overlap and a mark visible in two neighbouring views.
Proposal tests verify all images/positions arrive in one request, multi-view
evidence validation, digest-bound layout, explicit reprocessing and access to
earlier results. Source/proposal/UI tests pass (33); source/image/proposal tests
also pass under Electron (19). Type checking, targeted lint, the production build
and packaged Electron server smoke checks pass. Earlier prepared owner results
still read through the API with no new attempt. The new overview and detail PNGs
were visually inspected locally; no live model rerun was performed by this update.

Tests use injected/faux engines, never paid provider requests. They exercise actual
image delivery through the shared extraction runner, schema repair, bounded calls,
usage retention, exact identity/page checks, duplicate requests, concurrent attempts,
explicit retry, cancellation, restart recovery, immutable terminal content, digest
checks, migration and backup/restore. Existing extraction tests run with the source
and graph tests after the shared runner extension.

On 29 October 2026, 204 targeted tests passed, plus 45 tests under Electron's
bundled Node runtime. Type checking, lint, the production build and packaged-server
smoke checks passed. An isolated synthetic proposal was reviewed in Chrome in
stacked and side-by-side layouts; evidence highlighting, zoom/Fit and Escape close
worked. Opening that saved proposal kept its single attempt and made no model
call. The main profile's Atlas snapshot stayed unchanged throughout this UI check.

Rnote 0.12.0 exported a real generated fixture into a full PNG page: one 48,564-byte
page, approximately 17.3 seconds in that observed run. A shell-sandbox attempt had
timed out; the native host export succeeded. This is not a large-map benchmark.
Live recognition quality with the new overview/detail input still needs an explicit
owner-triggered model comparison. The preceding successful owner interpretation
used the older paper-page input; it does not establish the new pipeline’s accuracy. Identity
auditing, editable proposals, approval, canonical writes and cross-store commit
recovery remain pending. Source preservation is already independent of those steps.
