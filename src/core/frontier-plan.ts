import {createHash} from "node:crypto";
import {
 FRONTIER_GOAL, frontierPacket, frontierSeeds, frontierTerms,
 type FrontierLedger, type FrontierOpportunity, type FrontierSource,
} from "./research-frontier.ts";

export const frontierDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const frontierIdeaId = (text: string) => frontierDigest(text.normalize("NFC").trim().replace(/\s+/gu, " ")).slice(0, 24);
export const frontierReferences = (o: FrontierOpportunity) => [...new Set([...o.idea.sources, ...o.assessment.sources])];

export function frontierRevision(sources: FrontierSource[], goal: string) {
 const revisions = Object.fromEntries([...sources].sort((a,b) => a.id.localeCompare(b.id)).map(s => [s.id, frontierDigest(s)]));
 return {revisions, fingerprint: frontierDigest([1, goal, revisions])};
}

export function planDiscovery(sources: FrontierSource[], goal: string, budget: number, prior?: FrontierLedger, matched: string[] = []): FrontierLedger {
 const {revisions, fingerprint} = frontierRevision(sources, goal);
 const changed = new Set(sources.filter(s => revisions[s.id] !== prior?.revisions[s.id]).map(s => s.id));
 const affected = new Set(changed);
 for (const s of sources) if ([...s.links, ...s.concepts, ...(s.requires ?? [])].some(id => changed.has(id))) affected.add(s.id);
 const present = (o: FrontierOpportunity) => frontierReferences(o).every(id => Boolean(revisions[id]));
 const assessed = (prior?.assessed ?? []).filter(o => present(o) && frontierReferences(o).every(id => !affected.has(id)))
  .sort((a,b) => Number(b.assessment.verdict === "pursue") - Number(a.assessment.verdict === "pursue")).slice(0, 24);
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
 const localPacket = frontierPacket(sources, local, 12_000, recheck.flatMap(frontierReferences));
 const explorationPacket = frontierPacket(sources, [...remote, ...local.filter(s => s.kind === "transfer")], 10_000);
 const packets = (prior && changed.size < 6 && prior.selected.length >= 3 ? [localPacket] : [localPacket, explorationPacket])
  .filter(p => p.evidence.length > 0);
 const nearby = frontierPacket(sources, [], 33_000, packets.flatMap(p => p.evidence.map(e => e.id)));
 const evidence = [...new Map([...packets.flatMap(p => p.evidence), ...nearby.evidence,
  ...(prior?.evidence ?? []).filter(e => assessed.some(o => frontierReferences(o).includes(e.id)))].map(e => [e.id,e])).values()];
 return {version: 1, fingerprint, revisions, goal, budget, packets, generated: 0, ranked: false,
  previous: prior?.selected ?? [], candidates: recheck.map(o => o.idea), assessed, selected: [], evidence};
}
