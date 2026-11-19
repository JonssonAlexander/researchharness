# Research Atlas — Evidence-Aware Mathematical Learning

**Design proposal · 15 November 2026**

## 1. Objective and provenance

**North star:** Maximize *independently retained mathematical understanding and transfer per minute of active learning*, subject to correct mathematics and adequate coverage of the capabilities relevant to the learner's objective.

The existing repository already prioritizes independent, research-level mathematical capability rather than content volume or graph size ([`AGENTS.md`](../AGENTS.md)). Its [historical teaching theory](archive/teaching-methodology.md) argues for allocating effort to mathematical material rather than logistics, and for finding a minimal conceptual/derivational route from prior knowledge to the goal. However, **delayed understanding/transfer gain per active learning minute is a new, more explicit optimization objective developed in the discussion**, not a pre-existing implemented metric. This adds an outcome criterion to the original philosophy; it does not replace the need for mathematical judgment.

A useful idealized formulation is

\[
J(\pi)=\frac{\sum_{k\in G}w_k\left[\Pr_\pi(Z_k^\tau=1)-\Pr(Z_k^0=1)\right]}{T_{\mathrm{active}}(\pi)}.
\]

Here, \(G\) denotes the important target capabilities fixed by the learning objective; \(w_k\) their importance; \(Z_k^0\) prior independent capability; \(Z_k^\tau\) capability after a delay; \(T_{\mathrm{active}}\) active study time; and \(\pi\) the teaching policy. **This is a conceptual objective, not presently a calibrated estimator.**

Guardrails: do not improve the ratio by skipping difficult essential material, lowering mathematical standards, rewarding confidence without reconstruction, or optimizing solely for immediate recall. Monitor correctness, prerequisite coverage, source fidelity, assistance, and unfamiliar-problem transfer separately.

## 2. The learning problem

Distinguish three outcomes:

- **Exposure:** A fact, argument or theorem has been read or explained.
- **Understanding:** The learner can independently reconstruct why it follows and which assumptions/dependencies matter.
- **Capability:** The learner can use that reasoning in a related but unfamiliar situation.

A mathematically elegant explanation can create a strong feeling of fluency without independent ability. Conversely, demanding derivations at every step can waste time on inaccessible tricks, discourage orientation, and interrupt the coherent structure of a proof.

Therefore, the tutor's central decision is **not just how to phrase the next explanation, but which intellectual action has the highest expected value now**.

## 3. Lesson organization: three resolutions, not rigid phases

**Conceptual resolution.** Build a concise article-wide map around the central problem, important objects, assumptions, critical lemmas, principal conclusions and consequences. It is not a condensed table of contents. The map orients study and should stay accessible alongside the PDF, chat and Excalidraw.

**Development resolution.** Move fluently through connected explanations, equations and selected source passages. Prepare multiple connected explanatory steps when appropriate; do not require “OK,” “got it,” or “please continue” after every idea. The learner may interrupt freely to ask, annotate, draw, investigate a tangent or revisit the graph. Avoid autoplay that advances while the learner is actively working.

**Reconstruction resolution.** At mathematically significant points, require a genuine attempt to derive an identity, justify an implication, connect two results, identify a missing assumption, or transfer a technique. Make Start/Finish and permitted known facts clear; use the current scratchpad and attempt machinery. Offer targeted, progressively more informative hints if the attempt stalls. A reconstruction can span several graph nodes.

These resolutions interleave naturally. Do not postpone all independent thinking until the entire overview is complete, and do not enforce a prescribed number of questions per time or topic.

**Pacing law:** Remove administrative friction; preserve productive mathematical difficulty.

## 4. Teaching decision policy

The tutor chooses among: **explain, predict, reconstruct, connect, challenge, retrieve, continue**. This is an *action space*, not a mandatory sequence.

Selection considers:

1. **Importance:** How central is the result to the current objective and later mathematics?
2. **Reachability:** Can the learner plausibly derive it from demonstrated prerequisites?
3. **Evidence:** Was the prerequisite independently reconstructed, merely explained, or completed with help?
4. **Expected effort and opportunity cost:** Is further struggle constructive, or would a concise explanation remove an arbitrary obstacle?
5. **Diagnostic information:** Will an attempt reveal a meaningful misconception or missing connection?
6. **Context:** Is the learner currently requesting an explanation, attempting a proof, reading, or exploring a tangent?

