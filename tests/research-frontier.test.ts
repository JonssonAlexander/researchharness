import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep} from "@earendil-works/pi-ai";
import {initialLesson} from "../src/core/learning-session.ts";
import {ADAPTIVE_DEFAULTS, FRONTIER_SCOPE, frontierPacket, frontierTokens, type FrontierLedger, type FrontierOpportunity, type FrontierSource, type FrontierState} from "../src/core/research-frontier.ts";
import {adaptivePortfolio, chooseFrontierAction, frontierBoardAnchors, frontierIdeaId, frontierProgress, frontierRevision, planDiscovery} from "../src/core/frontier-plan.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-frontier-"));
process.env.LH_DATA_DIR = path.join(root, "data");
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
const {runFrontier} = await import("../src/agent/subagents/research-frontier.ts");
const {researchFrontierResponse} = await import("../src/server/research-frontier.ts");
const {stores} = await import("../src/server/stores.ts");
const {readFrontierSources} = await import("../src/server/frontier-sources.ts");
const id = (prefix: string) => `${prefix}_${randomUUID()}`;

function source(id: string, props: Partial<FrontierSource> = {}): FrontierSource {
 return {id, kind: "claim", title: id, status: "canonical proposition", text: "For finite-dimensional V over K", links: [], concepts: [], ...props};
}
test("frontier packets retain whole joint premises, bridge lessons and use stable revisions", () => {
 const premise = source("p"), other = source("q"), conclusion = source("r");
 const argument = source("a", {kind: "argument", requires: ["p", "q", "r"]});
 const seeds = [{kind: "generalization" as const, sources: ["a"]}];
 assert.deepEqual(frontierPacket([premise, conclusion, argument], seeds, 4000).evidence, []);
 assert.deepEqual(frontierPacket([premise, other, conclusion, argument], seeds, 200).evidence, []);
 const packed = frontierPacket([premise, other, conclusion, argument], seeds, 4000);
 assert.deepEqual(packed.evidence.map(s => s.id), ["a", "p", "q", "r"]);
 const a = source("t1", {kind: "lesson-topic", chatId: "chat_a", concepts: ["c"]});
 const b = source("t2", {kind: "lesson-topic", chatId: "chat_b", concepts: ["c"]});
 const c = source("c", {kind: "concept"});
 const ledger = planDiscovery([a, b, c], "Investigate transfer", 35_000);
 assert(ledger.packets.some(p => p.seeds.some(s => s.kind === "transfer" && s.sources.join() === "t1,t2")));
 assert.equal(ledger.fingerprint, frontierRevision([c, b, a], ledger.goal).fingerprint);
 assert.notEqual(ledger.fingerprint, frontierRevision([a, b, {...c, text: "Changed assumption"}], ledger.goal).fingerprint);
 assert.equal(frontierIdeaId("Test x < 1"), frontierIdeaId("Test  x < 1 "));
 assert.notEqual(frontierIdeaId("Test x < 1"), frontierIdeaId("Test x > 1"));
 assert.notEqual(frontierIdeaId("Test x < 1"), frontierIdeaId("Test X < 1"));
});

const hypothesis = (s: FrontierSource, label: string) => ({
 title: label, hypothesis: `Determine whether ${label} extends with finite-dimensional hypotheses on ${s.title}.`,
 intuition: "The base statement gives a possible mechanism under its stated hypotheses.", sources: [s.id],
});
const assessment = (idea: {id: string; sources: string[]}, verdict = "pursue") => ({
 id: idea.id, sources: idea.sources, startingPoint: "Keep the available assumptions explicit.", obstacles: "Extension can lose uniformity.",
 novelty: "The reference does not treat the proposed condition.", nextAction: "Find the exact step that first uses uniformity.",
 uncertainty: "The uniformity assumption might be necessary.", reason: "A falsifiable next step.",
 support: 3, usefulness: 4, surprise: 2, verdict,
});
test("map anchors come from cited evidence and exact argument dependencies", () => {
 const claim = source("n_claim", {concepts: ["ac_primary"]});
 const later = source("n_later");
 const proof = source("arg_proof", {kind: "argument", requires: [claim.id]});
 const reviewed = source("reviewed", {kind: "argument", requires: [proof.id]});
 const unrelated = source("ac_unrelated", {kind: "concept"});
 const idea = {...hypothesis(reviewed, "Extend the reviewed argument"), id: "fixture", exploration: false};
 const opportunity: FrontierOpportunity = {idea, assessment: {...assessment({...idea, sources: [later.id]}), verdict: "pursue"}};
 assert.deepEqual(frontierBoardAnchors(opportunity, new Map([reviewed, proof, claim, later, unrelated].map(s => [s.id, s]))),
  ["ac_primary", "n_claim", "n_later"]);
});

