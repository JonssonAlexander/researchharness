import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { decideLearning, learningTarget, decisionContext, evidenceInput, activityInput, summarizeActivity, LEARNING_POLICY_VERSION, type LearningPolicyStore, type LearningPolicyService, type LearningEvent, type LearningTarget, type LearningEvidenceInput } from '../core/learning-policy.ts';
import type { LhMessage } from '../core/native-messages.ts';
import type { LearningSession } from '../core/learning-session.ts';
import type { LessonDocument } from '../core/lesson-documents.ts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
let revision: string | undefined;
function appRevision() { if (revision)
    return revision; try {
    return revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 1000 }).trim();
}
catch {
    return revision = 'unavailable';
} }
export interface LearningPolicyDeps {
    store: LearningPolicyStore;
    messages: () => LhMessage[];
    lesson: () => LearningSession | null;
    documents: () => Pick<LessonDocument, "id" | "hash" | "pages">[];
    scratchExists: (id: string) => boolean;
    conceptExists?: (id: string) => boolean;
    history?: (ids: string[]) => unknown;
    clock?: () => Date;
}
/** Personal learning ledger: injected data readers; no canonical math or scheduling writes. */
export function createLearningPolicyService(chatId: string, turnId: string, model: {
    provider: string;
    id: string;
    thinking: string;
}, deps: LearningPolicyDeps): LearningPolicyService {
    const now = () => (deps.clock?.() ?? new Date()).toISOString(), ledger = () => deps.store.read(chatId);
    let policyId: string | null = null;
    function append(type: LearningEvent['type'], data: unknown, id: string = randomUUID(), sources?: LearningEvent['sources']) { const prior = ledger().events.find(e => e.id === id); if (prior) {
        if (prior.type !== type || JSON.stringify(prior.data) !== JSON.stringify(data))
            throw new Error('Learning receipt conflicts with earlier work.');
        return prior;
    } const event: LearningEvent = { id, at: now(), type, policyId, turnId, model, data, ...sources ? { sources } : {} }; deps.store.append(chatId, event); return event; }
    function targets() { const map = new Map<string, LearningTarget>(); for (const e of ledger().events)
        if (e.type === 'target') {
            const t = learningTarget.parse(e.data);
            map.set(t.id, t);
        } return [...map.values()]; }
    function known(id: string) { const t = targets().find(t => t.id === id); if (!t)
        throw new Error('Unknown learning target. Read learning context first.'); return t; }
    function eligible() { return deps.messages().filter(m => m.role === 'user' || m.role === 'custom' && m.customType === 'scratchpad-attempt' && deps.scratchExists(m.id)); }
    function observations() { const events = ledger().events.filter(e => e.type === 'evidence'), replaced = new Set(events.map(e => (e.data as LearningEvidenceInput).supersedes).filter(Boolean)); return events.filter(e => !replaced.has(e.id)); }
    return {
        registerPrompt(prompt, actualModel, tools = "") { if (actualModel)
            model = actualModel; const promptHash = hash(prompt), toolsHash = hash(tools), app = appRevision(); policyId = `lp_${hash(LEARNING_POLICY_VERSION + promptHash + toolsHash + app).slice(0, 24)}`; const data = { id: policyId, version: LEARNING_POLICY_VERSION, promptHash, toolsHash, appRevision: app, effectivePrompt: prompt, toolConfiguration: tools, description: 'Evidence-aware fluent mathematical teaching; selective independent reconstruction; separate personal evidence and conservative time proxies.' }; append('policy', data, policyId); append('turn', { promptHash }, `turn_${turnId}`); },
        read(targetId) { const focus = deps.lesson()?.plan.currentNodeId, all = targets(), selected = targetId ? [known(targetId)] : all.filter(t => t.topicIds.includes(focus ?? "")).slice(-3); return { targetIndex: all.map(t => ({ id: t.id, revision: t.revision, task: t.task.slice(0, 140), importance: t.importance, topicIds: t.topicIds })), targets: selected, observations: observations().filter(e => !targetId || (e.data as LearningEvidenceInput).targetId === targetId).slice(-8).map(e => { const v = e.data as LearningEvidenceInput; return { id: e.id, at: e.at, model: e.model, targetId: v.targetId, kind: v.kind, outcome: v.outcome, assistance: v.assistance, delayed: v.delayed, finding: v.finding.slice(0, 600), messageIds: v.messageIds }; }), decisions: ledger().events.filter(e => e.type === 'decision').slice(-3), relatedHistory: deps.history?.([...new Set(selected.flatMap(t => t.conceptIds))]), eligibleSubmissions: eligible().slice(-20).map(m => ({ id: m.id, kind: m.role === 'custom' ? 'submitted-scratchpad' : 'learner-message', at: m.timestamp })), notice: 'Coverage is not understanding. No evidence means unknown; targets and AI assessments are agent planning data, not mathematical truth.' }; },
        target(raw) {
            const t = learningTarget.parse(raw);
            if (targets().length >= 80 && !targets().some(v => v.id === t.id))
                throw new Error('Refine existing targets rather than adding more than 80 in one lesson.');
            const old = targets().find(v => v.id === t.id);
            if (old && JSON.stringify(old) === JSON.stringify(t))
                return old;
            if (t.revision !== (old?.revision ?? 0) + 1)
                throw new Error('Target revision conflict. Read learning context before editing.');
            const plan = deps.lesson()?.plan;
            if (!plan || t.topicIds.some(id => !plan.nodes.some(n => n.id === id)))
                throw new Error('Use actual saved lesson topic IDs.');
            if (t.prerequisites.includes(t.id) || t.prerequisites.some(id => !targets().some(v => v.id === id)))
                throw new Error('Prerequisites must be other existing target IDs.');
            const all = [...targets().filter(v => v.id !== t.id), t], byId = new Map(all.map(v => [v.id, v]));
            function cycle(id: string, seen: Set<string>): boolean { if (seen.has(id))
                return true; return (byId.get(id)?.prerequisites ?? []).some(p => cycle(p, new Set([...seen, id]))); }
            if (cycle(t.id, new Set()))
                throw new Error('Target prerequisites must be acyclic.');
            if (deps.conceptExists && t.conceptIds.some(id => !deps.conceptExists!(id)))
                throw new Error('Use existing canonical concept IDs.');
            if (t.derivationIds?.some(id => !plan.derivations.some(d => d.id === id)))
                throw new Error('Use saved derivation IDs.');
            const docs = deps.documents();
            if (t.sources.some(s => !docs.some(d => d.id === s.documentId && s.page <= (d.pages ?? 1))))
                throw new Error('Use an attached source and its actual page range.');
            append('target', t, `target_${t.id}_${t.revision}`, t.sources.map(s => ({ ...s, sha256: docs.find(d => d.id === s.documentId)!.hash })));
            return { id: t.id, revision: t.revision };
        },
        decide(raw) {
            const c = decisionContext.parse(raw), t = c.targetId ? known(c.targetId) : null, prior = c.targetId ? observations().filter(e => (e.data as LearningEvidenceInput).targetId === c.targetId) : [];
            // The model may assess readiness, but may not invent recorded independent evidence.
            if (c.understanding === 'independent' && !prior.some(e => { const v = e.data as LearningEvidenceInput; return v.outcome === 'supported' && v.assistance === 'none-observed' && (!t || (e.data as {
                targetRevision?: number;
            }).targetRevision === t.revision); }))
                c.understanding = 'uncertain';
            if (t) {
                c.importance = t.importance;
                if (t.prerequisites.some(id => { const last = observations().filter(e => (e.data as LearningEvidenceInput).targetId === id).at(-1); return last && (last.data as LearningEvidenceInput).outcome === 'gap'; }))
                    c.prerequisites = 'gap';
            }
            const choice = decideLearning(c), event = append('decision', { context: c, ...choice, assessment: 'Readiness, diagnostic value and importance are tutor judgments, not calibrated measurements.' });
            return { id: event.id, ...choice };
        },
        evidence(raw) {
            const v = evidenceInput.parse(raw);
            const prior = ledger().events.find(e => e.id === v.id);
            if (prior) {
                const old = prior.data as LearningEvidenceInput & {
                    submitted?: LearningEvidenceInput;
                };
                if (prior.type !== 'evidence' || JSON.stringify(old.submitted) !== JSON.stringify(v))
                    throw new Error('Evidence receipt conflict.');
                return { id: prior.id, assistance: old.assistance, outcome: old.outcome };
            }
            const submitted = structuredClone(v);
            known(v.targetId);
            const messages = eligible();
            if (v.messageIds.some(id => !messages.some(m => m.id === id)))
                throw new Error('Evidence must reference actual submitted learner work in this session.');
            const earlier = ledger().events.filter(e => e.type === 'evidence' && (e.data as LearningEvidenceInput).targetId === v.targetId);
            if (v.delayed && !earlier.some(e => messages.some(m => v.messageIds.includes(m.id) && !(e.data as LearningEvidenceInput).messageIds.includes(m.id) && m.timestamp - Date.parse(e.at) >= 86400000)))
                throw new Error('Delayed retrieval needs an earlier observation at least a day ago. Record current work without delayed=true.');
            if (v.supersedes && !earlier.some(e => e.id === v.supersedes))
                throw new Error('Correction must reference an existing assessment of this target.');
            if (v.assistance === 'none-observed') {
                const last = earlier.at(-1), events = ledger().events, after = last ? events.slice(events.findIndex(e => e.id === last.id) + 1) : events;
                if (after.some(e => e.type === 'decision' && (e.data as {
                    context: {
                        targetId?: string;
                    };
                    action: string;
                }).context.targetId === v.targetId && ['explain'].includes((e.data as {
                    action: string;
                }).action)))
                    v.assistance = 'unknown';
            }
            const refs = v.messageIds.map(id => { const m = messages.find(m => m.id === id)!; return { messageId: id, sha256: hash(JSON.stringify(m)), kind: m.role === 'custom' ? 'submitted-scratchpad' : 'learner-message' }; });
            const allMessages = deps.messages(), lastIndex = Math.max(...v.messageIds.map(id => allMessages.findIndex(m => m.id === id))), contextMessageIds = allMessages.slice(Math.max(0, lastIndex - 12), lastIndex).filter(m => m.role === 'assistant').map(m => m.id);
            const event = append('evidence', { ...v, submitted, refs, contextMessageIds, evaluator: 'AI assessment; not formal verification', targetRevision: known(v.targetId).revision }, v.id);
            return { id: event.id, assistance: v.assistance, outcome: v.outcome };
        }
    };
}
export function learningReport(store: LearningPolicyStore, chatId: string) { const ledger = store.read(chatId), evidence = ledger.events.filter(e => e.type === 'evidence'), replaced = new Set(evidence.map(e => (e.data as LearningEvidenceInput).supersedes)), current = evidence.filter(e => !replaced.has(e.id)); const activity = ledger.events.filter(e => e.type === 'activity').map(e => activityInput.parse(e.data)); return { ...ledger, summary: { time: summarizeActivity(activity), targetTime: [...new Map(ledger.events.filter(e=>e.type==='target').map(e=>{const t=learningTarget.parse(e.data);return [t.id,t] as const;})).values()].map(t=>({targetId:t.id,task:t.task,time:summarizeActivity(ledger.events.filter(e=>e.type==='activity'&&e.context?.targetIds.includes(t.id)).map(e=>activityInput.parse(e.data))),interpretation:'Estimated association from saved focus at receipt; joint tasks may share time. Not time-to-mastery.'})), evidence: { observations: current.length, independentSupported: current.filter(e => { const v = e.data as LearningEvidenceInput; return v.outcome === 'supported' && v.assistance === 'none-observed'; }).length, delayedObservations: current.filter(e => (e.data as LearningEvidenceInput).delayed).length }, interpretation: 'Observational record only. AI judgments and self reports need context; no calibrated mastery, efficiency score or causal policy comparison. Missing delayed evidence remains unknown.' } }; }
export function saveLearningActivity(store: LearningPolicyStore, chatId: string, raw: unknown, at = new Date(), context?:LearningEvent['context']) {
    const data = activityInput.parse(raw);
    if (Math.abs(at.getTime() - data.end) > 120000)
        throw new Error('Activity interval is stale or clock is out of range.');
    const old = store.read(chatId), id = `activity_${data.tabId}_${data.id}`, prior = old.events.find(e => e.id === id);
    if (prior) {
        if (JSON.stringify(prior.data) !== JSON.stringify(data))
            throw new Error('Activity receipt conflict.');
        return;
    }
    const turns = old.events.filter(e => e.type === 'turn').sort((a, b) => a.at.localeCompare(b.at)), cuts = [data.start, ...turns.map(e => Date.parse(e.at)).filter(t => t > data.start && t < data.end), data.end], policySpans = cuts.slice(1).map((end, i) => ({ start: cuts[i]!, end, policyId: turns.filter(e => Date.parse(e.at) <= cuts[i]!).at(-1)?.policyId ?? null }));
    const policyId = new Set(policySpans.map(s => s.policyId)).size === 1 ? policySpans[0]!.policyId : null;
    store.append(chatId, { id, at: at.toISOString(), type: 'activity', policyId, policySpans, context, data });
}
/** Descriptive timeline, grouped by actual action policy; never a causal ranking. */
export function learningTimeline(store: LearningPolicyStore) {
    const sessions = store.list().map(id => ({ id, ...learningReport(store, id) })), events = sessions.flatMap(s => s.events.map(e => ({ ...e, chatId: s.id }))), policies = new Map<string, LearningEvent>();
    for (const e of events)
        if (e.type === 'policy')
            policies.set(e.id, e);
    const versions = [...new Set([...policies.values()].map(p=>(p.data as {version:string}).version))].map(version=>{
        const policyIds=[...policies.values()].filter(p=>(p.data as {version:string}).version===version).map(p=>p.id);
        const turns=events.filter(e=>e.type==='turn'&&e.policyId&&policyIds.includes(e.policyId));
        return {version,policyIds,turns:turns.length,sessions:[...new Set(turns.map(e=>e.chatId))],interpretation:'Exact prompt variants include lesson context. Group by semantic policy version when comparing teaching rules; inspect actual model and prompt snapshots for differences.'};
    });
    return { versions, policies: [...policies.values()].sort((a, b) => a.at.localeCompare(b.at)), sessions: sessions.map(s => ({ id: s.id, revision: s.revision, ...s.summary })), comparison: [...policies].map(([id, p]) => { const matching = events.filter(e => e.policyId === id); return { policyId: id, firstObservedAt: matching.map(e => e.at).sort()[0] ?? p.at, turns: matching.filter(e => e.type === 'turn').length, decisions: matching.filter(e => e.type === 'decision').map(e => ({ at: e.at, chatId: e.chatId, model: e.model, ...e.data as object })), evidence: matching.filter(e => e.type === 'evidence').map(e => ({ id: e.id, at: e.at, chatId: e.chatId, model: e.model, ...e.data as object })), time: summarizeActivity(events.filter(e => e.type === 'activity').flatMap(e => e.policySpans ? e.policySpans.filter(s => s.policyId === id).map(s => ({ ...activityInput.parse(e.data), start: s.start, end: s.end })) : e.policyId === id ? [activityInput.parse(e.data)] : [])) }; }), notice: 'Compare observations and source work qualitatively. Policy versions, learner selection, topic difficulty, assistance and missing delayed tests confound comparison. No causal benefit or calibrated mastery estimate is computed.' };
}
