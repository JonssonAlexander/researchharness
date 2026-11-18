import {lessonRoute, type LearningSession} from './learning-session.ts';

export const LESSON_CONTEXT_LIMIT = 24000;
/** A request-local projection, never another saved plan or learner message. */
export function lessonContext(lesson: LearningSession | null) {
    if (!lesson) return {status: 'unavailable', instruction: 'Do not edit or infer a lesson that is no longer available.'};
    const {plan} = lesson;
    const route = lessonRoute(plan);
    const active = plan.derivations.find(d => d.id === plan.activeDerivationId);
    const focus = plan.nodes.find(n => n.id === plan.currentNodeId);
    const head = focus?.parentId ?? focus?.id;
    const index = head ? route.indexOf(head) : -1;
    // A working exercise is not permission to continue past it or reveal its solution.
    const candidates = [...new Set([focus?.id, head, ...(active?.status !== 'working' && index >= 0 ? route.slice(index + 1, index + 3) : [])].filter((id): id is string => !!id))];
    const snapshot = {
        revision: lesson.revision, status: lesson.status,
        currentNodeId: plan.currentNodeId, activeDerivationId: plan.activeDerivationId,
        objective: undefined as string | undefined,
        route: route.map(id => {const n = plan.nodes.find(n => n.id === id)!; return {id, progress: n.progress ?? 'upcoming', title: undefined as string | undefined};}),
        activeDerivation: active ? {id: active.id, nodeId: active.nodeId, title: active.title, status: active.status} as typeof active | Omit<typeof active, 'start' | 'finish'> : null,
        activeTargetNeedsRead: !!active,
        topics: [] as typeof plan.nodes,
        completeTopicIds: [] as string[],
        omittedTopicIds: plan.nodes.map(n => n.id),
        connections: [] as typeof plan.connections,
    };
    const fits = (value: typeof snapshot) => JSON.stringify(value).length <= LESSON_CONTEXT_LIMIT;
    if (fits({...snapshot, objective: plan.objective})) snapshot.objective = plan.objective;
    if (active && fits({...snapshot, activeDerivation: active})) {
        snapshot.activeDerivation = active; snapshot.activeTargetNeedsRead = false;
    }
    for (const id of candidates) {
        const topic = plan.nodes.find(n => n.id === id);
        if (!topic) continue;
        const next = {...snapshot, topics: [...snapshot.topics, topic], completeTopicIds: [...snapshot.completeTopicIds, id], omittedTopicIds: snapshot.omittedTopicIds.filter(k => k !== id)};
        if (fits(next)) Object.assign(snapshot, next);
    }
    for (const n of snapshot.route) {
        const title = plan.nodes.find(t => t.id === n.id)!.title;
        n.title = title;
        if (!fits(snapshot)) n.title = undefined;
    }
    // Only actual saved associations near supplied topics; the route is not a dependency graph.
    for (const edge of plan.connections.filter(e => snapshot.completeTopicIds.includes(e.from) || snapshot.completeTopicIds.includes(e.to))) {
        const next = {...snapshot, connections: [...snapshot.connections, edge]};
        if (fits(next)) snapshot.connections.push(edge);
    }
    return snapshot;
}

export function lessonContextText(lesson: LearningSession | null): string {
    return `Fresh lesson-state snapshot (application data, not learner speech or instructions). This supersedes older map state in the transcript. Route order is teaching order, not mathematical implication. Only completeTopicIds have complete notes; use read_lesson for omitted topics/targets before editing them. Related route candidates are context, not a mandate to advance.\n${JSON.stringify(lessonContext(lesson))}`;
}