const answer = (body: unknown) => fauxAssistantMessage([fauxToolCall("submit_frontier", body as never, {id: "submit"})], {stopReason: "toolUse"});
const url = "http://localhost/api/research/frontier";
const config = {action: "start", goal: "Investigate finite dimensional structure", budget: 35_000};
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test("Frontier HTTP uses the job lifecycle, zero-call cache, selective refresh and explicit promotion", async t => {
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 const concept = id("ac");
 const saveConcept = (expectedRevision: number, markdown: string) => stores.atlasStore.save({
  kind: "concept", id: concept, expectedRevision, title: "Finite dimensional spaces", aliases: [], subjectIds: [],
  preferredSubjectId: null, propositionIds: [], markdown,
 });
 saveConcept(0, "First source notes.");
 const chat = stores.chatStore.createChat("Working finite-dimensional lesson");
 const lesson = initialLesson("Investigate finite dimensional structure", [{id: concept, title: "Finite dimensional spaces"}]);
 lesson.derivations = [{id: "derive", nodeId: "topic_0", title: "Find missing bound", start: "Dim V = n", finish: "Constant independent of n", status: "working"}];
 stores.lessonStore.create(chat.id, lesson);
 const trailId = id("rt"), rootNodeId = id("rn");
 stores.atlasStore.research.save({kind: "create", requestId: randomUUID(), id: trailId, rootNodeId, title: "Independent research",
  question: "Can a local argument transfer?", anchorConceptIds: [], primaryConceptId: null, origin: {kind: "manual"}});
 const derivation = `derivation:${chat.id}:derive`;
 assert(readFrontierSources().sources.some(s => s.id === derivation && s.text.includes("Constant independent of n")));

 const faux = createFauxCore({});
 const engine = {model: faux.getModel(), streamFn: faux.streamSimple};
 let openCount = 0;
 let calls = 0;
 const batches: string[][] = [];
 const critiqueCandidates: string[][] = [];
 const reply: FauxResponseStep = context => {
  calls++;
  const m = context.messages.at(-1)!;
  assert.equal(m.role, "user");
  const input = JSON.parse(typeof m.content === "string" ? m.content : (m.content[0] as {text: string}).text);
  if (input.action) return answer({review: null, proposals: [], outcome: "No additional grounded direction."});
  if (input.candidates) {
   critiqueCandidates.push(input.candidates.map((c: {sources: string[]}) => c.sources[0]));
   return answer({assessments: input.candidates.map((c: {id: string; sources: string[]}) =>
    ({...assessment(c), ...(input.structuredCritique ? {feedback: {...critiqueFeedback, mechanism: c.sources[0]}} : {})}))});
  }
  const batch = input.evidence as FrontierSource[];
  batches.push(batch.map(e => e.id));
  return answer({ideas: batch.slice(0, 5).map((s,i) => hypothesis(s, `${s.title} mechanism ${i + 1}`))});
 };
 faux.setResponses(Array.from({length: 20}, () => reply));
 const engineFor = () => {openCount++; return engine;};
 const get = async (): Promise<FrontierState> => (await researchFrontierResponse(new Request(url), engineFor)).json();
 const post = (body: unknown, origin = "http://localhost") => researchFrontierResponse(new Request(url, {
  method: "POST", headers: {origin, "content-type": "application/json"}, body: JSON.stringify(body),
 }), engineFor);
 async function settled() {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
   const state = await get();
   if (state.job?.status !== "running") return state;
   await tick();
  }
  throw new Error("Frontier did not settle.");
 }

 assert.equal((await post(config, "https://elsewhere.example")).status, 403);
 assert.equal((await post(config)).status, 503);
 assert.equal(openCount, 0);
 stores.settingsStore.writeSettings({version: 1, models: {cheap: {model: {provider: "openai", id: "gpt-test"}}}});
 assert.equal((await post(config)).status, 202);
 assert.equal((await post(config)).status, 409);
 const result = await settled();
 assert.equal(result.job?.status, "done", result.job?.error);
 assert(result.brief);
 assert(result.brief.selected.length >= 3 && result.brief.selected.length <= 5);
 assert(batches.flat().includes(derivation));
 assert.equal(result.brief.usage?.steps, calls);
 assert(frontierTokens(result.brief.usage) > 0);
 assert.equal(stores.chatStore.getChat(chat.id)?.messages.length, 0);

 const first = result.brief;
 assert.equal((await post(config)).status, 200);
 assert.equal(openCount, 1);
 assert.equal((await get()).brief?.id, first.id);
 const cacheUsage = calls;
 const selected = first.opportunities.find(o => o.idea.sources.includes(derivation)) ?? first.opportunities[0]!;
 const query = new URLSearchParams({id: first.id, source: selected.idea.sources[0]!});
 const evidence = await (await researchFrontierResponse(new Request(`${url}?${query}`))).json();
 assert.equal(evidence.id, selected.idea.sources[0]);
 assert.equal(calls, cacheUsage);

 assert.equal((await post({action: "deepen", id: first.id, opportunityId: selected.idea.id})).status, 202);
 const deep = await settled();
 assert.equal(deep.job?.status, "done", deep.job?.error);
 assert.equal(deep.brief?.usage?.steps, 1);
 assert.equal(deep.brief?.previous.length, first.selected.length);

 saveConcept(1, "Updated exact hypothesis.");
 assert.equal((await post({action: "deepen", id: deep.brief!.id, opportunityId: selected.idea.id})).status, 409);
 const before = calls;
 assert.equal((await post(config)).status, 202);
 const changed = await settled();
 assert.equal(changed.job?.status, "done", changed.job?.error);
 assert(calls > before);
 assert(critiqueCandidates.length >= 3);
 const saved = changed.brief!;
 const promoted = {action: "promote", id: saved.id, opportunityId: saved.selected[0], trailId};
 const a = await (await post(promoted)).json();
 const b = await (await post(promoted)).json();
 assert.equal(a.nodeId, b.nodeId);
 const nodes = stores.atlasStore.research.detail(trailId).nodes;
 assert.deepEqual(nodes.map(n => n.id).sort(), [rootNodeId, a.nodeId].sort());
 assert.match(nodes.find(n => n.id === a.nodeId)!.body, /Frontier discovery/);

 const prior = stores.jobStore.getJob(saved.id)!.frontier!;
 const interrupted = stores.jobStore.createJob({kind: "frontier", chatId: FRONTIER_SCOPE, toolCallId: "interruption",
  input: {model: {provider: "openai", id: "gpt-test"}, history: []},
  frontier: {...prior, ...frontierRevision(readFrontierSources().sources, config.goal), generated: prior.packets.length, ranked: false, deepened: true, candidates: [], assessed: []}});
 assert((await get()).job?.interrupted);
 const checkpointCalls = calls;
 assert.equal((await post({action: "resume", id: interrupted.id})).status, 200);
 assert.equal((await settled()).job?.status, "done");
 assert.equal(calls, checkpointCalls);

 faux.setResponses([() => answer({ideas: [hypothesis(source("invented"), "Unsupported suggestion")]})]);
 assert.equal((await post({...config, action: "refresh"})).status, 202);
 const failed = await settled();
 assert.equal(failed.job?.status, "error");
 assert.equal(failed.brief?.id, interrupted.id);
 assert.match(failed.job?.error ?? "", /source IDs/);

 let running = false;
 faux.setResponses([reply, (_context, options) => {
  running = true;
  return new Promise(resolve => {
   options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("late response")), {once: true});
  });
 }]);
 assert.equal((await post({action: "resume", id: failed.job!.id})).status, 200);
 for (let i = 0; i < 100 && !running; i++) await tick();
 assert(running);
 assert.equal((await post({action: "cancel", id: failed.job!.id})).status, 200);
 const cancelled = await settled();
 assert.equal(cancelled.job?.error, "Cancelled");
 assert.equal(cancelled.brief?.id, interrupted.id);
 assert(stores.jobStore.getJob(failed.job!.id)?.frontier?.generated);
 assert.equal((await post({action: "resume", id: failed.job!.id})).status, 409);

 const preference = {action: "feedback", id: saved.id, opportunityId: saved.selected[0], preference: "interested"};
 assert.equal((await post({...preference, opportunityId: "0".repeat(24)})).status, 404);
 assert.equal((await post(preference)).status, 200);
 faux.setResponses(Array.from({length: 10}, () => reply));
 const settings = {...ADAPTIVE_DEFAULTS, maxIterations: 1};
 assert.equal((await post({...config, budget: 50_000, adaptive: settings})).status, 202);
 const automatic = await settled();
 assert.equal(automatic.job?.status, "done", automatic.job?.error);
 assert.equal(automatic.brief?.mode, "adaptive");
 assert((automatic.brief?.progress?.iteration ?? 0) > 1);
 assert.notEqual(automatic.brief?.progress?.stop, "iterations");
 assert.equal(automatic.brief?.progress?.budget, 50_000);
 const adaptiveLedger = stores.jobStore.getJob(automatic.brief!.id)!.frontier!;
 assert.equal(adaptiveLedger.adaptive?.preferences[saved.selected[0]!], "interested");
 assert(adaptiveLedger.assessed.some(o => o.assessment.feedback));

 const count = calls;
 const single = await post(config);
 assert.equal(single.status, 200);
 const singleState: FrontierState = await single.json();
 assert.equal(singleState.brief?.mode, "single");
 assert.equal(singleState.brief?.id, interrupted.id);
 assert.equal(calls, count);

 const card = singleState.board?.find(o => o.id === saved.selected[0] && !o.archived);
 assert(card);
 const archive = {action: "archive-opportunity", id: card.jobId, opportunityId: card.id, archived: true};
 assert.equal((await post({...archive, opportunityId: "0".repeat(24)})).status, 404);
 assert.equal((await post(archive)).status, 200);
 assert((await get()).board?.find(o => o.id === card.id)?.archived);
 assert.equal((await post({...archive, archived: false})).status, 200);
 assert.equal((await get()).board?.find(o => o.id === card.id)?.archived, false);

 const add = {action: "add-to-atlas", id: card.jobId, opportunityId: card.id};
 const firstAdd = await (await post(add)).json();
 const retryAdd = await (await post(add)).json();
 assert.equal(firstAdd.conceptId, retryAdd.conceptId);
 const conceptAfter = stores.atlasStore.read().concepts.find(c => c.id === firstAdd.conceptId);
 assert(conceptAfter);
 assert.match(conceptAfter.markdown ?? "", /Research hypothesis/);
 assert.deepEqual(conceptAfter.propositionIds, []);
 assert.equal(calls, count);
 const branch = {action: "branch", id: card.jobId, opportunityId: card.id};
 for (const [index, title] of ["A connected branch", "A second connected branch"].entries()) {
  faux.setResponses([context => {
   calls++;
   const message = context.messages.at(-1)!;
   assert(message.role === "user" && typeof message.content === "string");
   const input = JSON.parse(message.content);
   assert.deepEqual(input.parents.map((parent: {id: string}) => parent.id), [card.id]);
   if (index) {
    assert.equal(input.existingBranches.length, 1);
    assert.deepEqual(input.previousFindings, ["Uniform convergence fails on the punctured interval"]);
   }
   const citedId = input.parents[0].sources[0];
   const {id: _id, ...critique} = assessment({id: "unused", sources: [citedId]});
   return answer({review: null, outcome: "Found a follow-up.", proposals: [{idea: hypothesis(source(citedId), title),
    assessment: {...critique, verdict: "defer", feedback: critiqueFeedback}}], insights: [{
     kind: "counterexample", finding: "Uniform convergence fails on the punctured interval",
     justification: "At x = 1/n the error remains one half, so the supremum cannot tend to zero.", sources: [citedId],
    }]});
  }]);
  assert.equal((await post(branch)).status, 202);
  const result = await settled();
  assert.equal(result.job?.status, "done", result.job?.error);
  assert(result.board?.some(o => o.id === card.id));
  assert.deepEqual(result.board?.find(o => o.title === title)?.parents, [card.id]);
  assert.equal(result.job?.progress?.stop, "branch-complete");
  assert.equal(result.job?.progress?.rounds[0]?.progress?.information, index ? 0 : 2);
  assert.equal(calls, count + index + 1);
 }
 assert((await get()).board?.some(o => o.title === "A connected branch"));


});


