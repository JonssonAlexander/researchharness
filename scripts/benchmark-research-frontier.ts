import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createFauxCore, fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {runFrontier} from "../src/agent/subagents/research-frontier.ts";
import {piEngineForSpec} from "../src/agent/models.ts";
import {connectionBackgroundAllowed} from "../src/agent/subscription-connections.ts";
import type {GraphChain, GraphNode} from "../src/core/contracts/graph.ts";
import type {JobUsage} from "../src/core/contracts/jobs.ts";
import {ADAPTIVE_BUDGET, ADAPTIVE_DEFAULTS, FRONTIER_BUDGET, frontierTokens, frontierScore, selectFrontier, type FrontierHypothesis, type FrontierOpportunity, type FrontierSource} from "../src/core/research-frontier.ts";
import {frontierDigest, frontierIdeaId, planDiscovery, portfolioValue} from "../src/core/frontier-plan.ts";
import {resolveRoleSpec} from "../src/core/settings-resolution.ts";

function readArchive<T>(file: string): T[] {
 const content = readFileSync(new URL(`../tests/fixtures/golden-data/graph/${file}.jsonl`, import.meta.url), "utf8");
 return content.trim().split("\n").map(line => JSON.parse(line) as T);
}
function source(id: string, kind: FrontierSource["kind"], title: string, status: string, text: string, links: string[] = []): FrontierSource {
 return {id, kind, title, status, text, links, concepts: []};
}
const cases = [
 {name: "Binary skill tracking", goal: "Find which parameters a binary skill model can distinguish from short answer sequences.",
  claims: ["n_dc470a7b5ccb","n_10ecdf07c525","n_ed4b233efa54","n_aebfe8286387","n_73a1f3bd4b51","n_ec4c5891e369"],
  withheld: ["n_6b9fa401ba8b","n_1d292d239739"],
  start: "Binary hidden skill with slip, guess and a learning transition.",
  question: "Which answer patterns carry information about each of the hidden parameters?",
  prior: "One observed correct-answer rate mixes different latent paths. No claim about complete sequence laws was established."},
 {name: "Empirical risk", goal: "Find the conditions under which empirical risk guides model selection.",
  claims: ["n_1d056c762805","n_1b004ac09d5a","n_bb68655c4cbe","n_7da5ea0e02d9","n_ea18784387c0","n_f60e801322db"],
  withheld: ["n_898fc83fae59","n_60a148d93597"],
  start: "Training and evaluation distributions are initially the same, and empirical averages use independent observations.",
  question: "How does the argument for one fixed hypothesis change if the same data determines the hypothesis?",
  prior: "A fixed-hypothesis convergence argument did not control a data-selected member of the class."},
 {name: "Linear constraints", goal: "Find relationships between descriptions of finite-dimensional real subspaces.",
  claims: ["n_d33344f28684","n_5e286f9d4263","n_86ba50d0c79e","n_0e3e789ba2a9","n_e92884c6bead","n_fd758386afe2"],
  withheld: ["n_b07a2b1b3be4","n_149c99fa9b2c"],
  start: "A homogeneous linear condition defines a subspace over the reals.",
  question: "What extra structure helps compare a spanning-set description and a constraint description?",
  prior: "The forward closure argument alone gave no procedure for constructing constraints for a given span."},
];
const nodes = readArchive<GraphNode>("nodes");
const chains = readArchive<GraphChain>("chains");
const live = process.argv.includes("--live");
const contextOnly = process.argv.includes("--context");
async function configuredEngine() {
 const {stores} = await import("../src/server/stores.ts");
 const {providerKeyPresent} = await import("../src/server/keys.ts");
 const spec = resolveRoleSpec("researcher", stores.settingsStore.readSettings());
 if (!spec || !providerKeyPresent(spec.provider) || !connectionBackgroundAllowed(spec.provider))
  throw new Error("Live benchmark requires the configured research model, a connected provider and background permission.");
 return piEngineForSpec(spec);
}
const liveEngine = live ? await configuredEngine() : undefined;

