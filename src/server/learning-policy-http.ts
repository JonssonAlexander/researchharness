import { stores } from './stores.ts';
import { learningReport, learningTimeline, saveLearningActivity } from './learning-policy.ts';
import { requireSameOrigin } from './request-origin.ts';
import { readSourceBody } from './mindmaps.ts';
import {learningTarget} from '../core/learning-policy.ts';
import { AtlasError } from '../core/atlas.ts';
/** Inspectable local export; agent-only targets have no frontend presentation. */
export async function learningPolicyResponse(request: Request, chatId: string) {
    try {
        if (chatId !== 'review' && !stores.chatStore.getChat(chatId))
            throw new AtlasError('Session not found.', 404);
        if (request.method === 'GET')
            return Response.json({ ...learningReport(stores.learningPolicy, chatId), relatedHistory: learningHistory(chatId) }, { headers: { 'Cache-Control': 'private, no-store' } });
        requireSameOrigin(request);
        if (request.method !== 'POST')
            throw new AtlasError('Method not allowed.', 405);
        if (!request.headers.get('content-type')?.startsWith('application/json'))
            throw new AtlasError('Expected JSON.', 415);
        const input = JSON.parse((await readSourceBody(request, 8192)).toString('utf8'));
        if (input.action !== 'activity')
            throw new AtlasError('Unsupported learning action.');
        if (chatId !== 'review' && !stores.lessonStore.read(chatId))
            throw new AtlasError('Learning session not found.', 404);
        const plan=stores.lessonStore.read(chatId)?.plan,topicId=plan?.currentNodeId??null,derivationId=plan?.activeDerivationId??null;
        const targets=new Map(stores.learningPolicy.read(chatId).events.filter(e=>e.type==='target').map(e=>{const t=learningTarget.parse(e.data);return [t.id,t] as const;}));
        const targetIds=[...targets.values()].filter(t=>topicId&&t.topicIds.includes(topicId)).map(t=>t.id);
        saveLearningActivity(stores.learningPolicy, chatId, input.interval,undefined,{topicId,derivationId,targetIds,basis:'Estimated from saved lesson focus at interval receipt; not observed cognitive focus.'});
        return Response.json({ saved: true });
    }
    catch (e) {
        return Response.json({ error: e instanceof AtlasError ? e.message : e instanceof Error ? e.message : 'Learning record unavailable.' }, { status: e instanceof AtlasError ? e.status : 400 });
    }
}
/** Native histories remain authoritative; only references and outcomes cross the boundary, never secret solutions. */
export function learningHistory(chatId: string, conceptIds?: string[]) {
    const lesson = stores.lessonStore.read(chatId), ids = new Set(conceptIds ?? lesson?.plan.nodes.flatMap(n => n.conceptId ? [n.conceptId] : []) ?? []);
    const retrieval = stores.atlasStore.retrieval.items().filter(i => ids.has(i.conceptId)), activities = stores.atlasStore.retrieval.activities();
    return { retrieval: retrieval.flatMap(item => stores.atlasStore.retrieval.events(item.id).slice(-5).map(e => ({ source: 'FSRS self-rating', itemId: item.id, conceptId: item.conceptId, eventId: e.id, at: e.at, rating: e.rating, activityId: e.activityId, model: activities.find(a => a.id === e.activityId)?.model ?? 'unknown', policy: 'Native retrieval config', config: e.config, interpretation: 'Self-reported retrieval, not independent derivation or transfer.' }))),
        challenges: stores.problemStore.list().filter(p => p.conceptIds.some(id => ids.has(id))).flatMap(p => p.attempts.map(a => ({ source: 'Challenge outcome history', problemId: p.id, attemptId: a.id, chatId: a.chatId, conceptIds: p.conceptIds, events: a.events.map(({ at, status, reveal, defect }) => ({ at, status, reveal, defect })), interpretation: 'Recorded outcome and assistance/reveal history; not formal verification. Defective problems provide no ability conclusion.' }))),
        notice: 'Existing histories are referenced without copying answers or changing FSRS. Historical learning-policy attribution is unknown unless a recorded event explicitly provides it.' };
}
export function learningTimelineResponse() { return Response.json(learningTimeline(stores.learningPolicy), { headers: { "Cache-Control": "private, no-store" } }); }
