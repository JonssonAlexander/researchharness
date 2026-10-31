# Reviewed lesson maps and derivations

As built: conversational learning sessions use **Review lesson**, also opened after
owner-selected Finish. Building the proposal is an explicit model action; finishing
alone makes no provider call. Legacy chats retain the earlier concept-note review.

One proposal contains three views: the editable conceptual Lesson map, separate
Derivations with Start/Finish and claim/argument explanations, and In Atlas for
placement and concept identity choices. New main concepts are optional: zero is
valid. Proof steps are canonical propositions underneath concepts, not new main
Atlas concepts. Ordinary map associations stay non-logical. Missing proof steps
remain labelled gaps and are omitted from canonical inference arrows. Each
argument preserves its complete joint-premise set, explanatory rationale, source
message references and session / AI / owner-edit origin. Approval records sourced
assertions, not verified proofs or personal mastery.

Relevant existing concepts receive appended sourced notes and derivation roots;
their names, definitions, memberships and positions remain. Exact full proposition
statements/aliases can reuse one unambiguous canonical identity automatically.
Other suggested identities require an explicit choice. Similar names do not prove
identity. Shared claims and joint arguments reuse canonical IDs; claims are never
merged merely because their titles match. Proofs without main concepts remain
accessible through Atlas → Lesson maps. Concept detail → Derivations opens the
canonical graph and saved full argument. A small count beside a concept shows its
saved derivations; amber markers preserve AI additions, uncertainty and proof gaps.

The browser-safe core validates references and plans stable IDs. The agent returns
one bounded structured proposal via the existing submit runner. The server captures
the complete native transcript (refusing over 160,000 characters), saved lesson
plan/targets, up to 80 relevant concepts and 80 canonical claims within a 60,000
character claim-context budget. At most two model calls share a 20-minute limit;
usage is persisted per call. Saved review/approval requires the exact source hash,
Atlas layout revision and canonical graph hash. Changes require a fresh proposal.
No source truncation, hidden retry or live provider test is implied.

Schema v14 adds `lesson_reviews`, with a v13 database backup before migration.
Its hashed records retain the captured source, draft, decisions, plan, usage,
approval and receipt. The latest committed map per session appears in Atlas;
older reviews remain readable by ID. Full data-root backups include the SQLite
metadata, referenced note blobs, native chats/lessons and canonical ledgers.

Approval first journals an `applying` record with reserved canonical IDs. Under
the existing Library FIFO gate it calls the existing `mergeFindings` writer with
those IDs and an operation tag. This reviewed mode preserves the exact approved
arguments and skips unrelated graph simplification and extraction checkpoints.
Then one SQLite transaction appends sourced concept notes/references, ordinary
associations and the committed receipt. Partial canonical writes are hidden from
the graph endpoint; retry **Resume approved integration** with the same approval.
Recovery strips only that operation's append lines when checking the original
canonical base, then replays missing writes without duplicating provenance. Other
pending integrations, background extraction merges and canonical/session deletion
are fenced. Conflicting external changes are refused, never silently overwritten.
There is no distributed transaction across the ledgers and SQLite: the durable
journal and exact retry provide recovery. Keep a data-root backup before manual
conflict repair.

Embedded handwriting and retained multimodal attempts are now implemented in the
learning scratchpad slice. New reviews also attach saved scratchwork to topics,
concepts and derivation results; see [attachment storage and limits](atlas-scratchpad.md#lesson-integration-attachments). FSRS, challenging practice and research
workflows remain later work. Scratchwork remains working evidence, not a proof certificate.

Review readability: proof views use deterministic forward rows with reserved label
space and label-aware resize/fit, retaining explicit joint-premise junctions.
Short graph handles are presentation only. Start/Finish and the selected claim
have expandable full statements; a step sidebar shows only that step's arguments.
Editing, provenance, generation settings and integration metrics are progressively
disclosed. Model instructions favour short labels, target equations and key proof
ideas with essential assumptions, rather than repeated audit prose. Existing saved
statements and source metadata remain complete; these display changes do not
rewrite or approve mathematical content.