function scriptedEngine(withheld: GraphNode[]) {
 const faux = createFauxCore({tokenSize: {min: 128, max: 128}});
 const reply: Parameters<typeof faux.setResponses>[0][number] = context => {
  const visible = JSON.stringify(context.messages);
  for (const n of withheld) assert(!visible.includes(n.id) && !visible.includes(n.statement));
  const last = context.messages.at(-1)!;
  assert(last.role === "user" && typeof last.content === "string");
  const input: {evidence: FrontierSource[]; candidates?: FrontierHypothesis[]; structuredCritique?: boolean; candidateLimit?: number;
   action?: {kind: string; anchors: string[]}} = JSON.parse(last.content);
  function ideaFor(pivot: FrontierSource) {
   return {title: `Test ${pivot.title}`, hypothesis: `Determine which extensions of ${pivot.title} survive a change in its stated assumptions.`,
    intuition: "Vary one assumption at a time and compare the mechanisms.", sources: [pivot.id]};
  }
  function assess(pivot: FrontierSource, structured?: boolean) {
   return {sources: [pivot.id], startingPoint: pivot.text, obstacles: "The supplied evidence leaves the extension open.",
    novelty: "The proposed extension is absent from this packet.", nextAction: `Isolate the first assumption used in ${pivot.title}.`,
    uncertainty: "The extension may require an additional hypothesis.", reason: "The fixture exposes a distinct premise to test.",
    usefulness: 3, support: pivot.id === "goal" ? 0 : 3, surprise: 1, verdict: "pursue",
    ...(structured ? {feedback: {mechanism: pivot.title, failureMechanism: "", unresolvedAssumptions: ["Scope of the premise"],
     alternativeMechanisms: ["Change the representation"], evidenceNeeded: ["Compare two boundary cases"]}} : {})};
  }
  let body: Parameters<typeof fauxToolCall>[1];
  if (input.action) {
   const pivot = input.evidence.find(s => s.id === input.action!.anchors[0])!;
   body = {review: null, outcome: "The fixture retests the same direction.", proposals: [{idea: ideaFor(pivot), assessment: assess(pivot, true)}]};
  } else if (input.candidates) {
   body = {assessments: input.candidates.map(idea => ({id: idea.id,
    ...assess(input.evidence.find(s => s.id === idea.sources[0])!, input.structuredCritique)}))};
  } else {
   body = {ideas: input.evidence.slice(0, input.candidateLimit ?? 9).map(ideaFor)};
  }
  return fauxAssistantMessage([fauxToolCall("submit_frontier", body, {id: "reply"})], {stopReason: "toolUse"});
 };
 faux.setResponses(Array.from({length: 60}, () => reply));
 return {model: faux.getModel(), streamFn: faux.streamSimple};
}

