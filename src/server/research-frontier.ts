import {z} from "zod";
import {piEngineForSpec} from "../agent/models.ts";
import {connectionBackgroundAllowed} from "../agent/subscription-connections.ts";
import {isJobLive, registerJobAbort, unregisterJobAbort} from "../agent/subagents/aborts.ts";
import {runFrontier} from "../agent/subagents/research-frontier.ts";
import {SubmitProposalError} from "../agent/subagents/submit-agent.ts";
import {AtlasError, atlasCommandSchema} from "../core/atlas.ts";
import type {JobRecord} from "../core/contracts/jobs.ts";
import {emit} from "../core/events.ts";
import {
 ADAPTIVE_DEFAULTS, FRONTIER_ACTIONS, FRONTIER_GOAL, FRONTIER_SCOPE, frontierCommand, frontierJobId, frontierOpportunityId, frontierPacket, frontierTokens,
 type FrontierBoardEntry, type FrontierLedger, type FrontierProgress, type FrontierState, type FrontierPreference,
} from "../core/research-frontier.ts";
import {ADAPTIVE_OUTPUT, adaptiveActionContext, frontierBoardAnchors, frontierCallEstimate, frontierDigest, frontierIdeaId, frontierReferences, frontierRevision, planDiscovery} from "../core/frontier-plan.ts";
import {researchCommandSchema, researchTrailId} from "../core/research-trails.ts";
import {resolveRoleSpec, type EffectiveModelSpec} from "../core/settings-resolution.ts";
import {readFrontierSources} from "./frontier-sources.ts";
import {abortJob} from "./jobs.ts";
import {providerKeyPresent} from "./keys.ts";
import {readRequestBody} from "./request-body.ts";
import {requireSameOrigin} from "./request-origin.ts";
import {stores} from "./stores.ts";

