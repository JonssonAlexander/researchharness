# Research Frontier

Open Atlas and choose **Build session brief**. Subsequent sessions open the saved brief immediately. **Start research session** checks the current evidence against that brief and reuses it with zero model calls when the goal and evidence are unchanged. **Refresh brief** deliberately runs discovery again. For a changed source, the next session keeps eligible assessments from unaffected neighborhoods and rechecks a bounded set of affected hypotheses. A brief can contain fewer than three directions when too few pass critique.

A direction shows the hypothesis, mathematical starting point, intuition, obstacles, possible novelty relative to the supplied records, and an actionable next question. Evidence opens the saved source text and available Atlas, conversation, trail, or original citation. **Deepen** performs a focused assessment with an expanded local packet. If the library has changed, start a fresh session to bring the brief up to date. **Promote to trail** adds an approach branch to a chosen existing trail. The branch cites its discovery run and evidence. Retrying promotion reuses its branch ID.

## Evidence and execution

- The server reads Atlas concepts and relationships, canonical propositions and joint arguments, integrated lesson records, working lesson maps and derivation targets, submitted derivation text, trail history, reviewed P1 evidence, and cited research findings from linked discussions. It reuses Atlas search for a supplied goal and follows stable IDs for adjacency. Layout and UI state are outside the fingerprint. Canonical appends from an interrupted lesson approval stay hidden until integration finishes.
- The deterministic planner prioritizes known gaps and unresolved research, links topics across lessons by explicit concept bindings, and includes a separate exploration packet when other evidence is available. Large records are omitted whole. A joint argument travels with its conclusion and every premise. Prompts distinguish canonical statements, reviewed derivations, lesson depictions, and tentative model readings.
- A fresh pass typically uses two generation calls of up to nine candidates each, then one structured critique call. Changes to a small portion of the frontier can use one generation call. Deterministic filtering removes whitespace-equivalent hypotheses while preserving mathematical symbols and case. Critique reviews semantic overlap, and deterministic selection favors distinct principal sources among the final directions. Usefulness and support carry more weight than surprise. If the leading opportunity has additional nearby evidence and budget headroom, it receives a fourth call. Manual deepening uses one call.
- The 27,000-token working target informs shortlist size. The configurable budget target starts at 35,000 and governs optional deepening. Prompt and retrieval packets have character bounds and each request carries an output target. Provider-specific accounting and reasoning can differ, so these are estimates. The job stores reported input, output, cache reads and writes, and completed model steps using the existing usage accounting.
- The configured Researcher model or its existing slot is used through Pi, the shared background semaphore, and provider consent gates. Each stage receives fresh context and a submit-only schema. The desktop can show the provider before dispatch. Bounded source packets and selected research history leave the device when the configured provider is remote.

## Persistence and recovery

The ledger is stored in ordinary versioned Frontier job records under the application data root. It retains source fingerprints, evidence, candidates, assessments, earlier rejections, and completed stage checkpoints. One pass runs per profile. Job events update the brief after durable writes. After interruption, **Resume** continues from the saved stage and uses the pinned model. **Retry from saved progress** does the same after a recoverable stage failure. A crash between a provider response and its checkpoint may repeat that call and its reporting can be incomplete. **Cancel** uses the shared job abort registry and leaves the last successful brief available.

An exact title match or a conceptual connection establishes no mathematical identity. An explicit promotion writes a research branch through existing trail validation and receipts. Canonical writes require the normal reviewed integration path.

## Validation and benchmark

The test suite exercises source packing, cross-lesson bridges, working evidence, duplicate submissions, zero-call cache reuse, selective reevaluation, model output validation, restart, failure, cancellation, saved-brief rendering, deepening, and retry-safe promotion.

Run the offline ablation with `NODE_ENV=test node --import tsx scripts/benchmark-research-frontier.ts`. It uses checked-in repository fixtures for binary skill tracking, empirical risk, and linear constraints. Each case has allowlisted earlier canonical records and withheld later result IDs and statements. Working-lesson and prior-attempt overlays are reconstructed inputs. The scripted model checks every request for the withheld material. Numbers below are ranges across those three cases.

| Context | Calls | Token estimates | Selected directions | Tokens per selected direction |
| --- | ---: | ---: | ---: | ---: |
| Goal only | 2 | 2,910–2,948 | 1 | 2,910–2,948 |
| Atlas only | 3 | 8,311–10,514 | 5 | 1,662–2,103 |
| Atlas and lesson | 3 | 9,232–11,292 | 5 | 1,846–2,258 |
| Full discovery | 3 | 9,939–12,030 | 5 | 1,988–2,406 |

The three grounded variants retained distinct principal sources for every selected direction in this scripted run. That checks structural specificity and diversity. The scripted replies do not establish mathematical usefulness, live usage, or a quality gain from lesson maps or research history. The `--live` switch uses the configured research provider and emits directions and measured usage for the same staged inputs. For review, score usefulness by whether the next action makes a decision possible, specificity by preservation of exact mathematical conditions, and nonredundancy by distinct mechanisms or decisive tests. Compare actual tokens per direction that meets those criteria. Live provider evaluation and blind mathematical review remain open.

V1 uses local evidence and graph traversal. It has no exhaustive literature novelty check, cross-provider calibration, handwritten image interpretation, or automatic scheduled dispatch. The visible brief reflects what fits in bounded packets.
