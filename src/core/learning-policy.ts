import { z } from 'zod';
/** Personal learning observations, never canonical mathematical truth. */
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), text = z.string().trim().min(1).max(2000);
export const learningAction = z.enum(['explain', 'predict', 'reconstruct', 'connect', 'challenge', 'retrieve', 'continue']);
export const learningTarget = z.object({ id: key, revision: z.number().int().positive(), task: text, criterion: text, importance: z.enum(['central', 'supporting', 'peripheral']), topicIds: z.array(key).max(40), conceptIds: z.array(key).max(40), prerequisites: z.array(key).max(40), derivationIds: z.array(key).max(20).optional(), sources: z.array(z.object({ documentId: key, page: z.number().int().positive() }).strict()).max(20) }).strict();
export type LearningTarget = z.infer<typeof learningTarget>;
export const decisionContext = z.object({ targetId: key.optional(), intent: z.enum(['auto', 'explain', 'work', 'continue', 'connect']).default('auto'), importance: z.enum(['central', 'supporting', 'peripheral']), prerequisites: z.enum(['ready', 'gap', 'unknown']), understanding: z.enum(['uncertain', 'assisted', 'independent']), vulnerableAssumption: z.boolean(), revisit: z.boolean(), transferOpportunity: z.boolean(), predictionUseful: z.boolean(), effort: z.enum(['manageable', 'excessive', 'unknown']).optional(), diagnosticValue: z.enum(['useful', 'low', 'unknown']).optional(), reason: text }).strict();
export type DecisionContext = z.infer<typeof decisionContext>;
/** Explicit priorities, not a mastery score or fixed intervention frequency. */
export function decideLearning(c: DecisionContext): {
    action: z.infer<typeof learningAction>;
    reason: string;
} {
    const result = (action: z.infer<typeof learningAction>, reason: string) => ({ action, reason });
    if (c.intent === 'explain')
        return result('explain', 'Learner requested explanation.');
    if (c.intent === 'continue')
        return result('continue', 'Learner requested uninterrupted development.');
    if (c.intent === 'connect')
        return result('connect', 'Learner requested a connection.');
    if (c.prerequisites !== 'ready')
        return result('explain', 'Repair or clarify the prerequisite before independent work.');
    if (c.intent === 'work')
        return result('reconstruct', 'Learner requested independent work with reachable prerequisites.');
    if (c.effort === 'excessive')
        return result('explain', 'Scaffold the task before demanding costly independent reconstruction.');
    if (c.diagnosticValue === 'low' && c.importance !== 'central')
        return result('continue', 'The interruption offers little diagnostic value.');
    if (c.importance === 'peripheral')
        return result('continue', 'Protect time for the central mathematical objective.');
    if (c.vulnerableAssumption)
        return result('challenge', 'A boundary case can expose an important assumption.');
    if (c.transferOpportunity)
        return result('connect', 'Apply a known idea in a different setting; observe transfer separately.');
    if (c.revisit && c.understanding !== 'independent')
        return result('retrieve', 'Revisit without recent independent evidence.');
    if (c.understanding === 'independent')
        return result('continue', 'Avoid repeating an already demonstrated familiar step.');
    if (c.predictionUseful)
        return result('predict', 'A brief prediction has diagnostic value before the explanation.');
    return result('reconstruct', 'Important, reachable reasoning lacks independent evidence.');
}
export const evidenceInput = z.object({ id: key, targetId: key, kind: z.enum(['explanation', 'derivation', 'application', 'retrieval', 'correction']), messageIds: z.array(key).min(1).max(20), finding: text, outcome: z.enum(['supported', 'gap', 'uncertain']), assistance: z.enum(['none-observed', 'hint', 'explanation', 'solution', 'unknown']), delayed: z.boolean(), supersedes: key.optional() }).strict();
export type LearningEvidenceInput = z.infer<typeof evidenceInput>;
export const activityInput = z.object({ id: key, tabId: key, start: z.number().int().nonnegative(), end: z.number().int().positive(), state: z.enum(['interaction', 'waiting', 'hidden', 'idle']), surface: z.enum(['chat', 'reading', 'scratchpad', 'review']) }).strict().refine(v => v.end > v.start && v.end - v.start <= 35000, 'Activity intervals must be positive and at most 35 seconds.');
export type LearningActivity = z.infer<typeof activityInput>;
export interface LearningPolicyVersion {
    id: string;
    version: string;
    promptHash: string;
    appRevision: string;
    description: string;
}
export interface LearningEvent {
    id: string;
    at: string;
    type: 'policy' | 'turn' | 'target' | 'decision' | 'evidence' | 'activity';
    policyId: string | null;
    turnId?: string;
    context?: {topicId:string|null;derivationId:string|null;targetIds:string[];basis:string};
    policySpans?: {
        start: number;
        end: number;
        policyId: string | null;
    }[];
    sources?: {
        documentId: string;
        page: number;
        sha256: string;
    }[];
    model?: {
        provider: string;
        id: string;
        thinking: string;
    };
    data: unknown;
}
export interface LearningLedger {
    schemaVersion: 1;
    revision: number;
    events: LearningEvent[];
}
export interface LearningPolicyStore {
    list: () => string[];
    remove: (chatId: string) => void;
    read: (chatId: string) => LearningLedger;
    append: (chatId: string, event: LearningEvent) => LearningLedger;
}
export interface LearningPolicyService {
    read: (targetId?: string) => unknown;
    target: (input: LearningTarget) => unknown;
    decide: (input: DecisionContext) => unknown;
    evidence: (input: LearningEvidenceInput) => unknown;
    registerPrompt: (prompt: string, model?: {
        provider: string;
        id: string;
        thinking: string;
    }, tools?: string) => void;
}
export const LEARNING_POLICY_VERSION = '2026-11-15.1';
export const LEARNING_POLICY_GUIDANCE = `Learning policy ${LEARNING_POLICY_VERSION}: optimize retained mathematical understanding and transfer per active learning minute, not activity volume.
Build a small conceptual dependency map first: central question, objects, essential assumptions, key results and why each dependency is needed. Ordinary map lines and route order are not proof implications. Read relevant PDF pages and Atlas context; a saved concept is not evidence of understanding. For a long article, begin with main ideas and expand as needed; do not demand an exhaustive diagnostic test.
Use read_learning to recover agent-only targets, evidence and decisions after compaction. Maintain a small number of meaningful targets with set_learning_target: task, success criterion, importance, prerequisites and actual source pages. Targets may span several topics. Do not mechanically target every node or edge or display target bookkeeping to the learner. Coverage remains in the lesson map; personal evidence remains in the learning ledger.
Use choose_learning_action before a substantive change of teaching strategy, not once per sentence/node/tool. Supply honest uncertainty and learner intent; the deterministic policy returns a recommendation and records its rationale. Explain fluently without ready/OK gates, rigid cycles, question quotas or repetitive Socratic prompts. Respect requests for explanation, depth, uninterrupted development, independent work and tangents. Brief prediction only when informative; use a boundary case to expose a vulnerable assumption; retrieve or connect opportunistically. Do not interrupt an active reconstruction with fresh checks.
For central reachable ideas with uncertain understanding, offer substantial independent mathematical work spanning useful dependencies. Reuse saved Start/Finish derivations and scratchpad; specify permitted facts, wait for the actual attempt, then give the smallest helpful hint or requested explanation. No fixed exchange count, compulsory checkpoint or automatic completion. Missing prerequisites call for explanation or an example first. Demonstrated familiar reasoning can be passed over.
Use record_learning_evidence only for actual submitted learner messages/scratchpad attempts. Cite exact message IDs (read_learning lists recent eligible references); findings are AI assessments, not formal proof or mastery. Distinguish independent, hinted, explained and revealed work; if independence is unclear use unknown. Record gaps, corrections and later applications as well as successes. Cite supersedes to correct an earlier assessment; never erase history. Claims of delayed retrieval require an earlier recorded observation. Viewing, engagement, unsubmitted drawings and tutor explanations alone provide no understanding evidence. Do not claim mastery, retention improvement or causal efficiency from these observations. No canonical truth, FSRS schedule or Challenge outcome is changed by these tools.`;
/** Union across tabs; conservative classification precedence avoids counting a second tab's idle time as active. */
export function summarizeActivity(intervals: LearningActivity[]) {
    const priority = ['interaction', 'waiting', 'idle', 'hidden'] as const;
    const milliseconds = { interaction: 0, waiting: 0, hidden: 0, idle: 0 };
    const counts = { ...milliseconds };
    const endpoints = intervals.flatMap(i => [{ at: i.start, state: i.state, delta: 1 }, { at: i.end, state: i.state, delta: -1 }]).sort((a, b) => a.at - b.at);
    let previous = endpoints[0]?.at ?? 0;
    for (let i = 0; i < endpoints.length;) {
        const at = endpoints[i]!.at;
        const state = priority.find(s => counts[s] > 0);
        if (state) milliseconds[state] += at - previous;
        while (i < endpoints.length && endpoints[i]!.at === at) {
            const point = endpoints[i++]!;
            counts[point.state] += point.delta;
        }
        previous = at;
    }
    const observedMilliseconds = Object.values(milliseconds).reduce((n, value) => n + value, 0);
    const span = endpoints.length ? endpoints.at(-1)!.at - endpoints[0]!.at : 0;
    return { milliseconds, observedMilliseconds, unobservedWithinSpanMilliseconds: span - observedMilliseconds,
        interpretation: 'Interaction is an observable time proxy, not measured thinking or mastery. Idle/hidden and unobserved time may include real learning. Waiting can overlap off-keyboard thought.' };
}