const headers = {"Cache-Control": "private, no-store"};
const jobs = () => stores.jobStore.listJobs(FRONTIER_SCOPE).filter(j => j.kind === "frontier").sort((a,b) =>
 b.createdAt.localeCompare(a.createdAt) || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
type History = {hypothesis: string; verdict: string; reason: string};
type FrontierMode = "single" | "adaptive";
type FrontierInput = {model: EffectiveModelSpec; focus?: string; mode?: FrontierMode; history: History[]};
const modeOf = (job: JobRecord): FrontierMode => (job.input as FrontierInput | undefined)?.mode ?? (job.frontier?.adaptive ? "adaptive" : "single");

function savedJob(records: JobRecord[], mode?: FrontierMode, goal?: string) {
 return records.find(j => j.status === "done" && j.frontier?.version === 1 &&
  (!mode || modeOf(j) === mode) && (goal === undefined || j.frontier.goal === goal));
}

function ownerFeedback(records: JobRecord[], at?: number) {
 const latest: NonNullable<FrontierLedger["feedback"]> = {};
 for (const job of records) {
  for (const [id, entry] of Object.entries(job.frontier?.feedback ?? {})) {
   if (!latest[id] || entry.at > latest[id]!.at) latest[id] = entry;
  }
 }
 return Object.fromEntries(Object.entries(latest)
  .filter(([, entry]) => at === undefined || entry.preference !== "revisit" || at - Date.parse(entry.at) < 86_400_000)
  .map(([id, entry]) => [id, entry.preference]));
}

function boardDecisions(records: JobRecord[]) {
 const decisions = new Map<string, {jobId: string; archived: boolean; at: string}>();
 for (const job of records) {
  for (const [id, entry] of Object.entries(job.frontier?.board ?? {})) {
   if (!decisions.has(id) || entry.at > decisions.get(id)!.at) {
    decisions.set(id, {jobId: job.id, ...entry});
   }
  }
 }
 return decisions;
}

function boardEntries(records: JobRecord[], current: JobRecord | undefined) {
 const decisions = boardDecisions(records);
 const board = new Map<string, FrontierBoardEntry>();
 for (const job of [current, ...records]) {
  const ledger = job?.frontier;
  if (!job || !ledger || job.status !== "done" || ledger.version !== 1) continue;
  const branches = ledger.assessed.filter(o => o.idea.parents?.length && o.assessment.verdict !== "reject");
  const candidates = new Set([
   ...ledger.selected,
   ...branches.flatMap(o => [o.idea.id, ...o.idea.parents ?? []]),
   ...ledger.assessed.filter(o => decisions.get(o.idea.id)?.jobId === job.id).map(o => o.idea.id),
   ...ledger.assessed.filter(o => o.assessment.verdict === "defer").slice(0, 5).map(o => o.idea.id),
  ]);
  const evidence = new Map(ledger.evidence.map(s => [s.id, s]));
  for (const o of ledger.assessed) {
   if (board.has(o.idea.id) || !candidates.has(o.idea.id)) continue;
   const rank = ledger.selected.indexOf(o.idea.id);
   const priority = job === current && rank >= 0 && rank < 2 ? "high" :
    o.assessment.verdict === "pursue" ? "promising" : "exploratory";
   board.set(o.idea.id, {id: o.idea.id, jobId: job.id, title: o.idea.title, priority, anchors: frontierBoardAnchors(o, evidence),
    parents: o.idea.parents, archived: decisions.get(o.idea.id)?.archived ?? false});
  }
 }
 return [...board.values()].sort((a,b) => Number(a.archived) - Number(b.archived) || a.title.localeCompare(b.title));
}

function progress(job?: JobRecord): FrontierProgress | undefined {
 const ledger = job?.frontier;
 const a = ledger?.adaptive;
 if (!a || !ledger) return;
 return {budget: ledger.budget, settings: a.settings,
  iteration: a.rounds.length + Number(Boolean(a.pending)),
  action: a.pending?.action, reportedTokens: job?.usage ? frontierTokens(job.usage) : undefined,
  estimatedUnreported: a.estimatedUnreported, stop: a.stop,
  rounds: a.rounds.map(r => ({label: `${FRONTIER_ACTIONS[r.action.kind]} · ${r.action.label}`, outcome: r.outcome, gain: r.gain,
   progress: r.progress, overlap: r.action.overlap, penalty: r.action.penalty, recovery: r.action.recovery,
   reportedTokens: r.reportedTokens, estimatedUnreported: r.estimatedUnreported}))};
}

function currentModel() {
 return resolveRoleSpec("researcher", stores.settingsStore.readSettings());
}
function openEngine(model: EffectiveModelSpec) {
 if (!providerKeyPresent(model.provider)) throw new AtlasError("Connect the configured research model provider in Settings.", 503);
 if (!connectionBackgroundAllowed(model.provider)) throw new AtlasError("Allow background work for the configured provider in Settings.", 403);
 try { return piEngineForSpec(model); }
 catch { throw new AtlasError("The configured research model is unavailable.", 503); }
}
function launch(job: JobRecord, input: FrontierInput, engine: ReturnType<typeof openEngine>) {
 if (isJobLive(job.id)) return;
 const controller = new AbortController();
 registerJobAbort(job.id, controller);
 const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20 * 60_000)]);
 const save = (patch: Partial<Pick<JobRecord, "frontier" | "usage" | "activity">>) => {
  if (stores.jobStore.getJob(job.id)?.status === "running") stores.jobStore.updateJob(job.id, patch);
 };
 void runFrontier({
  engine, ledger: job.frontier!, signal, usage: job.usage, focus: input.focus,
  history: input.history, idFor: frontierIdeaId, save,
 }).then(ledger => {
  if (stores.jobStore.getJob(job.id)?.status === "running")
   stores.jobStore.updateJob(job.id, {status: "done", activity: "Brief ready", frontier: ledger});
 }).catch(error => {
  if (stores.jobStore.getJob(job.id)?.status !== "running") return;
  stores.jobStore.updateJob(job.id, {status: "error", activity: "Discovery stopped",
   error: error instanceof SubmitProposalError ? error.message : "Discovery could not finish. The previous brief and completed stages are saved."});
 }).catch(() => {
  // A failed write leaves the durable job resumable after the registry releases it.
  console.error(`[frontier ${job.id}] Could not record the worker outcome.`);
 }).finally(() => unregisterJobAbort(job.id));
}