Illustrative policies:

- High-importance + reachable + uncertain competence: propose independent reconstruction.
- High-importance + prerequisite gap: explain or supply a smaller worked example, then return to the original question.
- Apparent derivation with vulnerable assumption: ask for a counterexample or boundary case.
- Familiar material with demonstrated competence: continue, rather than re-teach.
- Revisited idea with no recent independent evidence: opportunistically request retrieval or transfer when it helps the current work.

The decision should be *evidence-aware* but not pretend to use a statistically calibrated learner model when there is little data. Start with transparent heuristics, then refine using actual outcomes.

## 5. Make graph relationships teachable

Keep the current conceptual graph and its visual interactions. Add a distinct layer of **learning targets** associated with important nodes and, especially, connections.

A learning target describes an observable mathematical capability, such as:

> Explain exactly where assumption A enters the proof of theorem B, and what fails if A is removed.

Or:

> Reconstruct the representation in lemma C from the definitions, identifying the transformation that makes it possible.

The underlying graph connection is *not automatically a logical implication*: it may be motivational, thematic, hierarchical or a genuine dependency. Do not conflate the visual map, formal propositions/arguments and student assessment evidence. Do not make one target per edge mechanically; select only the high-value ones and allow a target to span multiple concepts.

A minimal target record needs a stable identity, task/criterion, related concept IDs, relevant source or proof context, and importance. Evidence is recorded separately.

Just so you know: this should not be visable in the frontend, but for the agent to see.

## 6. Evidence from natural learning behavior

Use existing native transcripts, submitted Excalidraw attempts, lesson plans, challenge attempts, FSRS activity and source references. **Do not require a new formal exam or A/B test as a prerequisite for improvement.**

Normalize important observations into an append-only **learning-evidence ledger**. Each entry should link an objective/target, prompt or attempt, learner-produced response, assistance, evaluator finding, timestamp, source evidence and teaching-policy version. Include uncertainty and correction history; preserve immutable learner work.

Defensible interpretations:

| Observation | Possible conclusion |
|---|---|
| Correct derivation completed without hints | Evidence of independent current capability |
| Derivation completed after hints | Evidence of assisted capability; not independent mastery |
| Correct explanation of an assumption's role | Evidence for that mathematical dependency |
| Later unfamiliar application completed unassisted | Stronger evidence of retention and transfer |
| Repeated clarification requests | Potential difficulty requiring diagnosis, not proof of incompetence |
| Long page dwell or message gap | Timing only; does not establish thought, attention or understanding |

Never treat AI feedback as formal proof checking. Distinguish correctness, completeness, uncertainty and confidence. Unsaved handwriting is not visible to the model and must not be interpreted as submitted evidence.

**Delayed outcome limitation:** If a theorem is never independently used again, its retention cannot be measured from passive interaction alone. Seek *opportunistic* evidence during natural later lessons, research, proofs and existing review. That is ordinary mathematical work, not separate evaluation bureaucracy.

## 7. Time accounting

Instrument observable interaction with the PDF, chat, lesson map and scratchpad. Capture time spent awaiting the model and periods when the app is hidden or appears idle. Associate activity intervals with meaningful learning tasks when feasible.

Keep separate fields for observed app activity, model wait, idle/unknown and inferred active study time; do not equate elapsed time between messages with cognitive effort. The user may think away from the keyboard. Report uncertainty and prefer a conservative measurable proxy over a falsely precise denominator.

Minimize event volume and privacy exposure: aggregate ordinary pointer/scroll activity into bounded intervals, do not record raw keystrokes or pen trajectories merely for telemetry, and respect existing local storage and submission boundaries.

## 8. Versioned teaching-policy timeline

Maintain a durable chronology of changes to teaching behavior. Each substantive change should record:

- Stable policy version and prompt/configuration hash.
- Date, app revision, model and effective relevant settings.
- Description of the behavioral change and intended outcome.
- The sessions/actions actually affected by the version.

Stamp the effective version per meaningful teaching action, not only per session; a long-running lesson may span an update.

Analyze observable evidence before/after policy changes, with topic difficulty, prior familiarity, assistance and changing target coverage in view. Use qualitative reviews of transcript and scratchwork failure patterns alongside quantitative summaries.