const critiqueFeedback = {
 mechanism: "Local comparison", failureMechanism: "",
 unresolvedAssumptions: ["Dimension-independent norm"],
 alternativeMechanisms: ["Duality"], evidenceNeeded: ["A comparison inequality"],
};

function adaptiveFixture() {
 const seed = source("known", {title: "Local bound", links: ["related"]});
 const related = source("related", {title: "Comparison inequality"});
 const remote = source("remote", {title: "An independent neighborhood"});
 const settings = {...ADAPTIVE_DEFAULTS};
 const ledger = planDiscovery([seed, related, remote], "Investigate local bounds", 50_000, undefined, [], {settings, preferences: {}});
 ledger.packets = [frontierPacket([seed], [{kind: "gap", sources: [seed.id]}], 2000)];
 const idea = {...hypothesis(seed, "Retain the strong bound"), id: "strong", exploration: false};
 const strong: FrontierOpportunity = {idea, assessment: {...assessment(idea), verdict: "pursue", feedback: critiqueFeedback}};
 ledger.assessed = [strong];
 ledger.selected = ["strong"];
 ledger.ranked = true;
 return {ledger, strong, remote};
}

test("adaptive priorities reserve uncovered evidence and honor cost, feedback and stopping thresholds", () => {
 const {ledger, strong} = adaptiveFixture();
 const chosen = chooseFrontierAction(ledger, 0);
 assert(typeof chosen !== "string");
 assert.equal(chosen.kind, "explore");
 assert.equal(chooseFrontierAction(ledger, ledger.budget - 1), "budget");
 const a = ledger.adaptive!;
 a.rounds.push({action: chosen, evidence: ["related", "remote"], outcome: "No new direction.", opportunities: [], reportedTokens: 1000, estimatedUnreported: 0, gain: 0});
 const targeted = chooseFrontierAction(ledger, 1000);
 assert(typeof targeted !== "string");
 assert.deepEqual(targeted.parents, [strong.idea.id]);
 a.preferences[strong.idea.id] = "revisit";
 assert.equal(chooseFrontierAction(ledger, 1000), "no-action");
 a.preferences[strong.idea.id] = "interested";
 a.rounds.push({action: targeted, evidence: ["known"], outcome: "No improvement.", opportunities: [], reportedTokens: 1000, estimatedUnreported: 0, gain: 0});
 assert.equal(chooseFrontierAction(ledger, 2000), "no-recovery");
 assert.deepEqual(adaptivePortfolio(ledger), [strong.idea.id]);
 a.preferences[strong.idea.id] = "dismiss";
 assert.deepEqual(adaptivePortfolio(ledger), []);
});

