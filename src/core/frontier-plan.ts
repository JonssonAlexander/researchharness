import {createHash} from "node:crypto";
import {
 FRONTIER_GOAL, frontierPacket, frontierSeeds, frontierTerms, frontierScore,
 type AdaptiveSettings, type FrontierAction, type FrontierPreference,
 type FrontierLedger, type FrontierOpportunity, type FrontierSource,
} from "./research-frontier.ts";

export const frontierDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const frontierIdeaId = (text: string) => frontierDigest(text.normalize("NFC").trim().replace(/\s+/gu, " ")).slice(0, 24);
export const frontierReferences = (o: FrontierOpportunity) => [...new Set([...o.idea.sources, ...o.assessment.sources])];

/** Prefer the principal source's Atlas links. Exact stored dependencies cover unbound derivations and arguments. */
export function frontierBoardAnchors(opportunity: FrontierOpportunity, evidence: ReadonlyMap<string, FrontierSource>): string[] {
 const anchors = new Set<string>();
 const visited = new Map<string, number>();
 function add(id: string, remaining: number) {
  if ((visited.get(id) ?? -1) >= remaining) return;
  visited.set(id, remaining);
  const source = evidence.get(id);
  if (!source) return;
  if (source.kind === "concept") anchors.add(source.id);
  for (const concept of source.concepts) anchors.add(concept);
  if (source.kind === "claim") anchors.add(source.id);
  if (!remaining) return;
  for (const dependency of source.requires ?? []) add(dependency, remaining - 1);
  if (source.kind === "derivation") {
   for (const linked of source.links) {
    if (evidence.get(linked)?.kind === "claim") add(linked, 0);
   }
  }
 }
 for (const id of frontierReferences(opportunity)) add(id, 2);
 return [...anchors].slice(0, 16);
}

export function frontierRevision(sources: FrontierSource[], goal: string) {
 const revisions = Object.fromEntries([...sources].sort((a,b) => a.id.localeCompare(b.id)).map(s => [s.id, frontierDigest(s)]));
 return {revisions, fingerprint: frontierDigest([1, goal, revisions])};
}

export function planDiscovery(sources: FrontierSource[], goal: string, budget: number, prior?: FrontierLedger, matched: string[] = [], adaptive?: {settings: AdaptiveSettings; preferences: Record<string, FrontierPreference>}): FrontierLedger {
 const {revisions, fingerprint} = frontierRevision(sources, goal);
 const changed = new Set(sources.filter(s => revisions[s.id] !== prior?.revisions[s.id]).map(s => s.id));
 const affected = new Set(changed);
 for (const s of sources) if ([...s.links, ...s.concepts, ...(s.requires ?? [])].some(id => changed.has(id))) affected.add(s.id);
 const present = (o: FrontierOpportunity) => frontierReferences(o).every(id => Boolean(revisions[id]));
 const assessed = (prior?.assessed ?? []).filter(o => present(o) && frontierReferences(o).every(id => !affected.has(id)))
  .sort((a,b) => Number(b.assessment.verdict === "pursue") - Number(a.assessment.verdict === "pursue") ||
   (adaptive ? frontierScore(b) - frontierScore(a) : 0)).slice(0, 24);
 const recheck = (prior?.assessed ?? []).filter(o => present(o) && frontierReferences(o).some(id => affected.has(id)))
  .sort((a,b) => Number(b.assessment.verdict === "pursue") - Number(a.assessment.verdict === "pursue")).slice(0, 5);
 const terms = goal === FRONTIER_GOAL ? [] : [...new Set(frontierTerms(goal).filter(s => s.length >= 4))];
 const byId = new Map(sources.map(s => [s.id, s]));
 const relevance = new Map(sources.map(s => {
  const text = new Set(frontierTerms(s.title + " " + s.text));
  return [s.id, terms.filter(t => text.has(t)).length];
 }));
 const retrieved = new Set(matched);
 const seeds = frontierSeeds(sources);
 const weight = {gap: 5, transfer: 4, unresolved: 3, generalization: 1};
 const weighted = seeds.map(s => ({s, score: weight[s.kind] +
  s.sources.reduce((n,id) => n + (relevance.get(id) ?? 0) * 2 + (retrieved.has(id) ? 4 : 0) + (prior && affected.has(id) ? 10 : 0), 0)}))
  .sort((a,b) => b.score - a.score);
 const byKind = new Map<string, number>();
 const local = weighted.filter(({s}) => {
  const count = byKind.get(s.kind) ?? 0;
  byKind.set(s.kind, count + 1);
  return count < 4;
 }).map(({s}) => s);
 // shortcut: v1 reserves one batch for outside neighborhoods using graph distance and seed order, upgrade if the archive shows weak coverage.
 const neighborhood = new Set(local.flatMap(s => s.sources.flatMap(id => [id, ...(byId.get(id)?.links ?? [])])));
 const remote = weighted.filter(({s}) => s.sources.every(id => !neighborhood.has(id))).slice(0, 8).map(({s}) => s);
 const unstructured = adaptive ? assessed.filter(o => !o.assessment.feedback).slice(0, 3) : [];
 const localPacket = frontierPacket(sources, local, 12_000, [...recheck, ...unstructured].flatMap(frontierReferences));
 const explorationPacket = frontierPacket(sources, [...remote, ...local.filter(s => s.kind === "transfer")], 10_000);
 const packets = (adaptive || (prior && changed.size < 6 && prior.selected.length >= 3) ? [localPacket] : [localPacket, explorationPacket])
  .filter(p => p.evidence.length > 0);
 const nearby = frontierPacket(sources, [], 33_000, packets.flatMap(p => p.evidence.map(e => e.id)));
 const evidence = [...new Map([...packets.flatMap(p => p.evidence), ...nearby.evidence,
  ...(prior?.evidence ?? []).filter(e => assessed.some(o => frontierReferences(o).includes(e.id)))].map(e => [e.id,e])).values()];
 // shortcut: freeze a bounded pool of neighborhoods for deterministic resume, revisit if large libraries need more coverage.
 const catalog = adaptive && frontierPacket(sources, weighted.slice(0, 80).map(({s}) => s), 125_000,
  [...evidence.map(e => e.id), ...remote.flatMap(s => s.sources)]).evidence;
 return {version: 1, fingerprint, revisions, goal, budget, packets, generated: 0, ranked: false,
  previous: prior?.selected ?? [], candidates: recheck.map(o => o.idea), assessed, selected: [], evidence,
  ...(adaptive && catalog ? {adaptive: {...adaptive, catalog, seeds: weighted.slice(0, 80).map(({s}) => s), rounds: [], estimatedUnreported: 0}} : {})};
}

