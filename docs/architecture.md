# Research Atlas — Architecture

This guide describes the current code. Research Atlas extends LearnHarness with Atlas concepts, reviewed sources, mathematical lessons, spaced review, and research trails. The [original product contract](archive/agent-contract-2026-11-18.md) records product requirements and owner decisions. Use the feature guides below for implementation details and remaining gates.

## Layers and import law

| Layer | Owns |
|---|---|
| `app/` | Next.js pages and thin transport handlers. Imports shared contracts and services through `@/src/core` and `@/src/server`. |
| `components/` | Browser presentation and interaction, including the Canvas graph, chat, lesson map, docks, and scratchpad. Uses the browser-safe core barrel and HTTP APIs. |
| `src/core/` | Domain contracts, pure rules, projections, and ports. No dependencies on agent, server, or store adapters. Keep server-only modules off the public barrel. |
| `src/agent/` | Pi agent construction, prompts, model routing, and tool loops. Receives dependencies through injected ports and factories. |
| `src/store/` | Files, SQLite, formats, and migrations. Domain judgment belongs above this layer. |
| `src/server/` | Coordination. [`stores.ts`](../src/server/stores.ts) wires adapters and [`chat-handler.ts`](../src/server/chat-handler.ts) composes turns. |
| `electron/` | Desktop host, trusted window, private IPC, and standalone server lifecycle. |

[`eslint.config.mjs`](../eslint.config.mjs) enforces the inward import rules. The [bounded body reader](../src/server/request-body.ts) checks both declared and actual request bytes. Each caller sets its own limit. The app also runs in ordinary web/dev mode for a trusted local user.

## Turns and background work

- [`/api/chat`](../app/api/chat/route.ts) accepts turn input. The turn handler claims one active turn per chat, persists input, runs the selected Pi agent, and settles the durable record. [Native chat history](../src/core/contracts/chat.ts) stores typed `LhMessage` records. [Model projection](../src/core/native-messages.ts) and [UI projection](../src/core/view.ts) adapt that history at their boundaries. [The stream bridge](../src/server/pi/ui-stream.ts) carries live updates.
- Legacy probe/teach, short Practice, and Atlas conversational lessons have their own turn and question rules. Restore pending work from the saved record. Keep the saved lesson map separate from the model-only context projection. See [learning policy](learning-policy.md), [lesson delivery](lesson-delivery.md), and [compaction and accounting](compaction-accounting.md).
- Background jobs acknowledge the tool call, persist progress and results, then deliver results through the [job coordinator](../src/server/jobs.ts). The wake path serializes delivery per chat and uses stable IDs and receipts across interruption or retry. Respect the active turn and pending-question gates.
- [`/api/events`](../app/api/events/route.ts) carries server-sent notifications. Fetch the authoritative record after an event and on reconnect. Events carry change hints and IDs. The event stream has no independent copy of application data.

Chat listing caches derived summaries in memory. Local writes and external file changes invalidate them. Native chat files remain authoritative.

## Graph and reviewed knowledge

The Library's [extraction pipeline](../src/agent/subagents/extraction.ts) reads teacher output or imported notes, proposes claims and reasoning, audits identity, then uses the deterministic [merger](../src/core/graph.ts). The identity audit resolves reuse or creation. Mathematical validity is a separate judgment. The graph's stored arguments retain jointly sufficient premises. Edges and implication junctions are projections. Confirmed deletion and maintenance use their explicit [service path](../src/core/graph-deletion.ts).

[`src/store/graph.ts`](../src/store/graph.ts) owns the canonical ledgers. Each append starts on a fresh line so a partially written record cannot swallow the next save. Existing graph views still derive birth-session provenance groups. Atlas adds subjects, memberships, stable positions, and saved camera/search views through its extension store and the existing Canvas renderer.

### Reviewed synchronization

Map and lesson workflows retain source revisions, draft interpretations, and exact owner approvals. The owning services commit approved changes and record receipts for replay and recovery. A drawing edit affects the depiction. Removal of canonical propositions or arguments requires its explicit maintenance path. Ordinary legacy sessions retain their existing extraction behavior. Atlas-linked lesson and sync workflows have their own reviewed paths.

## Practice and review

Short adaptive Practice is a [chat kind](../src/core/contracts/chat.ts) with [practice tools](../src/agent/tools/practice.ts). The conversation retains the committed problem and hint/attempt/reveal state. [Spaced Review](atlas-spaced-review.md) schedules retrieval targets with FSRS. [Challenges](atlas-challenges.md) retain longer problems and their attempt history. Learning-policy events can reference their outcomes. They do not replace native schedules, results, or canonical mathematics.