test("productive auto-discovery continues past the former six-round cap until the budget is tight", () => {
 const {ledger} = adaptiveFixture();
 const adaptive = ledger.adaptive!;
 const action = {kind: "explore" as const, key: "previous", label: "Prior exploration", anchors: ["known"],
  parents: [], estimate: 4000, priority: 3};
 adaptive.rounds = Array.from({length: 6}, () => ({action, evidence: ["known"], outcome: "Useful finding.",
  opportunities: [], gain: 4, reportedTokens: 4000, estimatedUnreported: 0}));
 const estimate = () => 4000;
 assert(typeof chooseFrontierAction(ledger, 24_000, estimate) !== "string");
 assert.equal(chooseFrontierAction(ledger, 24_000, estimate, true), "iterations");
 assert.equal(chooseFrontierAction(ledger, ledger.budget - 3999, estimate), "budget");
});

test("information gain credits grounded eliminations once, even when portfolio value falls", () => {
 const insight = {kind: "elimination" as const, finding: "Uniform convergence fails on the punctured interval",
  justification: "At x = 1/n the error remains one half, so the supremum cannot tend to zero.", sources: ["known"]};
 const evidence = new Set(["known"]);
 const gain = frontierProgress(-5, [insight, {...insight, finding: "Uniform convergence fails on the punctured interval."},
  {...insight, sources: ["unknown"]}], [], evidence);
 assert.deepEqual(gain, {portfolioDelta: -5, information: 2, total: 2, insights: [insight]});
 assert.equal(frontierProgress(3, [insight], [insight], evidence).total, 3);
 assert.equal(frontierProgress(0, [{...insight, justification: insight.finding}], [], evidence).total, 0);
 const lower = {...insight, finding: "The boundary eigenvalue is strictly bounded by x < y"};
 const upper = {...insight, finding: "The boundary eigenvalue is strictly bounded by x > y",
  justification: "A reversed test vector in the Rayleigh quotient gives the strict opposite bound."};
 assert.equal(frontierProgress(0, [upper], [lower], evidence).information, 2);

});