function readJob(id: string) {
 const job = stores.jobStore.getJob(id);
 if (job?.kind !== "frontier" || job.chatId !== FRONTIER_SCOPE || job.frontier?.version !== 1)
  throw new AtlasError("Discovery pass unavailable.", 404);
 return job;
}
function readOpportunity(id: string, opportunityId: string) {
 const job = readJob(id);
 const ledger = job.frontier!;
 const opportunity = ledger.assessed.find(o => o.idea.id === opportunityId);
 if (job.status !== "done" || !opportunity) throw new AtlasError("Saved opportunity unavailable.", 404);
 return {opportunity, ledger};
}
function status(records = jobs(), mode?: FrontierMode): FrontierState {
 const job = records[0];
 const saved = savedJob(records, mode);
 const ledger = saved?.frontier;
 const model = currentModel();
 const chosen = new Set(ledger?.selected);
 const others = (ledger?.assessed ?? []).filter(o => !chosen.has(o.idea.id))
  .sort((a,b) => Number(b.assessment.verdict === "reject") - Number(a.assessment.verdict === "reject")).slice(0, 5);
 const opportunities = [...(ledger?.selected ?? []).flatMap(id => (ledger?.assessed ?? []).filter(o => o.idea.id === id)), ...others];
 const cited = new Set(opportunities.flatMap(frontierReferences));
 return {
  board: boardEntries(records, saved),
  model: model ? `${model.provider}:${model.id}` : null,
  job: job ? {id: job.id, status: job.status, interrupted: job.status === "running" && !isJobLive(job.id),
   activity: job.activity, error: job.error, usage: job.usage, progress: progress(job)} : null,
  brief: saved && ledger ? {id: saved.id, mode: modeOf(saved), date: saved.updatedAt, goal: ledger.goal, budget: ledger.budget,
   selected: ledger.selected, previous: ledger.previous, usage: saved.usage, note: ledger.note,
   stale: job?.id !== saved.id && job?.frontier?.fingerprint !== ledger.fingerprint,
   progress: progress(saved), feedback: Object.fromEntries(Object.entries(ownerFeedback(records)).filter(([id]) => opportunities.some(o => o.idea.id === id))),
   opportunities, sourceTitles: Object.fromEntries(ledger.evidence.filter(s => cited.has(s.id)).map(s => [s.id, s.title]))} : null,
 };
}
function promote(id: string, opportunityId: string, rawTrailId: string) {
 const trailId = researchTrailId.parse(rawTrailId);
 const {ledger, opportunity: {idea, assessment}} = readOpportunity(id, opportunityId);
 const {trail, nodes} = stores.atlasStore.research.detail(trailId);
 if (trail.archivedAt) throw new AtlasError("Choose a trail that is not archived.", 409);
 const key = frontierDigest([id, opportunityId, trailId]);
 const requestId = `${key.slice(0,8)}-${key.slice(8,12)}-4${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`;
 const nodeId = `rn_${requestId}`;
 if (nodes.some(n => n.id === nodeId)) return nodeId;
 const evidence = ledger.evidence.filter(e => [...idea.sources, ...assessment.sources].includes(e.id));
 const live = new Set(stores.atlasStore.read().concepts.map(c => c.id));
 const relatedConceptIds = [...new Set(evidence.flatMap(s => [s.id, ...s.concepts]).filter(x => live.has(x)))].slice(0, 50);
 const body = [idea.hypothesis, idea.intuition, assessment.startingPoint, assessment.obstacles, assessment.novelty,
  assessment.nextAction, assessment.uncertainty, `Frontier discovery ${id}, opportunity ${opportunityId}.`,
  ...evidence.map(s => `${s.title} [${s.id}]`)].join("\n\n");
 stores.atlasStore.research.save(researchCommandSchema.parse({kind: "add-node", requestId, id: nodeId, trailId,
  parentNodeId: trail.rootNodeId, nodeKind: "approach", title: idea.title, body, relatedConceptIds}));
 emit("research-trails-changed", {});
 return nodeId;
}