The [Practice base prompt](../src/agent/prompts/practice/00-base.md) owns posing, concluding, and the pause before the next problem. The [Practice doctrine](../src/agent/prompts/practice/10-doctrine.md) owns selection, hint depth, and judging submitted reasoning.

## Storage and recovery

[`config.ts`](../config.ts) sets `LH_DATA_DIR` for app-owned data. The packaged desktop app uses its user-data directory. [Development](development.md) describes the separate local profile.

| Record | Source of truth |
|---|---|
| Propositions and arguments | `graph/{nodes,chains}.jsonl`. Companion ledgers retain extraction checkpoints and coverage. |
| Conversations, jobs, preferences | `chats/`, `jobs/`, and `settings.json`. Graph positions and display settings have their own files. Prompt overrides live under `prompts/`. |
| Atlas extension | [`atlas.sqlite`](../src/store/atlas.ts) for concepts, typed links, subjects, review and retrieval records, research trails, and integration metadata. Concept notes and managed source revisions also use files. |
| Lessons, drawings, and reading | `lessons/`, `lesson-sources/`, `scratchpads/`, and `article-reading/` keep plans, attachments, editable scenes, and submitted work. Personal evidence lives in `learning-policy/learning.sqlite`. |
| Research | Atlas retains trail and review records. `python-workbench/` and `research-sources/` hold managed workbench and source records. A linked project owns its code and original run artifacts. `.research-atlas/` holds the portable project interchange files. |
| Credentials | `LH_AUTH_FILE` selects the API-key store. Subscription records live beside it in web/dev. ChatGPT uses macOS Keychain on macOS and the private file adapter elsewhere. See [credential storage and recovery](credential-storage-plan.md). |

Keep one application writer per profile. Filesystem writes and process-local locks have no cross-store transaction guarantee. Use atomic replacement for mutable records, SQLite transactions for database operations, and the existing revision checks and receipts for multi-step operations. Preserve legacy reads and future-version refusal. Back up the complete data root with the app stopped or with SQLite-consistent tooling. Account for managed assets, external projects, and platform credential storage separately.

## Host and provider boundaries

The packaged Electron host starts Next's standalone server on loopback and gates its API to the trusted window. Keep renderer isolation, sandboxing, and origin checks. The app uses the configured provider and model with separate background-use consent. The packaged host owns subscription credentials and supplies scoped request authorization to its server. In web/dev the server owns these connections. The [development guide](development.md#subscription-connections-in-webdev) describes sign-in and trusted-server limits. [Desktop builds and release checks](desktop-release.md) cover the native payload.

## Feature guides

| Area | Guide |
|---|---|
| Atlas | [Foundation](atlas-foundation.md), [layout](atlas-layout.md), [saved views](atlas-views.md), [typed links](atlas-relations.md), [queries](atlas-queries.md), [focused maps](atlas-neighbourhoods.md), [drawing controls](atlas-drawing-controls.md), [removal](atlas-demo-and-removal.md) |
| Rnote and reviewed sources | [Import and revisions](atlas-mindmaps.md), [interpretation](atlas-map-proposals.md), [refinement](atlas-map-refinement.md), [review and integration](atlas-map-integration.md), [reviewed learning feedback](atlas-reviewed-learning.md) |
| Lessons | [Workspace](atlas-learning-workspace.md), [Atlas context](atlas-aware-lessons.md), [derivations](atlas-concept-derivations.md), [source attachments](atlas-lesson-sources.md), [scratchpad](atlas-scratchpad.md), [lesson integration](atlas-lesson-integration.md), [learning policy](learning-policy.md), [delivery](lesson-delivery.md) |
| Reading and research | [Article reading](article-reading.md), [literature companion](maths-companion.md), [Python Workbench](python-workbench.md), [research trails and projects](research-trails-p0.md), [incremental evidence review](research-p1.md), [Research Frontier](research-frontier.md) |
| Practice | [Spaced Review](atlas-spaced-review.md), [Challenges](atlas-challenges.md) |
| Runtime details | [Prompt layout](../src/agent/prompts/README.md), [compaction and cost](compaction-accounting.md), [keyboard](keyboard.md), [tool-content recovery](tool-content-recovery.md), [learning-history migration](learning-policy.md#storage-migration-and-recovery) |

[Archived architecture](archive/architecture-2026-11-18.md), [upstream vision](archive/vision.md), [build plan](archive/plan.md), and [teaching theory](archive/teaching-methodology.md) preserve the earlier designs and decision history.