test("stagnation switches once to a fresh neighborhood, while overlap discounts other action keys", () => {
 const {ledger, strong} = adaptiveFixture();
 const adaptive = ledger.adaptive!;
 adaptive.seeds = [{kind: "gap", sources: ["remote"]}];
 const round = {evidence: ["known"], outcome: "No improvement.", opportunities: [], gain: 0, reportedTokens: 1000, estimatedUnreported: 0};
 const local = {kind: "exploit" as const, key: "prior exploit", label: "Local", anchors: ["known"], parents: [strong.idea.id], estimate: 4000, priority: 3};
 adaptive.rounds.push({...round, action: local});
 adaptive.seeds = [];
 const flat = () => 4000;
 const repeated = chooseFrontierAction(ledger, 1000, flat);
 assert(typeof repeated !== "string");
 assert.notEqual(repeated.key, local.key);
 assert.equal(repeated.overlap, 1);
 assert.equal(repeated.penalty, 2 / 3);
 adaptive.rounds[0] = {...round, action: {...local, anchors: ["remote"], parents: []}, evidence: ["remote"], opportunities: [strong]};
 const repeatedFamily = chooseFrontierAction(ledger, 1000, flat);
 assert(typeof repeatedFamily !== "string");
 assert.equal(repeatedFamily.overlap, 1);
 adaptive.rounds[0] = {...round, action: local};

 adaptive.rounds.push({...round, action: {...local, key: "another action"}});
 adaptive.seeds = [{kind: "gap", sources: ["remote"]}];
 const recovery = chooseFrontierAction(ledger, 2000, flat);
 assert(typeof recovery !== "string" && recovery.recovery);
 assert.deepEqual(recovery.anchors, ["remote"]);
 assert.equal(chooseFrontierAction(ledger, ledger.budget - 3999, flat), "no-recovery");
 assert.equal(chooseFrontierAction(ledger, 2000, flat, true), "converged");
 adaptive.rounds.push({...round, action: recovery, evidence: ["remote"]});
 assert.equal(chooseFrontierAction(ledger, 3000, flat), "recovery-exhausted");
 adaptive.rounds.at(-1)!.progress = {portfolioDelta: 0, information: 2, total: 2, insights: []};
 assert(typeof chooseFrontierAction(ledger, 3000, flat) !== "string");
});