function addToAtlas(id: string, opportunityId: string) {
 const {opportunity, ledger} = readOpportunity(id, opportunityId);
 const {idea, assessment} = opportunity;
 const key = frontierDigest(["frontier-atlas", opportunityId]);
 const conceptId = `ac_${key.slice(0,8)}-${key.slice(8,12)}-4${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`;
 const atlas = stores.atlasStore.read();
 if (atlas.concepts.some(c => c.id === conceptId)) return conceptId;
 const refs = new Set(frontierReferences(opportunity));
 const evidence = ledger.evidence.filter(e => refs.has(e.id));
 const anchors = new Set(evidence.flatMap(e => [e.id, ...e.concepts]));
 const subjectId = atlas.concepts.find(c => anchors.has(c.id) && c.preferredSubjectId)?.preferredSubjectId ?? null;
 const markdown = ["**Research hypothesis**", idea.hypothesis, idea.intuition,
  "### Mathematical starting point", assessment.startingPoint, "### Obstacles and uncertainty",
  assessment.obstacles, assessment.uncertainty, "### Next step", assessment.nextAction,
  `Frontier brief \`${id}\` · hypothesis \`${opportunityId}\``,
  ...evidence.map(e => e.url ? `- [${e.title}](${e.url}) · \`${e.id}\`` : `- ${e.title} · \`${e.id}\``)].join("\n\n");
 stores.atlasStore.save(atlasCommandSchema.parse({kind: "concept", id: conceptId, expectedRevision: 0,
  title: idea.title, aliases: [], markdown, subjectIds: subjectId ? [subjectId] : [],
  preferredSubjectId: subjectId, propositionIds: []}));
 emit("atlas-changed", {});
 return conceptId;
}

function recentFindings(records: JobRecord[], ledger: FrontierLedger): History[] {
 const scope = new Set(ledger.packets.flatMap(p => p.evidence.map(e => e.id)));
 const findings = records.flatMap(j => [
  ...(j.frontier?.assessed ?? []), ...(j.frontier?.adaptive?.rounds.flatMap(r => r.opportunities) ?? []),
 ]);
 const related = findings.filter(o => frontierReferences(o).some(id => scope.has(id)));
 const failures = findings.filter(o => o.assessment.verdict === "reject");
 const history: History[] = [];
 const seen = new Set<string>();
 let chars = 3600;
 for (const o of [...failures.slice(0, 2), ...related.slice(0, 8)]) {
  if (seen.has(o.idea.id)) continue;
  const entry = {hypothesis: o.idea.hypothesis, verdict: o.assessment.verdict, reason: o.assessment.feedback?.failureMechanism || o.assessment.reason};
  const size = JSON.stringify(entry).length;
  if (size > chars) continue;
  chars -= size;
  history.push(entry);
  seen.add(o.idea.id);
 }
 return history;
}