export const ADAPTIVE_OUTPUT = 2700;
export const frontierCallEstimate = (input: unknown, output: number, overhead: number) =>
 Math.ceil(JSON.stringify(input).length / 2.5) + output + overhead;

export function adaptiveActionContext(ledger: FrontierLedger, action: Pick<FrontierAction, "kind" | "anchors" | "parents">) {
 const catalog = ledger.adaptive!.catalog;
 const packet = frontierPacket(catalog, [], 8500, action.anchors);
 const parents = action.parents.flatMap(id => ledger.assessed.filter(o => o.idea.id === id));
 const branches = ledger.assessed.filter(o => o.idea.parents?.some(id => action.parents.includes(id))).slice(-4);
 return {
  goal: ledger.goal, ...packet,
  ...(branches.length ? {existingBranches: branches.map(o => o.idea.hypothesis)} : {}),
  action: {kind: action.kind, anchors: action.anchors},
  parents: parents.map(({idea, assessment: a}) => ({
   id: idea.id, hypothesis: idea.hypothesis, verdict: a.verdict, sources: frontierReferences({idea, assessment: a}),
   objection: a.obstacles, nextAction: a.nextAction, feedback: a.feedback,
  })),
  attemptedMechanisms: ledger.adaptive!.rounds.flatMap(r => r.opportunities
   .filter(o => frontierReferences(o).some(id => action.anchors.includes(id)))
   .map(o => ({mechanism: o.assessment.feedback?.mechanism, verdict: o.assessment.verdict,
    objection: o.assessment.feedback?.failureMechanism || o.assessment.reason}))).slice(-4),
 };
}

export function adaptivePortfolio(ledger: FrontierLedger) {
 const seen = new Set<string>();
 const usable = ledger.assessed.filter(o => o.assessment.verdict === "pursue" && ledger.adaptive?.preferences[o.idea.id] !== "dismiss")
  .sort((a,b) => frontierScore(b) - frontierScore(a) || a.idea.id.localeCompare(b.idea.id)).filter(o => {
   const mechanism = o.assessment.feedback?.mechanism.normalize("NFC").trim().replace(/\s+/gu, " ");
   if (!mechanism) return true;
   const key = JSON.stringify([o.idea.sources[0], mechanism]);
   if (seen.has(key)) return false;
   seen.add(key);
   return true;
  });
 return usable.slice(0, 5).map(o => o.idea.id);
}

export function portfolioValue(ledger: FrontierLedger): number {
 const selected = new Set(adaptivePortfolio(ledger));
 return ledger.assessed.reduce((sum, o) => sum + (selected.has(o.idea.id) ? frontierScore(o) : 0), 0);
}