test("stagnation can cross a known boundary into a mostly fresh neighborhood", () => {
 const {ledger, strong} = adaptiveFixture();
 const a = ledger.adaptive!;
 a.catalog = [...a.catalog.map(item => item.id === "remote" ? {...item, links: ["known", "fresh"]} : item), source("fresh")];
 a.seeds = [{kind: "gap", sources: ["remote"]}];
 const action = {kind: "deepen" as const, label: "Local", key: "local", anchors: ["known"],
  parents: [strong.idea.id], estimate: 4000, priority: 3};
 a.rounds = ["before", "after"].map(key => ({action: {...action, key}, evidence: ["known"],
  outcome: "No improvement.", opportunities: [], gain: 0, reportedTokens: 1000, estimatedUnreported: 0}));
 const result = chooseFrontierAction(ledger, 2000, () => 4000);
 assert(typeof result !== "string" && result.recovery);
 assert.deepEqual(result.anchors, ["remote"]);
 assert.equal(result.overlap, 2);
});

test("adaptive policy surfaces each focused action when its evidence supports it", () => {
 for (const kind of ["exploit", "reformulate", "combine", "challenge", "deepen"] as const) {
  const {ledger, strong} = adaptiveFixture();
  const a = ledger.adaptive!;
  ledger.packets = [{seeds: [], evidence: a.catalog, omitted: 0}];
  const feedback = {...critiqueFeedback, alternativeMechanisms: [], unresolvedAssumptions: [], evidenceNeeded: []};
  strong.assessment = {...strong.assessment, feedback, support: 4};
  if (kind === "reformulate") strong.assessment.verdict = "reject";
  if (kind === "exploit") strong.assessment.feedback!.alternativeMechanisms = ["Duality"];
  if (kind === "challenge") strong.assessment.support = 1;
  if (kind === "deepen") strong.assessment.feedback!.evidenceNeeded = ["A sharp bound"];
  if (kind === "combine") {
   ledger.assessed.push({idea: {...strong.idea, id: "second", sources: ["related"]}, assessment: {
    ...strong.assessment, id: "second", sources: ["related"], feedback: {...feedback, mechanism: "Separate mechanism"},
   }});
  }
  const selected = chooseFrontierAction(ledger, 0);
  assert(typeof selected !== "string", `Expected ${kind}, got ${selected}`);
  assert.equal(selected.kind, kind);
 }
});

