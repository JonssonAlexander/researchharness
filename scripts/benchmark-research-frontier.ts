import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createFauxCore, fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {runFrontier} from "../src/agent/subagents/research-frontier.ts";
import {piEngineForSpec} from "../src/agent/models.ts";
import {connectionBackgroundAllowed} from "../src/agent/subscription-connections.ts";
import type {GraphChain, GraphNode} from "../src/core/contracts/graph.ts";
import type {JobUsage} from "../src/core/contracts/jobs.ts";
import {FRONTIER_BUDGET, frontierTokens, type FrontierHypothesis, type FrontierSource} from "../src/core/research-frontier.ts";
import {frontierIdeaId, planDiscovery} from "../src/core/frontier-plan.ts";
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
  const input: {evidence: FrontierSource[]; candidates?: FrontierHypothesis[]} = JSON.parse(last.content);
  const body: Parameters<typeof fauxToolCall>[1] = input.candidates ? {assessments: input.candidates.map(idea => {
   const pivot = input.evidence.find(s => s.id === idea.sources[0])!;
   return {id: idea.id, sources: [pivot.id], startingPoint: pivot.text, obstacles: "The supplied evidence leaves the extension open.",
    novelty: "The proposed extension is absent from this packet.", nextAction: `Isolate the first assumption used in ${pivot.title}.`,
    uncertainty: "The extension may require an additional hypothesis.", reason: "The fixture exposes a distinct premise to test.",
    usefulness: 3, support: pivot.id === "goal" ? 0 : 3, surprise: 1, verdict: "pursue"};
  })} : {ideas: input.evidence.slice(0, 9).map(pivot => ({
   title: `Test ${pivot.title}`, hypothesis: `Determine which extensions of ${pivot.title} survive a change in its stated assumptions.`,
   intuition: "Vary one assumption at a time and compare the mechanisms.", sources: [pivot.id],
  }))};
  return fauxAssistantMessage([fauxToolCall("submit_frontier", body, {id: "reply"})], {stopReason: "toolUse"});
 };
 faux.setResponses([reply, reply, reply, reply]);
 return {model: faux.getModel(), streamFn: faux.streamSimple};
}

const results = [];
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
 const variants: [string, FrontierSource[]][] = [
  ["goal-only", [source("goal", "research", "Research goal", "question only", c.goal)]],
  ["Atlas-only", atlas],
  ["Atlas+lesson", [...atlas, lesson]],
  ["full discovery", [...atlas, lesson, history]],
 ];
 for (const [variant, sources] of variants) {
  assert(sources.every(s => !later.some(n => s.id === n.id || s.text.includes(n.statement))));
  const ledger = planDiscovery(sources, c.goal, FRONTIER_BUDGET);
  let usage: JobUsage | undefined;
  const result = await runFrontier({ledger, engine: liveEngine ?? scriptedEngine(later), history: [],
   signal: AbortSignal.timeout(180_000), idFor: frontierIdeaId, save: patch => {if (patch.usage) usage = patch.usage;}});
  const selected = result.selected.map(id => result.assessed.find(o => o.idea.id === id)!);
  const n = selected.length, total = frontierTokens(usage);
  const concrete = selected.filter(o => [...o.idea.sources, ...o.assessment.sources].some(id => id !== "goal")).length;
  results.push({case: c.name, variant, calls: usage?.steps ?? 0, totalTokens: total, selected: n,
   distinctPrincipalSources: new Set(selected.map(o => o.idea.sources[0])).size, sourceAnchored: concrete,
   tokensPerSelected: n ? Math.round(total / n) : null, ...(live ? {directions: selected} : {})});
 }
}
console.log(JSON.stringify({mode: live ? "live, research quality requires blind review" : "scripted ablation, token estimates and structural proxies", results}, null, 2));
