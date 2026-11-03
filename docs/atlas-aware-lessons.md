# Atlas-aware lessons

As built (31 October 2026): the home composer has one optional **Atlas context**
picker. Search concept names, aliases or subjects, select up to 20 starting
concepts, then describe the objective in normal prose and start Teach. Direct
concept/derivation learning actions use the same context. Editing that selection
returns it to general conceptual teaching and clears a single-proof/relation target.
Selected order is preserved in the initial lesson map; duplicate or deleted IDs
are rejected before a chat is created. No graph positions or knowledge are changed.

Conversational learning agents get two read-only tools when the existing graph
master switch and agent graph-access setting permit them:

- `search_atlas`: deterministic text search over concepts/aliases/notes/subject
  names and canonical claim statements. Twelve results per page; `nextOffset`
  permits further retrieval. Search excerpts are explicitly partial.
- `read_atlas`: inspect an exact concept, canonical claim or committed lesson ID.
  Concepts expose full notes, memberships, ordinary/typed connections with status,
  linked claim/lesson IDs and dated self-reported learning observations/assistance.
  Claims expose their complete statements, provenance, argument IDs and full joint
  premise ID sets. Saved lessons expose reviewed argument rationale, gaps,
  assistance and canonical mappings. An optional `focusId` narrows a large lesson
  to one canonical claim/argument explanation. Readers omit whole secondary records under
  explicit count/character budgets; omitted counts never imply absence of proof.
  Requests exceeding the 48,000-character overall read budget refuse explicitly.

The teacher should briefly consult relevant context before planning the route,
then teach rather than browse indefinitely. It can revisit notes and saved proofs
when a useful tangent or prerequisite arises, and use `update_lesson` to connect
existing IDs to genuinely new, still-local topics. With lookup enabled, plan
updates reject invented/deleted concept IDs; new topics use `conceptId=null`.
No compulsory quiz, approval gate or extra lesson dashboard was added. A node or
previous discussion never certifies independent understanding. Outcomes and help
remain source-labelled observations, not a calibrated mastery score.

## Boundaries

`src/core/atlas-lesson-context.ts` owns pure retrieval/projection through a read-only
port. `src/agent/tools/atlas-lesson.ts` wraps it using the existing native tool
execution path. The chat handler injects current Atlas and canonical graph reads,
excluding partial applying integrations, plus committed review access. Retrieved
notes are evidence, never instructions. Native tool calls/results persist and
replay through the existing chat machinery; there is no parallel context store,
standing polling loop, automatic research agent or schema migration.

Only requested records enter the conversation/provider context; no whole-Atlas
prompt dump, scratchpad pixels or unsubmitted drawing text are uploaded by these
tools. Existing explicit selected-context capture remains unchanged. Legacy and
practice agents retain their existing toolsets. Knowledge changes continue through
reviewed integration; lookup and lesson planning never write canonical mathematics.

This is text lookup with stable IDs and actual stored links, not embeddings or an
inferred proof path. It primes teaching tentatively using saved evidence. Detailed
research workflows, semantic search and independently calibrated understanding
remain future work. The same injected lookup seam can later serve research.

Validation covers multi-selection/removal and read-only UI requests, duplicate /
stale-ID refusal, selection order, search paging, whole-premise preservation,
record limits, reviewed rationale/gaps, native search→read→plan→prose delivery,
unchanged canonical data and the existing disabled-graph setting. Native model
interaction uses scripted fixtures; no paid model lesson or live tablet evaluation
is implied.
