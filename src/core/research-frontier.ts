import {z} from "zod";
import type {JobUsage} from "./contracts/jobs.ts";

export const FRONTIER_SCOPE = "atlas-research-frontier";
export const FRONTIER_TARGET = 27_000;
export const FRONTIER_BUDGET = 35_000;
export const FRONTIER_GOAL = "Find promising new mathematical directions in my existing work.";

export type FrontierSource = {
 id: string;
 kind: "concept" | "relation" | "claim" | "argument" | "lesson-topic" | "lesson-note" | "derivation" | "research" | "finding";
 title: string;
 text: string;
 status: string;
 links: string[];
 concepts: string[];
 requires?: string[];
 chatId?: string;
 url?: string;
 trailId?: string;
 revision?: string;
};

const prose = (max: number) => z.string().trim().min(1).max(max);
const sourceIds = z.array(prose(250)).min(1).max(6);
export const frontierHypothesis = z.object({
 title: prose(160), hypothesis: prose(650), intuition: prose(700), sources: sourceIds,
}).strict();
export const frontierAssessment = z.object({
 id: prose(64), sources: sourceIds,
 startingPoint: prose(1100), obstacles: prose(850), novelty: prose(650),
 nextAction: prose(650), uncertainty: prose(650), reason: prose(500),
 support: z.number().int().min(0).max(4), usefulness: z.number().int().min(0).max(4),
 surprise: z.number().int().min(0).max(4),
 verdict: z.enum(["pursue", "defer", "reject"]),
}).strict();
export type FrontierHypothesis = z.infer<typeof frontierHypothesis> & {id: string; exploration: boolean};
export type FrontierAssessment = z.infer<typeof frontierAssessment>;
export type FrontierOpportunity = {idea: FrontierHypothesis; assessment: FrontierAssessment};
export type FrontierSeed = {kind: "gap" | "transfer" | "generalization" | "unresolved"; sources: string[]};
export type FrontierPacket = {seeds: FrontierSeed[]; evidence: FrontierSource[]; omitted: number};
export type FrontierLedger = {
 version: 1;
 fingerprint: string;
 revisions: Record<string, string>;
 goal: string;
 budget: number;
 packets: FrontierPacket[];
 generated: number;
 ranked: boolean;
 deepened?: boolean;
 critiqueSources?: string[];
 note?: string;
 previous: string[];
 candidates: FrontierHypothesis[];
 assessed: FrontierOpportunity[];
 selected: string[];
 evidence: FrontierSource[];
};
export type FrontierBrief = Pick<FrontierLedger, "goal" | "budget" | "selected"> & {
 id: string;
 date: string;
 note?: string;
 opportunities: FrontierOpportunity[];
 sourceTitles: Record<string, string>;
 previous: string[];
 stale?: boolean;
 usage?: JobUsage;
};
export type FrontierState = {
 brief: FrontierBrief | null;
 job: {id: string; activity: string; status: "running" | "done" | "error"; interrupted: boolean; error?: string; usage?: JobUsage} | null;
 model: string | null;
};

export const frontierJobId = z.string().regex(/^job_[a-z0-9]+_[a-f0-9]{8}$/);
const opportunityId = z.string().regex(/^[a-f0-9]{24}$/);
export const frontierCommand = z.discriminatedUnion("action", [
 z.object({action: z.enum(["start", "refresh"]), goal: prose(1000), budget: z.number().int().min(FRONTIER_TARGET).max(100_000)}).strict(),
 z.object({action: z.enum(["cancel", "resume"]), id: frontierJobId}).strict(),
 z.object({action: z.literal("deepen"), id: frontierJobId, opportunityId}).strict(),
 z.object({action: z.literal("promote"), id: frontierJobId, opportunityId, trailId: z.string().regex(/^rt_[a-f0-9-]{36}$/)}).strict(),
]);

