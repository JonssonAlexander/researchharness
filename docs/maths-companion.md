# Mathematical literature companion

Implementation plan (R01, R04–R05, R08–R09, R14–R17):

1. Extend `research` input/results in `src/core/contracts/jobs.ts` and
   `src/agent/tools/jobs.ts` with an optional mathematical mode. Reuse runner,
   consent, cancellation, delivery and usage; preserve generic research.
2. Add pure finding/source contracts in `src/core/maths-companion.ts`, an injected
   retained-source port and a file adapter in `src/store/research-sources.ts`.
   `src/server/stores.ts` composes it; no canonical graph writes.
3. Add `src/agent/subagents/maths-companion.ts`: structure-led search, critique,
   bounded read-only Atlas lookup, verified PDF citations and typed submission.
   Extend existing PDF acquisition to propagate cancellation and record final URLs.
4. Add page/quote geometry checking to `pdf-ops.ts`; a scoped server endpoint
   serves only retained session evidence and originals. Store originals before
   results; content hashes and citation IDs permit restart/reopen.
5. Add compact finding cards and a docked PDF reader; one Investigate action uses
   the normal teacher conversation/tool path, preserving native history and gates.
6. Mocked model/search/PDF tests cover evidence validation, storage, cancellation,
   deduplication, privacy boundaries and unchanged generic jobs. Run typecheck,
   lint, relevant regressions, build and a separate-profile browser check.

Status: first vertical slice implemented. No automatic Atlas integration, vector index,
academic crawler, Python execution or research notebook is included.

## Implemented behavior

The mathematical mode is an optional extension of the existing `research` job,
not a new worker queue or conversation. Existing calls/results remain readable.
The teacher prompt/tool description now supports mathematical literature and
critique. Investigate is one compact action above the composer; it asks the teacher
through the normal native turn path to dispatch, using the draft question or current
conversation. Existing disabled-tool/model/active-question gates still apply.

The worker uses the configured researcher role, bounded web/PDF tools and injected
read-only Atlas tools under a fresh graph-access gate. It reconstructs the problem,
varies terminology/abstraction/field, seeks counterexamples and follows useful
references. A typed submission tool returns up to four findings, each distinguishing
source claim, relevance, assumptions, classification and next step. An empty report
with honest limitations is valid. The server validates structure and evidence IDs;
it does not certify the mathematical classification or force a model to find a
useful source. No relevant literature found never means novel.

`cite_passage` accepts only a PDF observed by this job's acquisition tool, checks
canonical path containment and page bounds, and publishes an immutable retained
original before its metadata/passage. The URL comes from acquisition, not an
unverified final model response. Section/theorem references absent from the page's
extracted text are omitted. Short exact identifying quotations match PDF text items
with whitespace/Unicode normalization. Only a unique match with supported geometry
gets highlighted; otherwise the result says page-only and must remain unresolved.
Rectangles cover matching text items, which can be wider than the quoted substring.
A located quotation is evidence of source text, not applicability or formal proof.

The source store is composed in `src/server/stores.ts` and implements the pure port
from `src/core/maths-companion.ts`. Files are mode 0600 inside session folders:

- `research-sources/<chatId>/rs_<sha256>.pdf`: retained original bytes.
- `rs_<sha256>.json`: title/authors, URL, hash, byte/page counts and retrieval date.
- `rp_<sha256>.json`: page, quotation, verified reference and highlight rectangles.

Only session-owned passage IDs open assets; arbitrary paths/URLs are not reader
inputs. Reads validate source hashes and passage metadata, rejecting symlinks or
changed files. The existing atomic helper now accepts binary bytes as well as text;
all prior callers retain their behavior. Temporary research downloads are still
removed when jobs settle. Selected citation artifacts persist across restarts;
no automatic retention pruning is introduced. Include this directory in backups.
Deleting a chat prevents its reader API from reopening sources; this slice adds no
source library, orphan cleanup or export UI.

The finding card opens a client PDF.js reader of the retained original. Wide screens
keep chat beside the paper; narrower screens use a closable overlay. Page controls,
scrolling and zoom expose surrounding material. Highlights appear only on the cited
page. Discuss cited passage sends the citation/quotation as an explicit normal chat
message; it neither auto-integrates knowledge nor submits an answer. Browser worker,
font, CMap and WASM assets are copied from the installed PDF.js package during
postinstall/prebuild/development startup and excluded from Git/lint, matching the existing asset pattern.

## Budgets, privacy and limits

Questions are capped at 4,000 characters and supplied context at 12,000; Atlas reads
retain existing per-tool budgets. Each investigation allows 18 model turns, eight
PDF acquisition attempts and eight retained citations; each PDF is at most 25 MB
and cited PDFs at most 500 pages. Search queries and fetched/extracted evidence go
to the configured services/models. The existing web reader fallback remains
available; no new search provider or embedding service was added. No owner profile,
credentials or real model/search allowance were used for validation.

Cancellation propagates to search/PDF/web requests and the model loop; evidence
writes recheck both job cancellation and the per-tool abort signal after async
work. Already-retained immutable sources may remain after cancellation, but a
cancelled job cannot publish a completed report. Missing providers, inaccessible
PDFs and extraction failures yield explicit limitations or the existing failed-job
shape. Exact repeats of question/context reuse a running/completed mathematical
job; changed context or failed jobs permit retry. This is administrative dedup, not
semantic identity matching. Job delivery/recovery/usage use existing machinery.

Scanned papers, unusual math encodings, rotated text and multi-column extraction
can defeat matching. There is no OCR, rendered-page vision tool in this worker,
academic index, DOI resolver, automatic literature-quality guarantee or real-paper
benchmark yet. Useful non-PDF leads can be mentioned in limitations but do not gain
an invented passage card. Natural agent invocation and mathematical interpretation
still depend on the selected model; live quality needs a separately authorized
real question. Canonical mathematics, FSRS and Problems storage are untouched.

## Validation (7 November 2026)

246 selected tests passed with two native platform skips across 13 test files:
new evidence/store/model/job/API tests, generic research and PDF acquisition,
web/search cancellation seams, job recovery/delivery, atomic writes, PDF extraction,
Atlas context, lesson sources and source-access policy. TypeScript and full ESLint
passed. No canonical knowledge was written by the new workflow in fixtures.

A separate temporary profile on port 3006 served a real minimal PDF and native
research-result marker. Headless Chrome opened the finding, loaded the original,
rendered the cited page, verified a highlight, navigated to another page without
that highlight, and checked wide/narrow layouts. No console or reader errors.
Inspected screenshots: `/tmp/companion-reader.png` and
`/tmp/companion-reader-small.png`. The fixture server was stopped and its temporary
Turbopack root override removed. The owner's app/profile was not changed.

Production build is NOT verified. The sandboxed default build could not fetch the
existing Google Fonts; a network-enabled Turbopack attempt hit an internal process
port-binding restriction. The webpack fallback reached compilation but failed on
the existing `node:crypto` import in `src/core/coverage.ts`, re-exported by the core
barrel (both present at base `63d3f9e`). No unrelated core/bundler rewrite was made.
A clean production build in a supported environment, packaged Electron validation
and a separately authorized live mathematical investigation remain outstanding.
