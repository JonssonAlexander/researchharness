import {Type} from "typebox";
import {z} from "zod";
import {
 FRONTIER_TARGET, frontierAssessment, frontierHypothesis, frontierPacket, frontierShortlist, frontierTokens,
 selectFrontier, uniqueFrontierIdeas,
 type FrontierLedger, type FrontierOpportunity, type FrontierPacket,
} from "../../core/research-frontier.ts";
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

export async function runFrontier(options: {
 engine: PiEngine;
 ledger: FrontierLedger;
 signal: AbortSignal;
 usage?: JobUsage;
 focus?: string;
 history: {hypothesis: string; verdict: string; reason: string}[];
 idFor: (hypothesis: string) => string;
 save: (patch: {frontier?: FrontierLedger; usage?: JobUsage; activity?: string}) => void;
}) {
 const {engine, ledger, signal, focus, save} = options;
 let usage = options.usage;
 function submit<T>(schema: z.ZodType<T>, instructions: string, input: unknown, maxTokens: number, validate: (value: T) => string | null) {
  return withBgLlmSlot(signal, () => {
   signal.throwIfAborted();
   return runSubmitAgent({
    role: "researcher",
    engine: {...engine, streamFn: (m,c,o) => engine.streamFn(m,c,{...o,maxTokens: Math.min(maxTokens, engine.model.maxTokens)})},
    signal, maxTurns: 1, toolName: "submit_frontier", toolDescription: "Submit structured mathematical research directions.",
    systemPrompt: contextRules + "\n" + instructions, prompt: JSON.stringify(input),
    parameters: Type.Unsafe(z.toJSONSchema(schema)), fill: v => schema.parse(v), validate,
    onStep: (u, model) => {
     usage = accumulateJobUsage(usage, model, piUsageToStep(u));
     save({usage});
    },
    neverSubmitted: "The model did not submit a valid discovery stage.", diagnoseFailure: true,
   });
  });
 }
 async function critique(ideas: FrontierOpportunity["idea"][], packet: FrontierPacket, deepening = false) {
  const ids = new Set(ideas.map(i => i.id));
  const evidence = new Set(packet.evidence.map(e => e.id));
  const response = await submit(z.object({assessments: z.array(frontierAssessment).length(ideas.length)}).strict(),
   `Assess each candidate ID exactly once. ${deepening ? "Use the additional evidence to refine or reverse the prior assessment; explain what changed." : "Critique competing mechanisms and discard cosmetic reformulations."}
Give the exact mathematical starting point, decisive weakness, evidence-relative novelty, a concrete next action, and explicit uncertainty.
Score support, usefulness and surprise independently from 0 to 4. A missing proof can still be a promising direction.
Use pursue for actionable opportunities, defer for a specific missing prerequisite, and reject for a substantive weakness.
If only finitely many qualify, do not fill the brief with weak ideas. Copy evidence IDs exactly.`,
   {goal: ledger.goal, candidates: ideas, ...packet, ...(deepening ? {prior: ledger.assessed.find(o => o.idea.id === ideas[0]?.id)?.assessment} : {})},
   deepening ? 2300 : Math.min(7600, 1100 + 650 * ideas.length),
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
    const n = ledger.packets.length === 1 ? 8 : 9;
    const response = await submit(z.object({ideas: z.array(frontierHypothesis).max(n)}).strict(),
     `Generate up to ${n} distinct, well-motivated hypotheses grounded in the packet. Aim for ${n} when there is enough evidence.
${i === 0 ? "Prioritize unresolved questions, assumptions, prerequisites and recent changes." : "Allocate at least three ideas to transferring a mechanism from the exploration evidence across subject or lesson neighborhoods when justified."}
Sort by expected mathematical value and testability. Put the principal source first for each idea. Avoid the past failures unless new evidence changes their premise.`,
     {goal: ledger.goal, ...packet, previousFindings: options.history,
      alreadyGenerated: ledger.candidates.slice(-12).map(c => ({title: c.title, hypothesis: c.hypothesis}))},
     4600,
     r => r.ideas.some(c => c.sources.some(id => !ids.has(id))) ? "Use only source IDs from this packet." : null);
    const carried = ledger.assessed.map(o => o.idea);
    const carriedIds = new Set(carried.map(c => c.id));
    ledger.candidates = uniqueFrontierIdeas([...carried, ...ledger.candidates, ...response.ideas.map(c => ({
     ...c, id: options.idFor(c.hypothesis), exploration: i > 0,
    }))]).filter(c => !carriedIds.has(c.id));
    ledger.generated = i + 1;
    save({frontier: ledger});
   }
   const retained = new Set(ledger.assessed.map(o => o.idea.id));
   const remaining = Math.min(FRONTIER_TARGET, ledger.budget) - frontierTokens(usage);
   const shortlistSize = Math.max(3, Math.min(10, Math.floor((remaining - 4500) / 1050)));
   const shortlist = frontierShortlist(ledger.candidates.filter(c => !retained.has(c.id)), shortlistSize);
   if (shortlist.length) {
    save({activity: "Critiquing and ranking hypotheses"});
    const evidence = [...new Map(ledger.packets.flatMap(p => p.evidence).map(e => [e.id, e])).values()];
    const packet = frontierPacket(evidence, [], 20_000, shortlist.flatMap(c => c.sources));
    const present = new Set(packet.evidence.map(e => e.id));
    const grounded = shortlist.filter(c => c.sources.every(id => present.has(id)));
    if (grounded.length) {
     merge(await critique(grounded, packet));
     ledger.critiqueSources = [...present];
    }
   }
  }
  signal.throwIfAborted();
  ledger.selected = selectFrontier(ledger.assessed);
  ledger.ranked = true;
  save({frontier: ledger});
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
      frontierTokens(usage) + estimated <= ledger.budget) {
   save({activity: "Checking the leading opportunity against nearby evidence"});
   try {
    merge(await critique([best.idea], packet, true));
   } catch {
    signal.throwIfAborted();
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
