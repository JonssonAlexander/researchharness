import {lessonRoute, type LearningSession} from './learning-session.ts';
import type {Message} from '@earendil-works/pi-ai';

export const LESSON_CONTEXT_LIMIT = 24000;
/** A request-local projection, never another saved plan or learner message. */
export function lessonContext(lesson: LearningSession | null, originalGoal: string | null = null, history: readonly Message[] = []) {
    if (!lesson) return {status: 'unavailable', instruction: 'Do not edit or infer a lesson that is no longer available.'};
    const {plan} = lesson;
    const route = lessonRoute(plan);
    const active = plan.derivations.find(d => d.id === plan.activeDerivationId);
    const focus = plan.nodes.find(n => n.id === plan.currentNodeId);
    const head = focus?.parentId ?? focus?.id;
    const index = head ? route.indexOf(head) : -1;
    const goalMessageIndex = originalGoal === null || originalGoal === plan.objective ? -1
        : history.filter(message => message.role === 'user').findIndex(message =>
            typeof message.content === 'string'
            ? message.content.trim() === originalGoal
            : message.content.some(part => part.type === 'text' && part.text.trim() === originalGoal));
    // A working exercise is not permission to continue past it or reveal its solution.
    const candidates = [...new Set([focus?.id, active?.nodeId, head, ...(active?.status !== 'working' && index >= 0 ? route.slice(index + 1, index + 3) : [])].filter((id): id is string => !!id))];
    const snapshot = {
        revision: lesson.revision, status: lesson.status,
        currentNodeId: plan.currentNodeId, activeDerivationId: plan.activeDerivationId,
        objective: plan.objective,
        originalGoal: originalGoal === plan.objective ? {from: 'objective'}
            : goalMessageIndex >= 0 ? {from: 'retainedUserMessage', number: goalMessageIndex + 1} : originalGoal,
        route: route.map(id => {
            const {title, progress} = plan.nodes.find(n => n.id === id)!;
            return {id, title, progress: progress ?? 'upcoming'};
        }),
        activeDerivation: active ?? null,
        topics: [] as typeof plan.nodes,
        completeTopicIds: [] as string[],
        omittedTopicIds: plan.nodes.map(n => n.id),
        connections: [] as typeof plan.connections,
    };
    // Keep the roadmap and active mathematics whole; the budget applies to optional context.
    const fits = (value: typeof snapshot) => JSON.stringify(value).length <= LESSON_CONTEXT_LIMIT;
    for (const id of candidates) {
        const topic = plan.nodes.find(n => n.id === id);
        if (!topic) continue;
        const next = {...snapshot, topics: [...snapshot.topics, topic], completeTopicIds: [...snapshot.completeTopicIds, id], omittedTopicIds: snapshot.omittedTopicIds.filter(k => k !== id)};
        if (id === focus?.id || id === active?.nodeId || fits(next)) Object.assign(snapshot, next);
    }
    // Only actual saved associations near supplied topics; the route is not a dependency graph.
    for (const edge of plan.connections.filter(e => snapshot.completeTopicIds.includes(e.from) || snapshot.completeTopicIds.includes(e.to))) {
        const next = {...snapshot, connections: [...snapshot.connections, edge]};
        if (fits(next)) snapshot.connections.push(edge);
    }
    return snapshot;
}

export function lessonContextText(lesson: LearningSession | null, originalGoal: string | null = null, history: readonly Message[] = []): string {
    return `Fresh lesson-state snapshot (application planning data). Keep the original goal in view while following the current objective. A goal reference names the objective or a user-role message by position from the start of retained history (1-based). A null goal is unavailable. Use this revision for live state and read_lesson for omitted notes. Route order shows teaching order; progress records coverage.\n${JSON.stringify(lessonContext(lesson, originalGoal, history))}`;
}
