# Refined notes and isolated proposed maps

29 October 2026. R06–R09, R14–R17; a bounded resolve/preview extension of AGENTS.md
§8.1. Editable review and approved concept/typed-association integration are documented
in [the next slice](atlas-map-integration.md); formal proposition/argument application
remains pending. This does not complete Phase 3 or provide theorem verification.

## Available workflow

Open a prepared first reading and choose **Refine into proposed map**. The explicit
disclosure names the configured vision model and additional usage: the saved
reading, source images and up to 200 linked concept names/aliases are sent. No other
vault content, concept Markdown or chat history is added. Destination checking,
foreground subscription routing, shared queue and usage accumulation are reused.
There is no provider fallback, automatic refinement or silent retry.

The second pass sees the first reading and actual images together. Modern retained
image sets are hash-verified and reused; older paper-page readings cause a fresh
whole-canvas export of the same saved original. The prompt explains the two image
index spaces and requires fresh citations to current views. The original drawing
and first reading are immutable. A refinement cannot itself be used as a new
first reading, avoiding an unbounded chain of self-reinforcement.

Refinement may resolve likely notation, organize explanations and propose missing
steps or connections. Every concept identity, note block and connection declares
one of three origins:

- **From drawing:** a claimed reading of visible source content, with evidence.
- **Reconstructed:** an inference from the source/context, with evidence, rationale,
  assumptions and residual uncertainty. It is not a literal transcription.
- **Added explanation:** model-supplied background, with a rationale and assumptions;
  source evidence may be absent. It is not attributed to the owner.

These are model declarations, not independently certified classifications. Checks
reject missing grounding/rationales, nonexistent image indices, unknown first-pass
keys, duplicate keys, invalid endpoints and unsupported existing identity matches.
They do not prove that a quoted mark was read correctly or a derivation is valid.
Only exact supplied names/aliases can suggest existing IDs; full mathematical identity auditing remains pending; the integration slice adds
explicit owner identity choices. The overview is labelled model
synthesis, and unresolved questions stay prominent.

The existing single-submit runner is reused, with only a draft-submit tool. Up to
two calls permit schema repair, capped at 10,000 output tokens each or the model's
smaller limit, and a 20-minute model deadline after image preparation. No file,
web, arbitrary tool or graph-writing capabilities are provided.

## Preview

Prepared refinements open **Proposed map**, showing only that draft, with a summary,
questions and origin legend. This reuses `GraphCanvasRenderer`, the existing D3
forces, zoom, picking and local dragging. A deterministic private layout starts
from source positions where available. Node colours indicate identity origin;
individual notes retain their own origins. Directed connections show arrowheads;
unclear direction is dashed. The arrows are proposed connections, not assertions
in the canonical proposition/argument ledger.

Selecting a concept opens its notes, assumptions and evidence. Accessible concept
and connection lists provide another way to inspect the draft; a canvas failure
leaves these lists usable. Source links switch to the exact captured image and
highlight the cited region. **First-pass reading** and the attempt selector reopen
retained earlier results. Camera/layout changes remain private to the preview:
the isolated draft does not write Atlas positions. The later integration slice
adds an explicit Atlas comparison and approved apply action. Reopening a draft is read-only
and does not call a model.

## Storage and recovery

The existing `map_proposals` table is retained; the later editable-review slice
adds separate tables in SQLite schema v9. New refinement
records use envelope v3; v1/v2 readings and their digest behaviour remain supported.
The envelope binds a prepared first-reading ID and digest, source revision/hash,
current base/context, model, image layout/hashes, the draft and usage. The prepared
digest covers the parent reference and the complete draft, including origins.
The store rechecks the parent and source during transactional intent creation;
updates cannot change that binding. It does not overwrite the parent or allocate
canonical concept/relation IDs. Backups still include SQLite and `mindmaps/`.

A durable running intent precedes preparation/dispatch. One running attempt per
source, the 20-attempt per-source cap, terminal immutability, owner/restart recovery,
and request-token idempotency are unchanged. Identical tokens or a cached prepared
refinement of the same parent return the saved result unless explicit reprocessing
is requested. Failures/cancellation preserve the first reading and recorded usage;
an explicit retry is a separate attempt. Timeout is distinguished from cancellation.
No approval receipt, canonical processing coverage or semantic commit is recorded.

## Validation scope

Tests use fake providers and isolated profiles. They cover actual shared-runner
delivery of images plus the first reading, source/parent binding, retained origins,
usage, idempotency, retry/cancellation, backup restore and digest tamper detection.
Pure checks cover grounding, keys, endpoints, identity suggestions, deterministic
private layout and input immutability. React checks cover overview-first review,
notes, provenance, source selection and absence of apply controls. Live mathematical
reconstruction quality requires an explicit owner-triggered comparison; passing
these checks does not establish recognition or reasoning accuracy.
