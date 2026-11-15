# Article reading and saved maps

Open a PDF source chip, a research result's **Read passage**, or **Read** in its
chat. Choose among the session's PDFs in the compact selector. Drag the divider
(or use its arrow keys) to resize article and map. Narrow windows switch between
Article and Map. **Chat** returns to the existing conversation.

The main canvas belongs to this PDF within this session. Its strokes, viewport,
PDF page/zoom and divider autosave. Text-only source documents keep their existing
download/lesson behavior; this reading workspace is for PDFs.

Select text or use **Box equation** to create a comment. Save/edit/remove the note,
link an existing lesson topic, or attach selected handwriting from the main map
(the whole canvas is used when nothing is selected). Numbered margin bubbles reopen
comments. Handwriting attachments are immutable snapshots with retained editable
scenes. The PDF itself is never edited.

**Ask in chat** explicitly submits passage context and its image to the same
teacher. **Ask about map** submits selected map elements, or the whole map. A
**Quick derivation** sends the selected argument and opens an independent blank
scratchpad with the existing sizing, dictation and submission controls. Reopen it
from its comment; prior submissions also remain in native conversation history.
Comments show linked question/explanation exchanges and an Open in chat action.
No source relationship is guessed. Reading doesn't integrate knowledge or advance
lesson progress. Existing lesson/tangent tools and reviewed integration stay in
charge.

## Storage and boundaries

- `article-reading/<session>/<PDF SHA-256>.json`: versioned metadata, normalized
  page rectangles, comment links, registered pad IDs, page, zoom and divider.
- `active.json` records the last open PDF. Identical PDF bytes within a session
  reuse one canvas even when present in both lesson and research sources.
- Existing scratchpad storage owns editable scenes, viewport and immutable PNG
  submissions. Registered targets use `reading_<hash>` and `readq_<uuid>`.
- Existing native messages own all chat exchanges; comments reference their IDs.
- Original PDFs remain in their existing lesson/research stores. Access checks
  enforce session ownership and original byte hashes. Coordinates never migrate
  to a changed source version.
- Metadata/drawing writes use revision checks. Conflicts fail visibly instead of
  silently overwriting another writer. Failed drawings can be downloaded locally.
- Retries reuse stable action IDs; preparation saves before delivery. Explicit
  submission still requires a model that accepts images. No autosaved drawing is
  sent by opening, highlighting, attaching a local note, or switching views.
- A research chat with no lesson receives an existing learning-session shell only
  when the learner explicitly asks an article question.

## Validation

Focused regression tests cover article ownership/deduplication, revision conflicts,
restart restoration, separate quick pads, immutable snapshots, repeated requests,
comment edit/removal, native question delivery and unchanged lesson state while
browsing. Existing scratchpad/source and workbench HTTP tests also pass.

An isolated Chrome fixture checked PDF text selection, margin bubbles, drawing
save, handwriting attachment, Chat/Reading restoration, divider/page persistence,
multiple-PDF switching and narrow/wide layouts. No paid provider or pen-hardware
acceptance test was run. Scanned PDFs use equation boxes when no text layer exists.

## PDF library and continuous reading

**Atlas → PDF library** lists saved lesson and research PDFs across sessions, with
search by article or session title. The same library is available in the reading
header. A library link opens the owning session and its saved canvas; repeated PDFs
in different sessions retain their separate notes and conversation contexts.

Pages scroll continuously. The compact page field follows scrolling and still
allows direct jumps. Only nearby pages render canvases/text layers, releasing
pixel memory for distant pages. Passage selections and equation boxes remain
page-relative at every zoom. **Rename** changes a session article's display title;
it preserves original filenames, source hashes, comment coordinates and pad IDs.
Titles default to the original upload/source title; no model call is needed.

## Guided reading — conceptual overview

**Overview** opens a result-first reading route in the right-hand panel, beside
the PDF. On first use (or for an older flat guide), it asks the existing teacher
to read the main results and build a short orientation plus 4–6 teaching stops:
main result, setup, why it works, and consequences. Later clicks reuse the saved
route immediately, without another model call. The PDF moves to the first main
result and frames a verified passage; **Next / Back** follows teaching order rather
than page order. Unlocated passages retain honest page-only navigation.

Explanations never cover the PDF. Each stop has a short mathematical statement and
plain-language intuition. Assumptions/details, discussion, older passages and
highlight settings expand only when wanted. A compact route list gives orientation.
**Map** switches the right panel back to the saved Excalidraw canvas; the canvas
remains mounted and retains its work and viewport. Selecting a highlight opens
its explanation in the right panel. Chat and independent scratchwork keep their
existing explicit submission path.

The orientation, teaching order, source IDs and visibility persist. Existing flat
guides remain readable under further passages; a deliberate Overview request can
build a better route without deleting their anchors or discussion. Rebuilding is
explicit, and ordinary questions never generate markup. Newly appended passages
do not replace the saved route. The configured teaching model and normal session
usage apply; no additional autonomous agent is introduced.

The teacher selects semantic content through `list_reading_guides`,
`read_guide_source`, `add_reading_highlights`, and `set_reading_route`. The server alone produces
rectangles using the existing unique, whitespace-normalized PDF text matcher.
Unmatched, repeated, too-short or unsupported rotated quotations get page-only
locations. Matching a nearby caption highlights that caption, not an inferred
equation box. Source quotations are not proof verification; explanations are AI
interpretations. No guide item writes to Atlas, FSRS or lesson progress.

Guides live inside each article's revision-checked workspace under an optional
`guide` field, with a conceptual-overview lens, captured lesson objective, visibility,
up to 32 entries, and an optional structured route. Route stops can reference only
saved passage IDs, must start with a result and include setup, mechanism and
consequences; unknown IDs or duplicated stops are refused. Individual calls add at most eight entries. Stable IDs derive
from source hash, PDF page and normalized quotation; retries preserve existing
entries and their linked attempts. Publication re-reads metadata after PDF lookup
to retain intervening comments and reading position. Original bytes are rechecked;
all temporary PDF copies are deleted after local extraction/location.

Validation includes real PDF matching and fallback, persistence/restart, append
idempotency, source/page/topic guards, cancellation, concurrent metadata preservation,
native teacher tool calls and guide-linked scratchwork. Browser checks use a small
fixture; owner-paper semantic quality and live paid-model acceptance remain manual.

Isolated Chrome also checked exact-region clicks, inline explanations, page-only
fallback, hiding highlights and reopening with the saved visibility setting. This
used local fixture data and no paid model calls.

Route redesign validation: focused tests cover valid/invalid teaching routes,
source-ID references, preservation of existing passages, native teacher route-tool
execution and the concise panel structure. Isolated Chrome checked result framing,
no explanation overlap with the PDF, Next navigation, Map switching and reopening
a cached route without new chat/model requests. Semantic quality on the owner's
paper still requires a deliberate new Overview request using the selected model.