const results = [];
const blindBriefs = [];
const value = (selected: FrontierOpportunity[]) => selected.reduce((total, o) => total + frontierScore(o), 0);
const selectedFrom = (assessed: FrontierOpportunity[], ids: string[]) => ids.flatMap(id => assessed.filter(o => o.idea.id === id));
for (const c of cases) {
 const atlas = [...new Map(nodes.filter(n => c.claims.includes(n.id)).map(n => [n.id,
  source(n.id, "claim", n.name, "canonical proposition", n.statement)])).values()];
 for (const a of chains) {
  const requires = [a.conclusion, ...a.premises];
  if (!requires.every(id => c.claims.includes(id))) continue;
  const row = source(a.id, "argument", "Joint-premise argument", "recorded argument", JSON.stringify({premises: a.premises, conclusion: a.conclusion}));
  atlas.push({...row, requires});
 }
 const lesson = source("lesson", "derivation", "Working derivation", "working",
  JSON.stringify({start: c.start, question: c.question}), c.claims.slice(0, 2));
 const history = source("history", "finding", "Previously attempted approach", "unresolved research", c.prior, [lesson.id]);
 const later = nodes.filter(n => c.withheld.includes(n.id));
 assert.equal(new Set(later.map(n => n.id)).size, c.withheld.length);
 const variants: [string, FrontierSource[]][] = contextOnly ? [
  ["goal-only", [source("goal", "research", "Research goal", "question only", c.goal)]],
  ["Atlas-only", atlas],
  ["Atlas+lesson", [...atlas, lesson]],
  ["full discovery", [...atlas, lesson, history]],
 ] : ["single pass", "naive repeated", "adaptive"].map(variant => [variant, [...atlas, lesson, history]]);

 for (const [variant, sources] of variants) {
  assert(sources.every(s => !later.some(n => s.id === n.id || s.text.includes(n.statement))));
  const budget = contextOnly ? FRONTIER_BUDGET : ADAPTIVE_BUDGET;
  const adaptive = variant === "adaptive";
  let usage: JobUsage | undefined;
  let estimatedUnreported = 0;
  let afterInitial = 0;
  let elapsed = 0;
  let stop: string | undefined;
  const engine = liveEngine ?? scriptedEngine(later);
  const cumulative = new Map<string, FrontierOpportunity>();
  let selected: FrontierOpportunity[] = [];
  let candidates = 0;
  let duplicates = 0;
  for (let pass = 0; pass < (variant === "naive repeated" ? ADAPTIVE_DEFAULTS.maxIterations + 1 : 1); pass++) {
   const ledger = planDiscovery(sources, c.goal, budget, undefined, [],
    adaptive ? {settings: ADAPTIVE_DEFAULTS, preferences: {}} : undefined);
   const priorSteps = usage?.steps ?? 0;
   const result = await runFrontier({ledger, engine, usage, history: [], signal: AbortSignal.timeout(180_000), idFor: frontierIdeaId,
    budgeted: !contextOnly, estimatedUnreported, onEstimatedUnreported: tokens => {estimatedUnreported = tokens;},
    save: patch => {
     if (patch.usage) usage = patch.usage;
     if (adaptive && patch.frontier?.ranked && !patch.frontier.adaptive?.pending && !patch.frontier.adaptive?.rounds.length)
      afterInitial = portfolioValue(patch.frontier);
    }});
   if ((usage?.steps ?? 0) === priorSteps) {stop = "budget"; break;}
   elapsed++;
   const proposals = [...result.candidates, ...(result.adaptive?.rounds.flatMap(r => r.opportunities.map(o => o.idea)) ?? [])];
   candidates += proposals.length;
   duplicates += proposals.filter((idea, index) => cumulative.has(idea.id) || proposals.findIndex(c => c.id === idea.id) !== index).length;
   for (const opportunity of result.assessed) {
    const previous = cumulative.get(opportunity.idea.id);
    if (!previous || (previous.assessment.verdict !== "pursue" && opportunity.assessment.verdict === "pursue") ||
      (previous.assessment.verdict === opportunity.assessment.verdict && frontierScore(opportunity) > frontierScore(previous)))
     cumulative.set(opportunity.idea.id, opportunity);
   }
   const merged = [...cumulative.values()];
   selected = variant === "naive repeated" ? selectedFrom(merged, selectFrontier(merged)) : selectedFrom(result.assessed, result.selected);
   if (!adaptive && pass === 0) afterInitial = value(selected);
   if (adaptive) {elapsed += result.adaptive!.rounds.length; stop = result.adaptive!.stop;}
  }
  const n = selected.length, total = frontierTokens(usage);
  const worthwhile = selected.filter(o => o.assessment.usefulness >= 3 && o.assessment.support >= 2).length;
  const grounded = selected.filter(o => [...o.idea.sources, ...o.assessment.sources].some(id => id !== "goal")).length;
  const sample = frontierDigest([c.name, variant]).slice(0, 12);
  results.push({case: c.name, sample, variant, budget, calls: usage?.steps ?? 0, reportedTokens: total, estimatedUnreported, elapsed, stop, selected: n,
   distinctPrincipalSources: new Set(selected.map(o => o.idea.sources[0])).size, sourceAnchored: grounded,
   distinctMechanismLabels: new Set(selected.map(o => o.assessment.feedback?.mechanism).filter(Boolean)).size || undefined,
   candidateCount: candidates, duplicateIds: duplicates, portfolioProxyGain: value(selected) - afterInitial,
   modelRatedWorthwhile: worthwhile, tokensPerModelRatedWorthwhile: worthwhile ? Math.round(total / worthwhile) : null,
   tokensPerSelected: n ? Math.round(total / n) : null});
  if (live) blindBriefs.push({sample, goal: c.goal, directions: selected.map(({idea, assessment}) => ({
   title: idea.title, hypothesis: idea.hypothesis, intuition: idea.intuition, startingPoint: assessment.startingPoint,
   uncertainty: assessment.uncertainty, nextAction: assessment.nextAction, obstacles: assessment.obstacles,
   evidence: sources.filter(s => [...idea.sources, ...assessment.sources].includes(s.id)).map(s => ({title: s.title, text: s.text, status: s.status})),
  }))});
 }
}
console.log(JSON.stringify({mode: live ? "live, use blindBriefs for mathematical review" : "scripted, token estimates and structural proxies",
 results, ...(live ? {blindBriefs: blindBriefs.sort((a,b) => a.sample.localeCompare(b.sample))} : {})}, null, 2));
