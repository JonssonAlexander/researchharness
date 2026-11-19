import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {Message} from '@earendil-works/pi-ai';
import {activeCompactionOf, estimateMessageTokens, keptIndexFor} from '../core/compaction.ts';
import type {LhMessage} from '../core/native-messages.ts';

/** Inspect the projected request without logging prompt text, images, or tool payloads. */
export function inspectLessonRequest(native: readonly AgentMessage[], projected: readonly Message[], snapshot: string) {
    const history = (native[0]?.role === 'system' ? native.slice(1) : native) as readonly LhMessage[];
    const marker = activeCompactionOf(history);
    const start = Math.max(0, marker ? keptIndexFor(history, marker) : 0);
    const estimatedTokens = {instructions: 0, tools: 0, compactionSummary: 0, conversation: 0, toolResults: 0, lessonSnapshot: Math.ceil(snapshot.length / 4)};
    let images = 0;
    let firstNonSystem = true;
    for (const message of projected) {
        if (message.role === 'system') {
            const {toolsAdded, ...instructions} = message;
            estimatedTokens.instructions += estimateMessageTokens(instructions);
            if (toolsAdded) estimatedTokens.tools += Math.ceil(JSON.stringify(toolsAdded).length / 4);
            continue;
        }
        const category = firstNonSystem && start > 0 ? 'compactionSummary' : message.role === 'toolResult' ? 'toolResults' : 'conversation';
        estimatedTokens[category] += estimateMessageTokens(message);
        firstNonSystem = false;
        if (Array.isArray(message.content)) images += message.content.filter(part => part.type === 'image').length;
    }
    return {
        estimatedTokens, estimatedInputTokens: Object.values(estimatedTokens).reduce((sum, n) => sum + n, 0), images,
        activeHistory: {
            startIndex: start, endIndexExclusive: history.length,
            firstId: history[start]?.id ?? null, lastId: history.at(-1)?.id ?? null,
            compactionMarkerId: start > 0 ? marker?.id : undefined,
        },
    };
}