test("adaptive checkpoints resume the same action without replaying stages and retain stronger findings", async () => {
 const {ledger, strong} = adaptiveFixture();
 const faux = createFauxCore({});
 const engine = {model: faux.getModel(), streamFn: faux.streamSimple};
 const base = {engine, history: [], signal: AbortSignal.timeout(5000), idFor: frontierIdeaId};
 let checkpoint: FrontierLedger | undefined;
 await assert.rejects(runFrontier({...base, ledger, save: patch => {
  if (patch.frontier?.adaptive?.pending) {
   checkpoint = JSON.parse(JSON.stringify(patch.frontier));
   throw new Error("Interrupted after planning");
  }
 }}), /Interrupted after planning/);
 assert(checkpoint);
 let calls = 0;
 let text = "";
 let usage;
 const first = checkpoint.adaptive!.pending!.action;
 faux.setResponses(Array.from({length: 10}, (): FauxResponseStep => context => {
  calls++;
  const current = context.messages.at(-1)!;
  assert(current.role === "user" && typeof current.content === "string");
  const input = JSON.parse(current.content);
  if (calls === 1) {
   assert.deepEqual(input.action.anchors, first.anchors);
   text = input.evidence[0].id;
   const {id: _id, ...critique} = assessment({id: "unused", sources: [text]});
   return answer({review: null, outcome: "Found a weaker candidate.", proposals: [{idea: hypothesis(source(text), "Secondary bound"),
    assessment: {...critique, support: 1, usefulness: 1, feedback: {...critiqueFeedback, mechanism: "Other mechanism"}}}]});
  }
  return answer({review: null, proposals: [], outcome: "No stronger alternative."});
 }));
 const final = await runFrontier({...base, ledger: checkpoint, save: patch => {if (patch.usage) usage = patch.usage;}});
 assert.equal(final.adaptive!.rounds[0]!.action.key, first.key);
 assert(final.adaptive!.rounds[0]!.evidence.includes(text));
 assert(final.adaptive!.stop);
 const completedCalls = calls;
 assert.equal(completedCalls, final.adaptive!.rounds.length);
 assert(frontierTokens(usage) > 0);
 assert.equal(final.selected[0], strong.idea.id);
 assert.deepEqual(final.assessed.find(o => o.idea.id === strong.idea.id), strong);
 const noMoney = {...checkpoint, budget: 1, adaptive: {...checkpoint.adaptive!, stop: undefined, rounds: []}};
 await runFrontier({...base, ledger: noMoney, save() {}});
 assert.equal(noMoney.adaptive.stop, "budget");
 assert.equal(calls, completedCalls);
});

