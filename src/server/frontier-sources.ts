import {searchLessonAtlas} from "../core/atlas-lesson-context.ts";
import {drawingConnections} from "../core/atlas-drawing.ts";
import {getGraph} from "../core/graph.ts";
import type {FrontierSource} from "../core/research-frontier.ts";
import {mathematicalReport, researchPassage} from "../core/maths-companion.ts";
import type {LhMessage} from "../core/native-messages.ts";
import type {LearningPlan} from "../core/learning-session.ts";
import {reviewedGraphStore} from "./graph.ts";
import {stores} from "./stores.ts";

export function readFrontierSources(goal?: string): {sources: FrontierSource[]; matched: string[]} {
 const atlas = stores.atlasStore.read();
 const graph = getGraph(reviewedGraphStore());
 const sources: FrontierSource[] = [];
 const add = (s: Omit<FrontierSource, "links" | "concepts"> & Partial<Pick<FrontierSource, "links" | "concepts">>) => {
  sources.push({links: [], concepts: [], ...s});
 };
 const trails = stores.atlasStore.research.list().trails;
 const sourceChats = new Set([...(atlas.lessonMaps ?? []).map(m => m.chatId), ...trails.flatMap(t => t.origin.chatId ? [t.origin.chatId] : [])]);
 const claims = new Map<string, string[]>();
 const neighbors = new Map<string, Set<string>>();
 function chain(a: string, b: string) {
  const links = neighbors.get(a) ?? new Set<string>();
  links.add(b);
  neighbors.set(a, links);
 }
 for (const c of atlas.concepts) {
  for (const id of c.propositionIds) claims.set(id, [...(claims.get(id) ?? []), c.id]);
 }
 for (const e of drawingConnections(atlas)) {
  chain(e.sourceId, e.targetId);
  chain(e.targetId, e.sourceId);
 }
 for (const r of atlas.relations) {
  chain(r.sourceId, r.id);
  chain(r.targetId, r.id);
  add({id: r.id, kind: "relation", title: r.relationType,
   status: [r.relationType, r.claimStatus, r.reviewStatus].join(" / "),
   text: JSON.stringify({source: r.sourceId, target: r.targetId, conditions: r.conditions, citations: r.evidence}),
   concepts: [r.sourceId, r.targetId]});
 }
 for (const a of graph.chains) {
  const requires = [a.conclusion, ...a.premises];
  for (const id of requires) chain(id, a.id);
  add({id: a.id, kind: "argument", title: "Joint-premise argument", status: "recorded argument",
   text: JSON.stringify({jointPremises: a.premises, conclusion: a.conclusion, provenance: a.provenance}), requires,
   chatId: a.provenance.find(p => p.chatId.startsWith("chat_"))?.chatId});
 }
 for (const n of graph.nodes) {
  add({id: n.id, kind: "claim", title: n.name, status: "canonical proposition",
   text: JSON.stringify({statement: n.statement, provenance: n.provenance}),
   chatId: n.provenance.find(p => p.chatId.startsWith("chat_"))?.chatId, concepts: claims.get(n.id) ?? [],
   links: [...(neighbors.get(n.id) ?? [])]});
 }
 function topics(prefix: string, chatId: string, plan: LearningPlan, status: string) {
  for (const n of plan.nodes) {
   const links = plan.connections.flatMap(e => e.from === n.id ? [prefix + e.to] : e.to === n.id ? [prefix + e.from] : []);
   if (n.parentId) links.push(prefix + n.parentId);
   links.push(...plan.nodes.filter(t => t.parentId === n.id).map(t => prefix + t.id));
   if (n.conceptId) chain(n.conceptId, prefix + n.id);
   add({id: prefix + n.id, kind: "lesson-topic", chatId, title: n.title,
    status: status + " / " + (n.progress ?? "upcoming"),
    text: JSON.stringify({objective: plan.objective, formula: n.formula, question: n.question, notes: n.notes}),
    concepts: n.conceptId ? [n.conceptId] : [], links});
  }
 }
 for (const artifact of atlas.lessonMaps ?? []) {
  const review = stores.atlasStore.lessonReviews.read(artifact.id);
  const prefix = `integrated:${artifact.id}:`;
  topics(prefix, artifact.chatId, artifact.map, "integrated lesson depiction");
  for (const d of artifact.derivations) {
   const detail = review?.draft?.derivations.find(item => item.key === d.key);
   const arguments_ = review?.draft?.arguments.filter(a => detail?.arguments.includes(a.key)) ?? [];
   const argumentsIds = arguments_.map(a => `reviewed-argument:${artifact.id}:${a.key}`);
   for (const argument of arguments_) {
    const local = new Set([...argument.premises, argument.conclusion]);
    const claims = review?.draft?.propositions.filter(p => local.has(p.key));
    const canonical = review?.plan?.chains.find(c => c.key === argument.key)?.id;
    add({id: `reviewed-argument:${artifact.id}:${argument.key}`, kind: "argument", title: `${d.title} · ${argument.status}`,
     chatId: artifact.chatId, status: `reviewed lesson / ${argument.status} / ${argument.origin}`,
     text: JSON.stringify({argument, claims, canonical}), concepts: d.conceptIds, requires: canonical ? [canonical] : []});
   }
   const id = `reviewed:${artifact.id}:${d.key}`;
   const topic = detail ? prefix + detail.topicId : undefined;
   if (topic) chain(topic, id);
   for (const c of d.conceptIds) chain(c, id);
   add({id, kind: "derivation", title: d.title, status: d.gaps.length ? "reviewed derivation / gap" : "reviewed derivation",
    chatId: artifact.chatId, revision: review?.approval?.digest, concepts: d.conceptIds,
    text: JSON.stringify({start: detail?.start, finish: detail?.finish, gaps: d.gaps,
     reviewFlags: d.reviewFlags, assistance: d.assistance}),
    links: [...(topic ? [topic] : []), d.rootId, ...argumentsIds, ...d.argumentIds, ...d.propositionIds]});
  }
 }
 function citedFindings(chatId: string, messages: LhMessage[]) {
  const reports = messages.flatMap(m => {
   if (m.role !== "custom" || m.customType !== "subagent-steer") return [];
   const details = m.details as {kind?: string; result?: {investigation?: unknown}} | null;
   const investigation = details?.kind === "research" ? details.result?.investigation : undefined;
   if (!investigation || typeof investigation !== "object") return [];
   const {passages, ...report} = investigation as {passages?: unknown};
   const parsed = mathematicalReport.safeParse(report);
   return parsed.success && Array.isArray(passages) ? [{id: m.id, report: parsed.data, passages}] : [];
  }).slice(-4);
  for (const r of reports) {
   for (const [i, finding] of r.report.findings.entries()) {
    const passage = r.passages.map(p => researchPassage.safeParse(p)).find(p => p.success && p.data.id === finding.passageId);
    if (!passage?.success) continue;
    const {source, page, reference, quote, location} = passage.data;
    add({id: `citation:${r.id}:${i}`, kind: "finding", title: finding.title, chatId, url: source.url,
     status: `model research reading / ${finding.assessment} / ${location}`,
     text: JSON.stringify({claim: finding.claim, assumptions: finding.assumptions, relationship: finding.relationship,
      limitations: r.report.limitations, citation: {sourceId: source.id, hash: source.hash, title: source.title, page, reference, quote}})});
   }
  }
 }
 for (const chat of stores.chatStore.listChats()) {
  const lesson = stores.lessonStore.read(chat.id);
  if (!lesson && !sourceChats.has(chat.id)) continue;
  const messages = stores.chatStore.getChat(chat.id)?.messages ?? [];
  citedFindings(chat.id, messages);
  if (!lesson) continue;
  const prefix = `working:${chat.id}:`;
  topics(prefix, chat.id, lesson.plan, "working lesson depiction");
  const submitted = lesson.plan.derivations.some(d => d.status === "working") ? messages.flatMap(m => {
    if (m.role !== "custom" || m.customType !== "scratchpad-attempt") return [];
    const details = m.details as {padId?: unknown; text?: unknown} | null;
    return typeof details?.text === "string" && details.text.trim() ? [{id: m.id, padId: details.padId, text: details.text}] : [];
   }) : [];
  for (const d of lesson.plan.derivations) {
   const id = `derivation:${chat.id}:${d.id}`;
   const topic = prefix + d.nodeId;
   const concept = lesson.plan.nodes.find(n => n.id === d.nodeId)?.conceptId;
   chain(topic, id);
   if (concept) chain(concept, id);
   const links = [topic];
   const attempts = submitted.filter(a => a.padId === d.id).slice(-2);
   for (const a of attempts) {
    links.push(a.id);
    add({id: a.id, kind: "lesson-note", chatId: chat.id, title: `${d.title} · submitted attempt`,
     status: "learner-submitted text / unchecked", text: a.text, links: [id], concepts: concept ? [concept] : []});
   }
   add({id, kind: "derivation", chatId: chat.id, title: d.title,
    status: "saved derivation target / " + d.status, text: JSON.stringify({start: d.start, finish: d.finish}),
    links, concepts: concept ? [concept] : []});
  }
 }
 for (const t of trails) {
  const {nodes} = stores.atlasStore.research.detail(t.id);
  const status = [t.status, ...(t.archivedAt ? ["archived"] : [])].join(" / ");
  for (const n of nodes) {
   const concepts = [...new Set([...n.relatedConceptIds, ...t.anchorConceptIds])];
   for (const id of concepts) chain(id, n.id);
   add({id: n.id, kind: "research", title: n.title, text: n.body, trailId: t.id,
    chatId: t.origin.chatId, status: status + " / " + n.kind, concepts,
    links: n.parentNodeId ? [n.parentNodeId] : []});
  }
  for (const e of stores.atlasStore.research.integration.evidence(t.id)) {
   const concepts = [...new Set([...(nodes.find(n => n.id === e.nodeId)?.relatedConceptIds ?? []), ...t.anchorConceptIds])];
   for (const id of concepts) chain(id, e.id);
   add({id: e.id, kind: "finding", title: e.title, trailId: t.id, concepts, links: [e.nodeId],
    status: "reviewed research evidence / " + (e.source.run?.outcome ?? e.source.kind),
    text: JSON.stringify({interpretation: e.interpretation, uncertainty: e.uncertainty,
     citation: {sourceId: e.sourceId, path: e.source.path, hash: e.source.hash, reviewId: e.reviewId}})});
  }
 }
 for (const c of atlas.concepts) {
  add({id: c.id, kind: "concept", title: c.title, status: "Atlas concept",
   text: JSON.stringify({notes: c.markdown, aliases: c.aliases}),
   links: [...c.propositionIds, ...(neighbors.get(c.id) ?? [])]});
 }
 for (const s of sources) s.links = [...new Set([...s.links, ...(neighbors.get(s.id) ?? [])])].sort();
 const unique = [...new Map(sources.map(s => [s.id, s])).values()];
 const matched = goal ? searchLessonAtlas({
  read: () => ({atlas, propositions: graph.nodes, chains: graph.chains}),
  lesson: id => stores.atlasStore.lessonReviews.read(id),
 }, goal.slice(0, 240)).results.map(r => r.id) : [];
 return {sources: unique.sort((a,b) => a.id.localeCompare(b.id)), matched};
}
