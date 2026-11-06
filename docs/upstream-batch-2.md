# Upstream batch 2: PDF text and claim candidate retrieval

Selective integration from LearnHarness `713377f366771e3e4730e6acd1bc290e0ebc6d6e`
onto Atlas `087ff1f`. Retrieval improvements only; upstream's relaxed automatic
identity policy is deliberately excluded.

## PDF reading

The final rule-based converter uses the existing pdfjs dependency, text positions
and font sizes. It preserves extracted lines, hyphen breaks, repeated headers and
margin numbers. Formatting is page-local: extracting one page and searching the
whole document yield the same text and line references. Textless raster pages and
empty pages are distinguished. Original PDFs and Atlas's native bounded page-image
inspection remain authoritative for equations, figures and scans.

Both `pdfExtract` and `pdfSearch` use this converter. Existing Add source lessons
benefit through their existing reader; no extra import workflow, endpoint, upload
limit or dependency is introduced. Text inspection/search/loading failures release
the PDF task; existing render limits are preserved. Column inference skips its
quadratic gap comparison above 2,048 gaps, keeping all text in stream order instead.

The converter is heuristic text extraction, not OCR or mathematical reconstruction.
PDF font encodings may lose glyphs; Markdown is not a substitute for inspecting
page images. The existing source-original hashes and publication protocol are
unchanged.

## Candidate lookup

A pure in-memory BM25 module ranks full canonical names, statements and aliases.
It has deterministic ties, Unicode word normalization, per-node alias deduplication
and no embedding model, persistent index, network call or identity threshold.
Tokenization does not understand mathematical equivalence or notation.

Legacy extraction receives the first five lexical candidates per finding, with
shared candidate bodies deduplicated. The read-only `find_candidates` tool can
continue with opaque cursors bound to the audit, finding and exact hint query.
Graph records and findings are captured together; later mutations cannot change
continuation pages. Unknown/foreign cursors, mixed hints/cursors, duplicate request
IDs and unsafe offsets are rejected. Conflicting duplicate findings use the first
occurrence, matching the existing merger. Repeated calls do not suppress records.
Tool request counts and hint sizes are bounded; complete statements are returned.

The existing reviewed lesson workflow uses the same scorer to choose its bounded
claim context: claims linked to selected concepts first, then lexical relevance,
with at most 80 whole records and a 60,000-character record budget. Omitted claim
counts are supplied to the model. Complete joint arguments are included only when
all their premises and conclusion are present. This adds no model calls or tools
to lesson review and changes no identity selectors or approval behavior.

Retrieval does not write, approve, rename or merge claims. The legacy auditor's
lookup instructions now require the whole assertion, assumptions, domain and
quantifiers to agree; a consequence, special case or partial clause match is not
identity. Its pre-existing submit/merger pathway remains; no new automatic identity
algorithm is added. Atlas's explicit reviewed integration, exact-match defaults,
source/base hashes, stable IDs, joint premises and receipts remain unchanged.

## Donor provenance and validation

- `e1e55a7ee9753102062fb7279bec75bc6f866c4d`: cherry-picked converter foundation.
- `8999f08b2aaf767d9c5f0a2a53e131ceb3816106`: adapted PDF read/search integration.
- `071a850dac8a16af193dc8bc26a04305b69bc88f` and
  `8485d732ce1b4dfe27317bba1e5aef412ee6e5d0`: final conservative converter and tests,
  including retained column-order/glyph/heading changes from intermediate commits.
- `c58ea7ec44ce2408114c696cbc0a735e7464c35c`: strict whole-claim identity boundaries.
- `4f896993b57a52f4e635150ba371f26887d64aa5`,
  `4e22e9c6da35d61118646c9a5b04bdb4e660c650` and
  `cee2fec7b25c860a090359b00a7fe3a9b388d6c4`: scorer, first-finding repair, initial
  lookup and query-bound pagination, excluding their relaxed identity prompts.
- `1f9e3b219c846690d188a9fa0f358fdec6c6ae66`: explicit submit-tool requirement.

Legacy canonical PDF note import from `241f4cdb` and its proxy/body-limit changes
from `dd74fa88` are excluded; Add source already has bounded immutable uploads.
No intermediate lossy footer deletion or hyphen reconstruction is imported.

Validation: 394 tests passed across 20 test files selected for PDF conversion,
reads/searches, extraction, retrieval tools, lesson sources, reviewed integration,
canonical derivations, Atlas queries/sync, maps, scratchpads, Problems, FSRS and
native session replay. Synthetic layout fixtures and the committed PDF cover
column order, headings, symbols, control bytes, scans, raster operators, selected
page stability and dense-page fallback. Additional cases cover frozen snapshots,
foreign/changed query cursors and a relevant claim beyond the old 80-record cutoff,
without canonical writes. Typecheck and targeted ESLint passed. No live owner
profile or paid model was used; real-paper extraction accuracy and packaged desktop
behavior were not manually assessed. No new UI requires a visual layout check.