**Inference boundary:** A timeline and observational data can show that performance patterns changed; they cannot alone attribute a precise causal gain to a policy update. Do not publish spurious “25% learning improvement” claims from raw before/after comparisons.

Do not turn `src/core/events.ts` (a transient SSE notification bus) into the durable evidence store. Follow existing store ownership and persistence rules.

## 9. Hard design objections and responses

**Why not challenge constantly?** Because difficulty has an opportunity cost. Select based on mathematical importance, reachability and the information an attempt would provide.

**Why not trust a beautiful conceptual map?** It is an orientation aid. Independent reconstruction and application provide stronger evidence that the relationships are usable.

**Does the tutor grade its own teaching?** In part, yes—therefore retain raw answers, explicit criteria, source references and uncertainty, allow independent review/correction, and do not treat AI verdicts as mathematical verification.

**Won't a learning-efficiency ratio incentivize skipping hard material?** Fix important target capabilities up front, and monitor correctness/coverage and transfer separately.

**Can a one-person history fit an optimal adaptive model?** Not reliably initially. Use transparent, revisable rules, accumulate evidence and avoid claims of a calibrated optimal policy.

**Why not use Challenge or Review instead?** Their responsibilities differ. Article lessons need selective proof and connection tasks embedded in their normal flow. Challenge handles long independent problems; FSRS handles scheduled retrieval.

**Is the change timeline equivalent to a controlled experiment?** No. It is sufficient for disciplined iteration and hypothesis generation, not definitive causal estimation.

## 10. Implementation boundaries and order

Implement a coherent **evidence-aware learning policy** using existing infrastructure; do not create a competing lesson/chat/graph/assessment platform.

1. **Reconcile learning contracts.** Update learning-specific policy to allow selective substantive reconstruction while explicitly prohibiting repetitive administrative quizzes; preserve existing practice and legacy teaching workflows.
2. **Represent learning targets.** Associate important target capabilities with lesson concepts and relationships, separately from mathematical truth and visual map edges. Make updates/versioning recoverable.
3. **Deliver fluid explanations and interruptions.** Use the current chat/PDF/map/scratchpad, supporting an uninterrupted chain of explanation and independent work at valuable checkpoints. No forced “next” acknowledgments.
4. **Capture evidence at existing seams.** Reuse submitted attempts, native messages, challenge outcomes and review history; add structured, append-only target-linked records and correction semantics. Do not infer a proof from source summaries or incomplete drawings.
5. **Capture approximate time and policy lineage.** Add bounded interaction intervals and immutable policy change history. Preserve the provenance of actions across model/app updates.
6. **Inspect outcomes and iterate.** Analyze actual lesson exports, user mathematical attempts, recurring failures, revisits, later transfer and time overhead. Refine specific teaching decisions based on observed patterns, documenting uncertainty.

### Acceptance criteria

- A source-grounded article lesson starts with a useful conceptual graph without turning it into a table of contents.
- The learner can read several connected explanations, freely ask questions, draw or branch, without acknowledgement gates.
- The tutor selectively requests high-value independent derivations and explanations of dependencies, using existing submission tools.
- The tutor can diagnose missing assumptions, repair mistakes and avoid repeatedly testing already demonstrated knowledge.
- Independent, assisted, unassessed and later-transfer evidence remain distinguishable and traceable to underlying attempts.
- Time and policy-version records are durable, inspectable and do not claim to observe cognition or establish causality.
- Existing legacy teaching, Practice, Challenge, FSRS, Atlas canonical integration and local privacy protections continue to function.

**Concluding principle:** Choose the next action that most improves *independently usable mathematical understanding* relative to the time it consumes. Use the graph to organize the intellectual route, the lesson to allocate productive effort, and ordinary activity to accumulate honest evidence for future improvements.

---

### Repository references

- [`AGENTS.md`](../AGENTS.md)
- [Historical teaching theory](archive/teaching-methodology.md)
- [`src/core/learning-session.ts`](../src/core/learning-session.ts)
- [`src/agent/teacher-agent.ts`](../src/agent/teacher-agent.ts)
- [Learning workspace](atlas-learning-workspace.md)
- [Spaced Review](atlas-spaced-review.md)
- [Challenges](atlas-challenges.md)
- [Scratchpad](atlas-scratchpad.md)
