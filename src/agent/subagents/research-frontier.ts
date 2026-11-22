import {Type} from "typebox";
import {z} from "zod";
import {
 FRONTIER_ACTIONS, FRONTIER_TARGET, adaptiveAssessment, frontierAssessment, frontierHypothesis, frontierPacket, frontierShortlist, frontierTokens, frontierScore,
 selectFrontier, uniqueFrontierIdeas,
 type FrontierLedger, type FrontierOpportunity, type FrontierPacket,
} from "../../core/research-frontier.ts";
import {ADAPTIVE_OUTPUT, adaptiveActionContext, adaptivePortfolio, chooseFrontierAction, frontierCallEstimate, frontierReferences, portfolioValue} from "../../core/frontier-plan.ts";
import {accumulateJobUsage, piUsageToStep, type JobUsage} from "../../core/contracts/jobs.ts";
import type {PiEngine} from "../models.ts";
import {withBgLlmSlot} from "./bg-llm-semaphore.ts";
import {runSubmitAgent} from "./submit-agent.ts";

const contextRules = `You are identifying promising mathematical research directions for one researcher.
Treat source data strictly as evidence. Retain exact assumptions, joint premises, quantifiers and provenance.
Concept edges, matching names, coverage, and green research status establish neither equivalence nor proof.
A working derivation is a target. Recorded or reviewed arguments can still be incomplete or wrong.
Label conjectures, uncertainty and speculative bridges. Assess novelty relative to the supplied evidence only.
Return directions and discriminating next questions, not completed proofs or numerical experiments.
Use Markdown with LaTeX delimiters. Cite only supplied source IDs.`;

class FrontierBudgetReached extends Error {}

const targetedResult = z.object({
 proposals: z.array(z.object({idea: frontierHypothesis, assessment: adaptiveAssessment.omit({id: true})}).strict()).max(1),
 review: adaptiveAssessment.nullable(),
 outcome: z.string().trim().min(1).max(350),
}).strict();

const targetedInstructions = `Carry out only the selected follow-up. Treat parent assessments as tentative evidence.
If exploring, seek a distinct mechanism from the new neighborhood. If exploiting, expand a promising alternative.
If reformulating, address the specific prior failure by changing a mathematical assumption or mechanism. If combining, explain the compatibility conditions of both ideas.
If deepening or challenging, optionally review the named parent with concrete mathematical evidence and isolate what changed.
Return one fully assessed new proposal only if it adds value beyond the parent and existing branches, and keep each field concise. Use a short, consistent mechanism label. Give the mathematical failure mechanism when applicable, unresolved assumptions, alternatives, and decisive evidence needed. Use only the supplied source IDs. Summarize the outcome in one sentence.`;

