import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initialLesson, learningInstructions, type LearningSession} from '../src/core/learning-session.ts';
import {lessonContext, lessonContextText, LESSON_CONTEXT_LIMIT} from '../src/core/lesson-context.ts';
import {asAgentMessages} from '../src/core/native-messages.ts';
import {newCompactionMarker} from '../src/core/compaction.ts';
import {lessonDelivery} from '../src/server/lesson-delivery.ts';
import {createLearningSessionStore} from '../src/store/learning-session.ts';
import {createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall} from '@earendil-works/pi-ai';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-delivery-'));
process.env.LH_DATA_DIR = path.join(root, 'data');
process.env.LH_AUTH_FILE = path.join(root, 'auth.json');
process.env.OPENROUTER_API_KEY = 'test-key-presence-gate';
after(() => fs.rmSync(root, {force: true, recursive: true}));
function lesson(): LearningSession {
    const plan = initialLesson('Connect covariance structure to estimation');
    plan.nodes[0] = {...plan.nodes[0]!, title: 'Separable covariance', notes: 'Use $B \\otimes A$ with stated factor order.', question: 'What does separability mean?'};
    for (const [id, title] of [['estimate', 'Estimate the factors'], ['risk', 'Estimation risk'], ['later', 'Other models']]) plan.nodes.push({id: id!, title: title!, notes: `Complete notes for ${id}.`, conceptId: null, tangent: false});
    plan.connections = [{from: 'topic_0', to: 'estimate'}];
    return {schemaVersion: 1, revision: 1, status: 'active', plan};
}
const {stores} = await import('../src/server/stores.ts');
const {createLearningAgent} = await import('../src/agent/teacher-agent.ts');
const {handleChatInput} = await import('../src/server/chat-handler.ts');
const {runningTurn} = await import('../src/server/turn-runs.ts');
function agentFor(id: string, store: ReturnType<typeof createLearningSessionStore>, faux: ReturnType<typeof createFauxCore>) {
    return createLearningAgent({chatId: id, chatStore: stores.chatStore, jobStore: stores.jobStore, spawn: () => {}}, store, () => {}, {learning: store.read(id)!, engine: {model: faux.getModel(), streamFn: faux.streamSimple}});
}
function snapshotIn(messages: unknown) {
    const encoded = JSON.stringify(messages);
    assert.match(encoded, /Fresh lesson-state snapshot/);
    return encoded;
}

test('bounded snapshot supplies current plus two route candidates with complete notes, never writes state', () => {
    const saved = lesson(), before = structuredClone(saved), s = lessonContext(saved);
    assert('topics' in s);
    assert.deepEqual(s.completeTopicIds, ['topic_0', 'estimate', 'risk']);
    assert.deepEqual(s.omittedTopicIds, ['later']);
    assert.equal(s.topics[0]!.notes, saved.plan.nodes[0]!.notes);
    assert.deepEqual(s.connections, saved.plan.connections);
    assert.deepEqual(saved, before);
    assert.equal(lessonContext(null).status, 'unavailable');
});

test('oversized context omits whole topics/targets explicitly instead of chopping equations or notes', () => {
    const saved = lesson(); saved.plan.nodes = Array.from({length: 40}, (_, i) => ({id: `topic_${i}`, title: '\\'.repeat(160), notes: '\\'.repeat(2000), conceptId: null, tangent: false}));
    saved.plan.objective = '\\'.repeat(4000);
    saved.plan.derivations = [{id: 'proof', nodeId: 'topic_0', title: 'Proof', start: '\u0001'.repeat(4000), finish: '\u0002'.repeat(4000), status: 'working'}];
    saved.plan.activeDerivationId = 'proof';
    const s = lessonContext(saved); assert('topics' in s);
    assert(JSON.stringify(s).length <= LESSON_CONTEXT_LIMIT);
    assert.equal(s.activeTargetNeedsRead, true);
    assert(!('start' in s.activeDerivation!));
    for (const n of s.topics) assert.equal(n.notes, saved.plan.nodes.find(t => t.id === n.id)!.notes);
});

test('working derivation retains complete Start/Finish and excludes automatic next-topic candidates', () => {
    const saved = lesson(); saved.plan.derivations = [{id: 'proof', nodeId: 'topic_0', title: 'Factor identity', start: 'Given $A,B$', finish: 'Show the tensor identity', status: 'working'}];
    saved.plan.activeDerivationId = 'proof';
    const s = lessonContext(saved); assert('topics' in s);
    assert.deepEqual(s.activeDerivation, saved.plan.derivations[0]);
    assert.deepEqual(s.completeTopicIds, ['topic_0']);
    assert.equal(s.activeTargetNeedsRead, false);
    assert.match(learningInstructions(saved), /wait for the independent attempt/);
});

