import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep} from "@earendil-works/pi-ai";
import {initialLesson} from "../src/core/learning-session.ts";
import {FRONTIER_SCOPE, frontierPacket, frontierTokens, type FrontierSource, type FrontierState} from "../src/core/research-frontier.ts";
import {frontierIdeaId, frontierRevision, planDiscovery} from "../src/core/frontier-plan.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-frontier-"));
process.env.LH_DATA_DIR = path.join(root, "data");
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
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
  if (input.candidates) {
   critiqueCandidates.push(input.candidates.map((c: {sources: string[]}) => c.sources[0]));
   return answer({assessments: input.candidates.map((c: {id: string; sources: string[]}) => assessment(c))});
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
  frontier: {...prior, generated: prior.packets.length, ranked: false, deepened: true, candidates: [], assessed: []}});
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
});