export function frontierTerms(text: string): string[] {
 return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Deterministic adjacency, including explicit bridges between lesson sessions. */
export function frontierSeeds(sources: FrontierSource[]): FrontierSeed[] {
 const result: FrontierSeed[] = [];
 const byConcept = new Map<string, FrontierSource[]>();
 for (const source of sources) {
  if (source.kind !== "lesson-topic") continue;
  for (const id of source.concepts) {
   const group = byConcept.get(id) ?? [];
   group.push(source);
   byConcept.set(id, group);
  }
 }
 for (const group of byConcept.values()) {
  const first = group[0]!;
  const other = group.find(s => s.chatId !== first.chatId);
  if (other) result.push({kind: "transfer", sources: [first.id, other.id]});
 }
 for (const s of sources) {
  if ((s.kind === "derivation" || s.kind === "lesson-topic" || s.kind === "argument") && /gap|working|revisit/.test(s.status)
   || s.kind === "relation" && s.status.startsWith("prerequisite /") && !s.status.includes("/ accepted")) {
   result.push({kind: "gap", sources: [s.id]});
  } else if (s.kind === "research" || s.kind === "finding") {
   result.push({kind: "unresolved", sources: [s.id]});
  } else if (s.kind === "relation" && !/retracted/.test(s.status)) {
   result.push({kind: "transfer", sources: [s.id]});
  } else if (s.kind === "concept" || s.kind === "argument" || s.kind === "claim" || s.kind === "derivation" || s.kind === "lesson-topic") {
   result.push({kind: "generalization", sources: [s.id]});
  }
 }
 return result;
}

/** Add complete source records and their mathematical dependencies as a unit. */
export function frontierPacket(sources: FrontierSource[], seeds: FrontierSeed[], chars: number, focus: string[] = []): FrontierPacket {
 const byId = new Map(sources.map(s => [s.id, s]));
 const kept = new Map<string, FrontierSource>();
 function add(ids: string[]) {
  const group = new Map<string, FrontierSource>();
  const queue = [...ids];
  for (const id of queue) {
   if (kept.has(id) || group.has(id)) continue;
   const s = byId.get(id);
   if (!s) return false;
   group.set(id, s);
   queue.push(...(s.requires ?? []));
  }
  const size = JSON.stringify([...group.values()]).length;
  if (chars < size) return false;
  chars -= size;
  for (const [id, s] of group) kept.set(id, s);
  return true;
 }
 focus.forEach(id => add([id]));
 const accepted = seeds.filter(seed => add(seed.sources));
 for (const s of [...kept.values()]) {
  for (const id of [...s.links, ...s.concepts]) add([id]);
 }
 return {seeds: accepted, evidence: [...kept.values()], omitted: sources.length - kept.size};
}

export function uniqueFrontierIdeas(ideas: FrontierHypothesis[]): FrontierHypothesis[] {
 const seen = new Set<string>();
 return ideas.filter(idea => {
  if (seen.has(idea.id)) return false;
  seen.add(idea.id);
  return true;
 });
}

export function frontierShortlist(candidates: FrontierHypothesis[], limit: number) {
 const ordered = [...candidates];
 const seen = new Set<string>();
 const balanced = ordered.filter(c => {
  const key = c.sources[0];
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
 });
 return [...new Set([...balanced, ...ordered])].slice(0, limit);
}

export function selectFrontier(assessed: FrontierOpportunity[]): string[] {
 const score = ({assessment: a}: FrontierOpportunity) => a.usefulness * 4 + a.support * 3 + a.surprise;
 const ranked = assessed.filter(o => o.assessment.verdict === "pursue").sort((a,b) => score(b) - score(a) || a.idea.id.localeCompare(b.idea.id));
 const selected: FrontierOpportunity[] = [];
 const heads = new Set<string>();
 for (const opportunity of ranked) {
  const head = opportunity.idea.sources[0]!;
  if (heads.has(head)) continue;
  selected.push(opportunity);
  heads.add(head);
  if (selected.length === 5) break;
 }
 const exploratory = ranked.find(o => o.idea.exploration);
 if (exploratory && !selected.some(o => o.idea.exploration)) {
  if (selected.length === 5) selected.pop();
  selected.push(exploratory);
 }
 for (const o of ranked) {
  if (selected.length >= 3) break;
  if (!selected.includes(o)) selected.push(o);
 }
 return selected.sort((a,b) => score(b) - score(a) || a.idea.id.localeCompare(b.idea.id)).map(o => o.idea.id);
}

export function frontierTokens(usage?: JobUsage): number {
 return (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0);
}