test('request-local snapshot refreshes after learner edits and tool writes without entering history or the system prefix', async () => {
    const store = createLearningSessionStore(path.join(root, 'fresh')), first = store.create('fresh', lesson().plan);
    const prefix = learningInstructions(first), faux = createFauxCore({});
    const agent = agentFor('fresh', store, faux);
    // An edit after agent construction must be visible at the actual inference boundary.
    const changed = structuredClone(first.plan); changed.nodes[0]!.notes = 'Learner correction: preserve $B_{11}A$.';
    store.save('fresh', {expectedRevision: 1, status: 'active', plan: changed});
    faux.setResponses([
        context => {const s = snapshotIn(context.messages); assert(s.includes('Learner correction')); assert(s.includes('B_{11}A')); return fauxAssistantMessage([fauxToolCall('edit_lesson', {expectedRevision: 2, topics: [{id: 'estimate', notes: 'Updated estimation equation.'}]}, {id: 'batch'})], {stopReason: 'toolUse'});},
        context => {const s = snapshotIn(context.messages); assert(s.includes('Updated estimation equation')); return fauxAssistantMessage([fauxText('The covariance factors determine the estimator.')]);},
    ]);
    await agent.prompt('Connect these ideas.');
    assert.equal(store.read('fresh')!.revision, 3);
    assert.equal(learningInstructions(store.read('fresh')!), prefix);
    assert(!JSON.stringify(agent.state.messages).includes('Fresh lesson-state snapshot'));
    assert.equal(JSON.stringify(agent.state.messages).includes('Learner correction'), false);
    assert.equal(createLearningSessionStore(path.join(root, 'fresh')).read('fresh')!.revision, 3);
});

test('normal explanatory development streams two related concepts in one native call without map IO or acknowledgement', async () => {
    const chat = stores.chatStore.createChat('Connected development');
    stores.chatStore.saveSettings(chat.id, {model: {provider: 'openrouter', id: 'z-ai/glm-5.3-flash'}});
    stores.lessonStore.create(chat.id, lesson().plan);
    const faux = createFauxCore({}); let inferences = 0;
    faux.setResponses([context => {
        inferences++; const s = snapshotIn(context.messages);
        assert(s.includes('Separable covariance')); assert(s.includes('Estimate the factors'));
        return fauxAssistantMessage([fauxText('## Covariance structure\n$\\Sigma=B\\otimes A$ fixes the block pattern.\n\n## Estimation\nEstimate the factors under that constraint; normalization resolves scale ambiguity.')]);
    }]);
    const response = await handleChatInput(chat.id, {type: 'text', text: 'Teach the connected development.'}, opts => createLearningAgent({chatId: chat.id, chatStore: stores.chatStore, jobStore: stores.jobStore, spawn: () => {}}, stores.lessonStore, () => {}, {...opts, engine: {model: faux.getModel(), streamFn: faux.streamSimple}}));
    assert.equal(response.status, 200);
    const run = runningTurn(chat.id); if (run) await new Response(run.subscribe()).text();
    const record = stores.chatStore.getChat(chat.id)!;
    assert.equal(inferences, 1); assert.equal(record.messages.filter(m => m.role === 'user').length, 1);
    assert(!record.messages.some(m => m.role === 'toolResult'));
    assert.equal(stores.lessonStore.read(chat.id)!.revision, 1);
    assert(!JSON.stringify(record).includes('Fresh lesson-state snapshot'));
    const usage = record.turns!.at(-1)!;
    assert.equal(usage.steps.length, 1); assert.equal(usage.delivery!.modelResponses, 1);
    assert.equal(usage.delivery!.successfulMapWrites, 0);
    assert(usage.delivery!.firstTextMs !== null && usage.delivery!.totalMs >= usage.delivery!.firstTextMs!);
});

