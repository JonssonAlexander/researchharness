# Saved map interpretation proposals

29 October 2026; R06, R07, R09, R14, R16 and R17. This is the interpretation and
read-only preview slice of AGENTS.md §8.1, not the approval/commit workflow.

## Owner workflow and appearance

Open a map revision and choose **Interpret / review**. The wider review dialog
keeps a drawing pane and suggestion pane side by side, stacked on narrower
windows. Source images support Fit/zoom, page selection and highlighted evidence
regions. Suggestions retain transcription, conditions, uncertainties and questions.
Existing identity suggestions are labelled possible matches; other identities
remain for review. No Accept, Approve or Apply action exists in this slice.

Opening the dialog only reads local state and model configuration. **Interpret
revision** explicitly sends saved page images and the names/aliases of up to 40
linked concepts (10 aliases each) to the configured **vision** slot. It does not
send concept Markdown, chat histories or the rest of the vault. The destination
is shown before dispatch and rechecked on POST. Missing configuration, a changed
destination or a text-only model refuses without sending the source. There is no
provider fallback. Existing foreground subscription routing is reused.

Rnote's supported `export doc-pages` command produces readable PNG pages from the
hash-verified captured original, in a private temporary directory. These are not
the browsing thumbnails. An owner-confirmed PNG attached to the capture is used
directly instead. Export supports 1–8 pages, 20 MB total, the existing PNG
validation limits and a 60-second CLI timeout. Export timeout/rejection is reported
separately from model failure. A failed attempt with no retained pages or usage
shows "Model not called" instead of implying subscription usage. Missing/failed export needs a
readable manual PNG or smaller source; it never silently sends a thumbnail.

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
the model's smaller limit). Total work is bounded by a two-minute abort signal.

Every suggestion cites a real page, quote and optional normalized region. Draft
keys must be unique, relationship endpoints distinct and resolvable, and existing
IDs must match exact supplied names/aliases. These are conservative candidate
checks, not complete identity auditing or mathematical verification. Generalization,
prerequisite, analogy, application, counterexample and hypothesis preserve the
Atlas relation directions. Nothing becomes an accepted relationship or theorem.

## Retention, concurrency and recovery

Schema v8 adds one `map_proposals` table. Existing v7 data receives a
`.v7-<uuid>.bak` backup before transactional migration; future schemas are refused.
A source-only proposal envelope has its own version 1, with source revision/hash,
base Atlas revision, bounded identity context, model stamp, page hashes, timestamps,
status, findings, digest and per-call usage. Readable page bytes reuse the existing
immutable PNG blob store. Backup includes SQLite and `mindmaps/` together.

A durable running intent precedes model dispatch. One running attempt per source
revision is enforced transactionally. Request-token retries return the retained
attempt; prepared proposals are reused without another model call. A terminal
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
Live provider acceptance, handwriting quality, owner workflow usability and
multipage visual accuracy still need explicit real-model/device checks. Identity
auditing, editable proposals, approval, canonical writes and cross-store commit
recovery remain pending. Source preservation is already independent of those steps.