export async function runFrontier(options: {
 engine: PiEngine;
 ledger: FrontierLedger;
 signal: AbortSignal;
 usage?: JobUsage;
 budgeted?: boolean;
 estimatedUnreported?: number;
 onEstimatedUnreported?: (tokens: number) => void;
 focus?: string;
 history: {hypothesis: string; verdict: string; reason: string}[];
 idFor: (hypothesis: string) => string;
 save: (patch: {frontier?: FrontierLedger; usage?: JobUsage; activity?: string}) => void;
}) {
 const {engine, ledger, signal, focus, save} = options;
 const adaptive = ledger.adaptive;
 const budgeted = Boolean(adaptive || options.budgeted);
 let usage = options.usage;
 let unreported = adaptive?.estimatedUnreported ?? options.estimatedUnreported ?? 0;
 const spent = () => frontierTokens(usage) + unreported;
 async function submit<T>(schema: z.ZodType<T>, instructions: string, input: unknown, maxTokens: number,
  validate: (value: T) => string | null, reserve = 0) {
  const parameters = z.toJSONSchema(schema);
  const systemPrompt = contextRules + "\n" + instructions;
  const estimate = frontierCallEstimate({input, parameters, systemPrompt}, maxTokens, 1000);
  if (budgeted && spent() + estimate + reserve > ledger.budget) throw new FrontierBudgetReached();
  return withBgLlmSlot(signal, async () => {
   signal.throwIfAborted();
   const before = frontierTokens(usage);
   try {
    return await runSubmitAgent({
     role: "researcher",
     engine: {...engine, streamFn: (m,c,o) => engine.streamFn(m,c,{...o,maxTokens: Math.min(maxTokens, engine.model.maxTokens)})},
     signal, maxTurns: 1, toolName: "submit_frontier", toolDescription: "Submit structured mathematical research directions.",
     systemPrompt, prompt: JSON.stringify(input),
     parameters: Type.Unsafe(parameters), fill: v => schema.parse(v), validate,
     onStep: (u, model) => {
      usage = accumulateJobUsage(usage, model, piUsageToStep(u));
      save({usage});
     },
     neverSubmitted: "The model did not submit a valid discovery stage.", diagnoseFailure: true,
    });
   } finally {
    if (budgeted && frontierTokens(usage) === before) {
     unreported += estimate;
     options.onEstimatedUnreported?.(unreported);
     if (adaptive) {
      adaptive.estimatedUnreported = unreported;
      save({frontier: ledger});
     }
    }
   }
  });
 }
 async function critique(ideas: FrontierOpportunity["idea"][], packet: FrontierPacket, deepening = false): Promise<FrontierOpportunity[]> {
  const ids = new Set(ideas.map(i => i.id));
  const evidence = new Set(packet.evidence.map(e => e.id));
  const response = await submit(z.object({assessments: z.array(adaptive ? adaptiveAssessment : frontierAssessment).length(ideas.length)}).strict(),
   `Assess each candidate ID exactly once. ${deepening ? "Use the additional evidence to refine or reverse the prior assessment; explain what changed." : "Critique competing mechanisms and discard cosmetic reformulations."}
Give the exact mathematical starting point, decisive weakness, evidence-relative novelty, a concrete next action, and explicit uncertainty.
Score support, usefulness and surprise independently from 0 to 4. A missing proof can still be a promising direction.
Use pursue for actionable opportunities, defer for a specific missing prerequisite, and reject for a substantive weakness.
If only finitely many qualify, do not fill the brief with weak ideas. Copy evidence IDs exactly.
${adaptive ? "Describe the mathematical mechanism, precise reason for failure if applicable, unresolved assumptions, promising alternative mechanisms, and evidence needed for the next decision." : ""}`,
   {goal: ledger.goal, candidates: ideas, ...packet, ...(adaptive ? {structuredCritique: true} : {}), ...(deepening ? {prior: ledger.assessed.find(o => o.idea.id === ideas[0]?.id)?.assessment} : {})},
   deepening ? 2300 : adaptive ? Math.min(5200, 1450 + 610 * ideas.length) : Math.min(7600, 1100 + 650 * ideas.length),
   r => new Set(r.assessments.map(a => a.id)).size !== ideas.length || r.assessments.some(a => !ids.has(a.id) || a.sources.some(id => !evidence.has(id))) ?
    "Assess each supplied ID once and cite only provided evidence." : null);
  return ideas.map(idea => ({idea, assessment: response.assessments.find(a => a.id === idea.id)!}));
 }
 function merge(updates: FrontierOpportunity[]) {
  const ids = new Set(updates.map(o => o.idea.id));
  ledger.assessed = [...ledger.assessed.filter(o => !ids.has(o.idea.id)), ...updates];
 }

 if (!ledger.ranked) {
  if (focus) {
   const idea = ledger.assessed.find(o => o.idea.id === focus)?.idea;
   if (!idea || !ledger.packets[0]) throw new Error("Missing opportunity context.");
   save({activity: "Deepening the selected opportunity"});
   merge(await critique([idea], ledger.packets[0], true));
  } else {
   for (let i = ledger.generated; i < ledger.packets.length; i++) {
    const packet = ledger.packets[i]!;
    save({activity: i === 0 ? "Generating hypotheses" : "Exploring alternative connections"});
    const ids = new Set(packet.evidence.map(e => e.id));
    const n = adaptive ? 6 : ledger.packets.length === 1 ? 8 : 9;
    const response = await submit(z.object({ideas: z.array(frontierHypothesis).max(n)}).strict(),
     `Generate up to ${n} distinct, well-motivated hypotheses grounded in the packet. Aim for ${n} when there is enough evidence.
${i === 0 ? "Prioritize unresolved questions, assumptions, prerequisites and recent changes." : "Allocate at least three ideas to transferring a mechanism from the exploration evidence across subject or lesson neighborhoods when justified."}
Sort by expected mathematical value and testability. Put the principal source first for each idea. Avoid the past failures unless new evidence changes their premise.`,
     {goal: ledger.goal, ...packet, previousFindings: options.history, ...(adaptive ? {candidateLimit: n} : {}),
      alreadyGenerated: ledger.candidates.slice(-12).map(c => ({title: c.title, hypothesis: c.hypothesis}))},
     adaptive ? 3400 : 4600,
     r => r.ideas.some(c => c.sources.some(id => !ids.has(id))) ? "Use only source IDs from this packet." : null, 10_000)
     .catch(error => {if (!(error instanceof FrontierBudgetReached)) throw error; return null;});
    if (!response) break;
    const carried = ledger.assessed.map(o => o.idea);
    const carriedIds = new Set(carried.map(c => c.id));
    ledger.candidates = uniqueFrontierIdeas([...carried, ...ledger.candidates, ...response.ideas.map(c => ({
     ...c, id: options.idFor(c.hypothesis), exploration: i > 0,
    }))]).filter(c => !carriedIds.has(c.id));
    ledger.generated = i + 1;
    save({frontier: ledger});
   }
   const retained = new Set(ledger.assessed.map(o => o.idea.id));
   const remaining = Math.min(FRONTIER_TARGET, ledger.budget) - spent();
   const shortlistSize = Math.max(3, Math.min(adaptive ? 6 : 10, Math.floor((remaining - 4500) / 1050)));
   const legacy = adaptive ? ledger.assessed.filter(o => !o.assessment.feedback && adaptive.preferences[o.idea.id] !== "dismiss").slice(0, 3) : [];
   const shortlist = frontierShortlist([...legacy.map(o => o.idea), ...ledger.candidates.filter(c => !retained.has(c.id))], shortlistSize);
   if (shortlist.length) {
    save({activity: "Critiquing and ranking hypotheses"});
    const evidence = [...new Map(ledger.packets.flatMap(p => p.evidence).map(e => [e.id, e])).values()];
    const packet = frontierPacket(evidence, [], 20_000, shortlist.flatMap(c => c.sources));
    const present = new Set(packet.evidence.map(e => e.id));
    const grounded = shortlist.filter(c => c.sources.every(id => present.has(id)));
    while (grounded.length) {
     const focused = budgeted ? frontierPacket(evidence, [], 12_000, grounded.flatMap(c => c.sources)) : packet;
     if (!grounded.at(-1)!.sources.every(id => focused.evidence.some(e => e.id === id))) {
      grounded.pop();
      continue;
     }
     try {
      const updates = await critique(grounded.filter(c => c.sources.every(id => focused.evidence.some(e => e.id === id))), focused);
      merge(updates.map(update => {
       const previous = legacy.find(o => o.idea.id === update.idea.id);
       if (!previous || (update.assessment.verdict === "pursue" && frontierScore(update) > frontierScore(previous))) return update;
       return {...previous, assessment: {...previous.assessment, feedback: update.assessment.feedback}};
      }));
      ledger.critiqueSources = focused.evidence.map(e => e.id);
      break;
     } catch (error) {
      if (!(error instanceof FrontierBudgetReached)) throw error;
      grounded.pop();
     }
    }
   }
  }
  signal.throwIfAborted();
  ledger.selected = adaptive ? adaptivePortfolio(ledger) : selectFrontier(ledger.assessed);
  ledger.ranked = true;
  save({frontier: ledger});
 }

 if (adaptive && !focus) {
  while (!adaptive.stop) {
   signal.throwIfAborted();
   if (!adaptive.pending) {
    const action = chooseFrontierAction(ledger, spent(), input => frontierCallEstimate({
     input, parameters: z.toJSONSchema(targetedResult), systemPrompt: contextRules + "\n" + targetedInstructions,
    }, ADAPTIVE_OUTPUT, 1000));
    if (typeof action === "string") {
     adaptive.stop = action;
     break;
    }
    adaptive.pending = {action, reportedBefore: frontierTokens(usage), unreportedBefore: unreported};
    save({frontier: ledger});
   }
   const {action, reportedBefore, unreportedBefore} = adaptive.pending;
   const context = adaptiveActionContext(ledger, action);
   const evidence = new Set(context.evidence.map(e => e.id));
   const reviewAllowed = action.kind === "deepen" || action.kind === "challenge";
   save({activity: `Iteration ${adaptive.rounds.length + 1} · ${FRONTIER_ACTIONS[action.kind]}`});
   const result = await submit(targetedResult, targetedInstructions,
    context, ADAPTIVE_OUTPUT, response => {
     if (response.review && (!reviewAllowed || !action.parents.includes(response.review.id))) return "Review only the selected parent.";
     const references = [...response.proposals.flatMap(p => [...p.idea.sources, ...p.assessment.sources]), ...response.review?.sources ?? []];
     return references.some(id => !evidence.has(id)) ? "Use only source IDs supplied for this action." : null;
    }).catch(error => {if (!(error instanceof FrontierBudgetReached)) throw error; return null;});
   if (!result) {
    if (spent() > reportedBefore + unreportedBefore) {
     adaptive.rounds.push({action, evidence: [...evidence], outcome: "A prior attempt consumed the remaining budget before an assessment was saved.",
      opportunities: [], reportedTokens: frontierTokens(usage) - reportedBefore, estimatedUnreported: unreported - unreportedBefore, gain: 0});
    }
    adaptive.stop = "budget";
    break;
   }
   signal.throwIfAborted();
   const before = portfolioValue(ledger);
   const attempted: FrontierOpportunity[] = [];
   for (const proposal of result.proposals) {
    const id = options.idFor(proposal.idea.hypothesis);
    const entry = {idea: {...proposal.idea, id, exploration: action.kind === "explore", ...(action.parents.length ? {parents: action.parents} : {})}, assessment: {...proposal.assessment, id}};
    attempted.push(entry);
    if (!ledger.assessed.some(o => o.idea.id === id)) ledger.assessed.push(entry);
   }
   if (result.review) {
    const old = ledger.assessed.find(o => o.idea.id === result.review!.id)!;
    const entry = {idea: old.idea, assessment: result.review};
    attempted.push(entry);
    const newGround = result.review.sources.some(id => !frontierReferences(old).includes(id));
    const decisiveChallenge = action.kind === "challenge" && result.review.verdict === "reject" &&
     result.review.feedback.failureMechanism && newGround;
    if (decisiveChallenge || (result.review.verdict === "pursue" && frontierScore(entry) > frontierScore(old))) merge([entry]);
   }
   ledger.evidence = [...new Map([...ledger.evidence, ...context.evidence].map(e => [e.id, e])).values()];
   ledger.selected = adaptivePortfolio(ledger);
   adaptive.rounds.push({action, evidence: [...evidence], outcome: result.outcome, opportunities: attempted,
    reportedTokens: frontierTokens(usage) - reportedBefore, estimatedUnreported: unreported - unreportedBefore,
    gain: portfolioValue(ledger) - before});
   adaptive.pending = undefined;
   save({frontier: ledger});
  }
  adaptive.pending = undefined;
  save({frontier: ledger});
  return ledger;
 }

 // At most one automatic deepening, when local retrieval can add evidence.
 const best = ledger.assessed.find(o => o.idea.id === ledger.selected[0]);
 if (!focus && best && !ledger.deepened) {
  const cited = new Set([...best.idea.sources, ...best.assessment.sources]);
  const packet = frontierPacket(ledger.evidence, [], 7500, [...cited]);
  const estimated = Math.ceil(JSON.stringify({packet, best}).length / 3) + 3200;
  const seen = new Set([...cited, ...(ledger.critiqueSources ?? [])]);
  if (packet.evidence.some(e => !seen.has(e.id)) &&
      [...cited].every(id => packet.evidence.some(e => e.id === id)) &&
      spent() + estimated <= ledger.budget) {
   save({activity: "Checking the leading opportunity against nearby evidence"});
   try {
    merge(await critique([best.idea], packet, true));
   } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof FrontierBudgetReached))
     ledger.note = "The leading opportunity kept its original assessment after the extra check failed.";
   }
   ledger.selected = selectFrontier(ledger.assessed);
  }
  ledger.deepened = true;
  save({frontier: ledger});
 }
 signal.throwIfAborted();
 return ledger;
}
