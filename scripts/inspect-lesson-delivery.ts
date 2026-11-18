/** Read-only, content-free delivery audit. Usage: npx tsx scripts/inspect-lesson-delivery.ts /path/to/chat.json */
import fs from 'node:fs';
import {userFacingTextOf} from '../src/core/native-messages.ts';
import type {ChatRecord} from '../src/core/contracts/chat.ts';
const file = process.argv[2];
if (!file) throw new Error('Pass a saved native chat JSON path. This audit never changes the record.');
const chat = JSON.parse(fs.readFileSync(file, 'utf8')) as ChatRecord;
const tools: Record<string, number> = {};
let acknowledgementTurns = 0, userTurns = 0, modelResponses = 0, successfulMapWrites = 0;
let reportedModelDurationMs = 0, responsesWithDuration = 0;
for (const message of chat.messages) {
    if (message.role === 'user') {
        userTurns++;
        if (/^(ok(?:ay)?|yes|yep|got it|next|continue|sure|thanks)[.!\s]*$/i.test(userFacingTextOf(message.content).join(' ').trim())) acknowledgementTurns++;
    }
    if (message.role === 'assistant') {
        modelResponses++;
        const duration = (message as typeof message & {durationMs?: number}).durationMs;
        if (typeof duration === 'number') {reportedModelDurationMs += duration; responsesWithDuration++;}
        for (const part of message.content) if (part.type === 'toolCall') tools[part.name] = (tools[part.name] ?? 0) + 1;
    }
    if (message.role === 'toolResult' && !message.isError && ['edit_lesson', 'update_lesson'].includes(message.toolName)) successfulMapWrites++;
}
const steps = (chat.turns ?? []).flatMap(t => t.steps);
console.log(JSON.stringify({
    messages: chat.messages.length, userTurns, acknowledgementTurns, modelResponses, admittedModelSteps: steps.length,
    toolCalls: Object.values(tools).reduce((a, b) => a + b, 0), tools, successfulMapWrites,
    reportedTokens: steps.reduce((n, s) => n + (s.inputTokens ?? 0) + (s.outputTokens ?? 0) + (s.cacheReadTokens ?? 0) + (s.cacheWriteTokens ?? 0), 0),
    reportedModelDurationMs, responsesWithDuration,
    measuredTurns: (chat.turns ?? []).filter(t => t.delivery).map(t => ({id: t.id, ...t.delivery})),
    limits: 'Historical first-text/complete-turn timings are unknown when delivery is absent. Model durations are provider-reported, not wall-clock turn duration. Token totals depend on admitted provider reports. First-text is a server text-presence proxy, not semantic usefulness or browser paint. No prefetch in stage 1.',
}, null, 2));