test("a targeted call records sourced information even when it submits no hypothesis", async () => {
 const {ledger} = adaptiveFixture();
 const faux = createFauxCore({});
 faux.setResponses([context => {
  const last = context.messages.at(-1)!;
  assert(last.role === "user" && typeof last.content === "string");
  const input = JSON.parse(last.content);
  ledger.adaptive!.settings.minValue = 10;
  return answer({review: null, proposals: [], outcome: "Found a counterexample.", insights: [{
   kind: "counterexample", finding: "Uniform convergence fails on the punctured interval",
   justification: "At x = 1/n the error remains one half, so the supremum cannot tend to zero.",
   sources: [input.action.anchors[0]],
  }]});
 }]);
 const result = await runFrontier({engine: {model: faux.getModel(), streamFn: faux.streamSimple},
  ledger, history: [], signal: AbortSignal.timeout(5000), idFor: frontierIdeaId, save() {}});
 const round = result.adaptive!.rounds[0]!;
 assert.equal(round.gain, 0);
 assert.equal(round.progress?.total, 2);
 assert.equal(round.progress.insights[0]?.kind, "counterexample");
 assert.equal(result.adaptive!.stop, "no-action");
});

test("same-source rejection requires a counterexample tied to the reviewed parent", async () => {
 for (const target of [undefined, "strong"]) {
  const {ledger, strong} = adaptiveFixture();
  const adaptive = ledger.adaptive!;
  adaptive.settings.minValue = 10;
  adaptive.pending = {reportedBefore: 0, unreportedBefore: 0, action: {
   kind: "challenge", key: "challenge", label: strong.idea.title, anchors: ["known"], parents: [strong.idea.id], estimate: 4000, priority: 3,
  }};
  const faux = createFauxCore({});
  faux.setResponses([() => answer({review: {...strong.assessment, verdict: "reject",
   feedback: {...critiqueFeedback, failureMechanism: "The supremum error is bounded away from zero."}},
   proposals: [], outcome: "Found a counterexample.", insights: [{kind: "counterexample", target,
    finding: "Uniform convergence fails on the punctured interval",
    justification: "At x = 1/n the error remains one half, so the supremum cannot tend to zero.", sources: ["known"],
   }]})]);
  const result = await runFrontier({engine: {model: faux.getModel(), streamFn: faux.streamSimple},
   ledger, history: [], signal: AbortSignal.timeout(5000), idFor: frontierIdeaId, save() {}});
  assert.equal(result.assessed[0]?.assessment.verdict, target ? "reject" : "pursue");
  assert.equal(result.adaptive!.rounds[0]!.progress?.total, 2);
 }
});