/** Rank available actions independently of the brief's mathematical ranking. */
export function chooseFrontierAction(ledger: FrontierLedger, spent: number,
 estimateCall: (context: ReturnType<typeof adaptiveActionContext>) => number = context => frontierCallEstimate(context, ADAPTIVE_OUTPUT, 3500)): FrontierAction | "budget" | "iterations" | "converged" | "no-action" {
 const {settings, catalog, seeds, rounds, preferences} = ledger.adaptive!;
 if (spent >= ledger.budget) return "budget";
 if (rounds.length >= settings.maxIterations) return "iterations";
 if (rounds.length >= settings.patience && rounds.slice(-settings.patience).every(r => r.gain < settings.minGain)) return "converged";
 const covered = new Set([...ledger.packets.flatMap(p => p.evidence.map(s => s.id)), ...rounds.flatMap(r => r.evidence)]);
 const byId = new Map(catalog.map(s => [s.id, s]));
 const neighbors = (id: string) => {
  const s = byId.get(id);
  return [id, ...(s?.links ?? []), ...(s?.concepts ?? []), ...(s?.requires ?? [])].filter(id => byId.has(id));
 };
 const attempted = new Set(rounds.map(r => r.action.key));
 const mechanisms = new Set(rounds.flatMap(r => r.opportunities.map(o => o.assessment.feedback?.mechanism.trim().toLowerCase()).filter(Boolean)));
 const options: FrontierAction[] = [];
 function offer(kind: FrontierAction["kind"], label: string, anchors: string[], parents: FrontierOpportunity[], value: number) {
  const parentIds = parents.map(o => o.idea.id).sort();
  const key = JSON.stringify([kind, parentIds.length ? parentIds : [...anchors].sort()]);
  if (attempted.has(key)) return;
  const action = {kind, label, anchors: [...new Set(anchors)], parents: parentIds, key};
  const context = adaptiveActionContext(ledger, action);
  if (!action.anchors.every(id => context.evidence.some(e => e.id === id))) return;
  const estimate = estimateCall(context);
  const priority = Math.round(value / (estimate / 1000) * 100) / 100;
  if (priority >= settings.minValue) options.push({...action, estimate, priority});
 }
 // Coverage is a surprise proxy: unexplored adjacent evidence can change what the current portfolio assumes.
 for (const seed of seeds.filter(s => s.sources.every(id => !covered.has(id))).slice(0, 20)) {
  const nearby = new Set(seed.sources.flatMap(neighbors));
  const known = [...nearby].filter(id => covered.has(id)).length;
  const value = 13 + Math.min(8, nearby.size - known) - Math.min(8, known) + (seed.kind === "gap" || seed.kind === "transfer" ? 5 : 0);
  offer("explore", byId.get(seed.sources[0]!)?.title ?? "Unexplored evidence", seed.sources, [], value);
 }
 const active = ledger.assessed.filter(o => preferences[o.idea.id] !== "dismiss" && preferences[o.idea.id] !== "revisit")
  .sort((a,b) => frontierScore(b) - frontierScore(a) || a.idea.id.localeCompare(b.idea.id));
 const promising = active.filter(o => o.assessment.verdict === "pursue").slice(0, 6);
 for (const o of [...promising, ...active.filter(o => o.assessment.verdict !== "pursue").slice(0, 4)]) {
  const a = o.assessment;
  const ids = frontierReferences(o);
  const newSources = new Set(ids.flatMap(neighbors).filter(id => !covered.has(id)));
  const feedback = a.feedback;
  const repeated = mechanisms.has(feedback?.mechanism.trim().toLowerCase()) ? 7 : 0;
  const owner = preferences[o.idea.id] === "interested" ? 8 : 0;
  const information = Math.min(8, newSources.size) + Math.min(6, 2 * ((feedback?.evidenceNeeded.length ?? 0) + (feedback?.unresolvedAssumptions.length ?? 0)));
  if (a.verdict !== "pursue") {
   if (feedback?.failureMechanism || a.obstacles)
    offer("reformulate", o.idea.title, ids, [o], 12 + a.usefulness * 2 + information + owner - repeated);
   continue;
  }
  if (feedback?.alternativeMechanisms.some(m => !mechanisms.has(m.trim().toLowerCase())))
   offer("exploit", o.idea.title, ids, [o], 12 + a.usefulness * 3 + owner + information - repeated);
  if (newSources.size || feedback?.evidenceNeeded.length)
   offer("deepen", o.idea.title, ids, [o], 10 + a.support * 2 + a.usefulness * 2 + owner + information - repeated);
  if (a.support < 4 && (feedback?.unresolvedAssumptions.length || a.support < 3))
   offer("challenge", o.idea.title, ids, [o], 9 + a.usefulness * 2 + (4 - a.support) * 3 + owner + information - repeated);
 }
 for (const [i, a] of promising.entries()) {
  const first = frontierReferences(a);
  const adjacent = new Set(first.flatMap(neighbors));
  for (const b of promising.slice(i + 1)) {
   if (!a.assessment.feedback || !b.assessment.feedback ||
       a.assessment.feedback.mechanism.toLowerCase() === b.assessment.feedback.mechanism.toLowerCase() ||
       (!frontierReferences(b).some(id => adjacent.has(id)) && !frontierReferences(b).flatMap(neighbors).some(id => first.includes(id)))) continue;
   offer("combine", a.idea.title + " / " + b.idea.title, [...first, ...frontierReferences(b)],
    [a, b], 12 + a.assessment.usefulness * 2 + b.assessment.usefulness * 2);
  }
 }
 const affordable = options.filter(o => spent + o.estimate <= ledger.budget)
  .sort((a,b) => b.priority - a.priority || a.key.localeCompare(b.key));
 if (!rounds.some(r => r.action.kind === "explore")) {
  const exploration = affordable.find(o => o.kind === "explore");
  if (exploration) return exploration;
 }
 return affordable[0] ?? (options.length ? "budget" : "no-action");
}