test('text is delivered before optional batched maintenance and stale writes preserve the learner edit', async () => {
    const store = createLearningSessionStore(path.join(root, 'conflict')); store.create('conflict', lesson().plan);
    const faux = createFauxCore({}), agent = agentFor('conflict', store, faux), events: string[] = [];
    agent.subscribe(e => {if (e.type === 'message_end' && e.message.role === 'assistant' && e.message.content.some(c => c.type === 'text')) events.push('text'); if (e.type === 'tool_execution_start') events.push('tool');});
    faux.setResponses([
        () => {
            const latest = store.read('conflict')!; const plan = structuredClone(latest.plan); plan.nodes[0]!.notes = 'New learner intuition.';
            store.save('conflict', {expectedRevision: 1, status: 'active', plan});
            return fauxAssistantMessage([fauxText('The shared scale explains both concepts.'), fauxToolCall('edit_lesson', {expectedRevision: 1, topics: [{id: 'topic_0', notes: 'Stale replacement'}]}, {id: 'stale'})], {stopReason: 'toolUse'});
        },
        context => {assert(snapshotIn(context.messages).includes('New learner intuition.')); return fauxAssistantMessage([fauxText('Your newer note is retained.')]);},
    ]);
    await agent.prompt('Explain and keep useful notes.');
    assert.deepEqual(events.slice(0, 2), ['text', 'tool']);
    assert.equal(store.read('conflict')!.revision, 2);
    assert.equal(store.read('conflict')!.plan.nodes[0]!.notes, 'New learner intuition.');
    assert(agent.state.messages.some(m => m.role === 'toolResult' && m.isError));
});

test('delivery timing ignores thinking/tool inputs and counts successful writes separately from failed calls', () => {
    let now = 100; const m = lessonDelivery(100, 'ok', () => now);
    now = 110; m.observe({type: 'tool_execution_start', toolCallId: 'r', toolName: 'read_lesson', args: {}});
    now = 120; m.observe({type: 'message_end', message: fauxAssistantMessage([fauxToolCall('read_lesson', {})], {stopReason: 'toolUse'})});
    now = 150; m.observe({type: 'message_update', message: fauxAssistantMessage([fauxText('A useful equation.')])});
    now = 180; m.observe({type: 'tool_execution_end', toolCallId: 'w', toolName: 'edit_lesson', result: {}, isError: true});
    m.observe({type: 'tool_execution_end', toolCallId: 'w2', toolName: 'edit_lesson', result: {}, isError: false});
    now = 200;
    assert.deepEqual(m.finish(true), {schemaVersion: 1, firstTextMs: 50, totalMs: 100, modelResponses: 1, toolCalls: {read_lesson: 1}, successfulMapWrites: 1, acknowledgementInput: true, aborted: true});
});

test('aborting an in-flight lesson never applies its late map proposal and fresh questions can resume', async () => {
    const store = createLearningSessionStore(path.join(root, 'abort')), first = store.create('abort', lesson().plan);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;}), started = new Promise<void>(resolve => {entered = resolve;});
    const faux = createFauxCore({}), agent = agentFor('abort', store, faux);
    faux.setResponses([async () => {entered(); await gate; return fauxAssistantMessage([fauxToolCall('edit_lesson', {expectedRevision: 1, topics: [{id: 'topic_0', notes: 'Late abandoned proposal'}]}, {id: 'late'})], {stopReason: 'toolUse'});}]);
    const work = agent.prompt('Explain the route.'); await started; agent.abort(); release(); await work;
    assert.deepEqual(store.read('abort'), first);
    const next = createFauxCore({}); next.setResponses([context => {snapshotIn(context.messages); return fauxAssistantMessage([fauxText('Let us address your interruption directly.')]);}]);
    await agentFor('abort', store, next).prompt('Actually, explain the factor ordering.');
    assert.deepEqual(store.read('abort'), first);
});

test('snapshot follows native compaction without retaining old mutable map state', async () => {
    const store = createLearningSessionStore(path.join(root, 'compacted')); store.create('compacted', lesson().plan);
    const faux = createFauxCore({}), agent = agentFor('compacted', store, faux);
    agent.state.messages.push(...asAgentMessages([
        {id: 'old', role: 'user', content: 'Old material to compact.', timestamp: 1},
        {id: 'kept', role: 'user', content: 'Continue the mathematical explanation.', timestamp: 2},
        newCompactionMarker('Prior context summarized.', {firstKeptMessageId: 'kept', tokensBefore: 1000, at: 'fixture'}),
    ]));
    faux.setResponses([context => {const s = snapshotIn(context.messages); assert(s.includes('Separable covariance')); assert(!s.includes('Old material to compact.')); assert(s.includes('Prior context summarized.')); assert.equal((s.match(/Fresh lesson-state snapshot/g) ?? []).length, 1); return fauxAssistantMessage([fauxText('The explanation continues from the current saved map.')]);}]);
    await agent.continue();
    assert(!JSON.stringify(agent.state.messages).includes('Fresh lesson-state snapshot'));
    assert.equal(store.read('compacted')!.revision, 1);
});
