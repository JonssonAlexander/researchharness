# Lesson source attachments

Implemented 1 November 2026 (R05, R10–R11, R14–R17).

**Add source** is available on the home teaching composer and in conversational
lessons. Attach PDF, TXT, Markdown, LaTeX, CSV or JSON. Saved articles can be
exported to PDF; Word and other binary formats are not parsed in this slice.
Up to eight sources per lesson, 25 MB each; text sources are UTF-8 and at most
2 MB, PDFs at most 500 pages. Adding files alone never calls a model.

Home stages files in memory, uploads them to the created lesson before navigation
and preserves them for retry if upload fails. A source-only start supplies a short
default teaching request. In an existing lesson, upload is disabled during a reply;
adding a source suggests a prompt only if the composer is empty. The owner sends
it normally. Sources can be downloaded using their filename chips. Failed partial
batches retain successfully attached files; repeated bytes deduplicate in the same
lesson. Staged, not-yet-uploaded files do not survive a browser reload.

The teacher receives a small source catalog on each turn, including after chat
compaction/restart. Injected read-only tools list lesson sources, read bounded
excerpts (12,000 characters, up to three PDF pages, explicit next offset/page),
and inspect a single PDF page with the existing native renderer. Page inspection
requires an image-capable teaching model and has pixel/output size bounds. No
arbitrary filesystem path is exposed to the agent. PDF text can lose formulae or
layout; guidance directs the teacher to inspect pages when needed and retain
uncertainty, not silently reconstruct unread notation. Image reading accuracy
remains model-dependent; scanned PDFs do not acquire a separate OCR service.

Existing search_atlas/read_atlas tools remain available under the existing graph
access setting. Source-based planning starts with the paper's question and useful
conceptual route, consults existing concepts and recorded arguments/assistance,
then develops selected methods/derivations. A saved node never certifies mastery.
The teacher distinguishes source claims, reconstructions and added explanations;
source contents are evidence, never operating instructions. Canonical knowledge
still requires reviewed integration. This does not automatically add uploaded
papers or their claims to the Atlas or to FSRS.

Originals stay in `lesson-sources/<chat>/ls_<sha256>.original`, with versioned JSON
metadata published atomically after the bytes. Originals are checked against their
SHA-256/size whenever read. The source store is wired once in `stores.ts`, separate
from canonical graph writers. Include this directory in data backups. No SQLite
migration or new dependency is required. Source originals are retained even when a
chat is deleted; no attachment erasure/cleanup UI or source-to-Atlas gallery is
implemented here. The lesson download endpoint requires its live lesson/chat.

Uploading and parsing are local. During an explicitly requested lesson, retrieved
excerpts or selected rendered pages are sent through the configured teaching
model's existing native tool-result path and usage accounting. There is no separate
paid ingestion or background model call. Native history retains retrieved tool
results; local originals remain available across compaction. This intentionally
avoids dumping whole papers into every prompt.

Validation: 59 focused source/lesson/UI/PDF tests passed, including immutable
originals, scoped IDs, deduplication, corruption refusal, real PDF text/rendering,
invalid formats, download, native source-plus-Atlas lookup/lesson-plan replay and
an upload control that never dispatches a turn. Typecheck and targeted lint passed.
No live paid-model interpretation or owner-file upload was needed for these tests.

Layout follow-up: Atlas context and the paperclip share one compact home row.
The context picker opens above the composer. Source attachment is an icon button
with an accessible name/tooltip; filenames remain compact chips. The PDF/text
help message was removed at the owner’s request.