export async function researchFrontierResponse(request: Request, engineFor = openEngine): Promise<Response> {
 try {
  if (request.method === "GET") {
   const query = new URL(request.url).searchParams;
   if (query.has("source")) {
    const job = readJob(frontierJobId.parse(query.get("id")));
    const source = job.frontier!.evidence.find(e => e.id === query.get("source"));
    if (job.status !== "done" || !source) throw new AtlasError("Saved evidence unavailable.", 404);
    return Response.json(source, {headers});
   }
   if (query.has("opportunity")) {
    const id = frontierJobId.parse(query.get("id"));
    const {opportunity, ledger} = readOpportunity(id, frontierOpportunityId.parse(query.get("opportunity")));
    const cited = new Set(frontierReferences(opportunity));
    return Response.json({opportunity, rank: ledger.selected.indexOf(opportunity.idea.id), previous: ledger.previous.indexOf(opportunity.idea.id),
     sourceTitles: Object.fromEntries(ledger.evidence.filter(e => cited.has(e.id)).map(e => [e.id, e.title]))}, {headers});
   }
   const mode = query.get("mode");
   return Response.json(status(jobs(), mode === "single" || mode === "adaptive" ? mode : undefined), {headers});
  }
  requireSameOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new AtlasError("Expected JSON.", 415);
  const command = frontierCommand.parse(JSON.parse((await readRequestBody(request, 8192)).toString("utf8")));
  if (command.action === "add-to-atlas")
   return Response.json({conceptId: addToAtlas(command.id, command.opportunityId)}, {headers});
  if (command.action === "archive-opportunity") {
   const {ledger} = readOpportunity(command.id, command.opportunityId);
   const job = readJob(command.id);
   const board = {...ledger.board, [command.opportunityId]: {archived: command.archived, at: new Date().toISOString()}};
   stores.jobStore.updateJob(job.id, {frontier: {...ledger, board}, updatedAt: job.updatedAt});
   return Response.json({archived: command.archived}, {headers});
  }
  if (command.action === "feedback") {
   const {ledger} = readOpportunity(command.id, command.opportunityId);
   const job = readJob(command.id);
   const feedback = {...ledger.feedback, [command.opportunityId]: {preference: command.preference, at: new Date().toISOString()}};
   stores.jobStore.updateJob(job.id, {frontier: {...ledger, feedback}, updatedAt: job.updatedAt});
   return Response.json({preference: command.preference}, {headers});
  }
  if (command.action === "promote") return Response.json({nodeId: promote(command.id, command.opportunityId, command.trailId)}, {headers});
  if (command.action === "cancel") {
   const job = readJob(command.id);
   abortJob(job.id);
   return Response.json(status(), {headers});
  }
  if (command.action === "resume") {
   const job = readJob(command.id);
   if (job.status === "done" || job.error === "Cancelled" || jobs()[0]?.id !== job.id)
    throw new AtlasError("Only the latest unfinished pass can resume.", 409);
   if (!isJobLive(job.id)) {
    const input = job.input as FrontierInput;
    const engine = engineFor(input.model);
    const pending = stores.jobStore.updateJob(job.id, {status: "running", error: undefined, activity: "Resuming discovery"});
    if (pending) launch(pending, input, engine);
   }
   return Response.json(status(), {headers});
  }
  const records = jobs();
  if (records.some(j => j.status === "running")) throw new AtlasError("Finish, resume or cancel the current discovery pass first.", 409);
  const mode: FrontierMode = command.action === "deepen" || command.action === "branch" ? modeOf(readJob(command.id)) :
   "adaptive" in command && command.adaptive ? "adaptive" : "single";
  const saved = savedJob(records, mode, "goal" in command ? command.goal : undefined);
  const goal = "goal" in command && command.goal !== FRONTIER_GOAL ? command.goal : undefined;
  const branch = command.action === "branch" ? readOpportunity(command.id, command.opportunityId) : undefined;
  const {sources, matched} = readFrontierSources(branch?.ledger.goal === FRONTIER_GOAL ? undefined : branch?.ledger.goal ?? goal);
  let ledger: FrontierLedger;
  let focus: string | undefined;
  if (branch) {
   const {ledger: current, opportunity} = branch;
   const latest = savedJob(records, mode, current.goal)?.frontier ?? current;
   const anchors = frontierReferences(opportunity);
   const packet = frontierPacket(sources, [], 8500, anchors);
   if (anchors.some(id => !packet.evidence.some(e => e.id === id)))
    throw new AtlasError("Some evidence for this hypothesis is unavailable or exceeds the branch context.", 409);
   const children = records.filter(j => j.status === "done").flatMap(j =>
    (j.frontier?.assessed ?? []).filter(o => o.idea.parents?.includes(opportunity.idea.id)));
   const preferences: Record<string, FrontierPreference> = ownerFeedback(records, Date.now());
   for (const [id, item] of boardDecisions(records)) if (item.archived) preferences[id] = "dismiss";
   ledger = {...latest, packets: [packet], candidates: [], generated: 1, ranked: true, deepened: true,
    evidence: [...new Map([...current.evidence, ...latest.evidence, ...packet.evidence].map(e => [e.id, e])).values()],
    assessed: [...new Map([...latest.assessed, ...children.reverse(), opportunity].map(o => [o.idea.id, o])).values()],
    previous: latest.selected, note: undefined, feedback: undefined, board: undefined,
    adaptive: {settings: {...ADAPTIVE_DEFAULTS}, catalog: packet.evidence, seeds: [],
     preferences, rounds: [], estimatedUnreported: 0}};
   const action = {kind: "exploit" as const, key: JSON.stringify(["branch", opportunity.idea.id]), label: opportunity.idea.title,
    anchors, parents: [opportunity.idea.id], priority: 0};
   const estimate = frontierCallEstimate(adaptiveActionContext(ledger, action), ADAPTIVE_OUTPUT, 3500);
   ledger.adaptive!.pending = {action: {...action, estimate}, reportedBefore: 0, unreportedBefore: 0};
  } else if (command.action === "deepen") {
   if (command.id !== saved?.id) throw new AtlasError("Open the current brief before deepening.", 409);
   const {ledger: current, opportunity} = readOpportunity(command.id, command.opportunityId);
   const cited = frontierReferences(opportunity);
   if (frontierRevision(sources, current.goal).fingerprint !== current.fingerprint)
    throw new AtlasError("The evidence changed. Start a fresh session brief first.", 409);
   const packet = frontierPacket(sources, [], 14_000, cited);
   if (cited.some(id => !packet.evidence.some(e => e.id === id))) throw new AtlasError("The cited evidence exceeds the deepening context limit.", 413);
   const evidence = [...new Map([...current.evidence, ...packet.evidence].map(e => [e.id,e])).values()];
   ledger = {...current, evidence, packets: [packet], previous: current.selected, ranked: false, deepened: false, note: undefined, adaptive: undefined, feedback: undefined, board: undefined};
   focus = opportunity.idea.id;
  } else {
   if (!("goal" in command)) throw new AtlasError("Unknown discovery action.");
   const sameGoal = saved?.frontier;
   if (!command.adaptive && command.action === "start" && sameGoal?.fingerprint === frontierRevision(sources, command.goal).fingerprint &&
       savedJob(records, mode)?.id === saved?.id)
    return Response.json(status(records, mode), {headers});
   const prior = sameGoal ?? (command.adaptive ? savedJob(records, undefined, command.goal)?.frontier : undefined);
   const preferences: Record<string, FrontierPreference> = ownerFeedback(records, Date.now());
   for (const [id, item] of boardDecisions(records)) if (item.archived) preferences[id] = "dismiss";
   ledger = planDiscovery(sources, command.goal, command.budget, command.action === "start" ? prior : undefined, matched,
    command.adaptive ? {settings: command.adaptive, preferences} : undefined);
   ledger.previous = prior?.selected ?? [];
   if (!ledger.packets.length) throw new AtlasError("Add an Atlas concept, mathematical claim, lesson or research question before starting discovery.", 409);
  }
  if (ledger.adaptive) {
   const revisions = branch ? frontierRevision(sources, ledger.goal).revisions : ledger.revisions;
   ledger.adaptive.priorInsights = records.flatMap(job => {
    const previous = job.frontier;
    if (job.status !== "done" || previous?.goal !== ledger.goal) return [];
    return (previous.adaptive?.rounds ?? []).flatMap(round => round.progress?.insights ?? [])
     .filter(insight => insight.sources.every(id => revisions[id] && revisions[id] === previous.revisions[id]));
   }).slice(0, 24).reverse();
  }
  const model = currentModel();
  if (!model) throw new AtlasError("Configure the research model in Settings → Models.", 503);
  const engine = engineFor(model);
  const input: FrontierInput = {model, focus, mode, history: recentFindings(records, ledger)};
  const job = stores.jobStore.createJob({kind: "frontier", chatId: FRONTIER_SCOPE,
   toolCallId: crypto.randomUUID(), input, frontier: ledger});
  launch(job, input, engine);
  return Response.json(status(jobs(), mode), {headers, status: 202});
 } catch (error) {
  const message = error instanceof AtlasError ? error.message : error instanceof z.ZodError || error instanceof SyntaxError ?
   "Invalid discovery request." : "Research Frontier is unavailable.";
  return Response.json({error: message}, {headers, status: error instanceof AtlasError ? error.status :
   error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500});
 }
}
