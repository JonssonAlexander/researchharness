import {userFacingTextOf} from '../core/native-messages.ts';
import type {LessonDeliveryMetrics} from '../core/contracts/chat.ts';
import type {TurnWireEvent} from './pi/ui-stream.ts';

/** Diagnostic only: no prompts, decisions or persistence side effects. */
export function lessonDelivery(start: number, inputText: string, now = () => performance.now()) {
    let firstTextMs: number | null = null, modelResponses = 0, successfulMapWrites = 0;
    const toolCalls: Record<string, number> = {};
    return {
        observe(event: TurnWireEvent) {
            if (event.type === 'tool_execution_start') toolCalls[event.toolName] = (toolCalls[event.toolName] ?? 0) + 1;
            if (event.type === 'tool_execution_end' && !event.isError && ['edit_lesson', 'update_lesson'].includes(event.toolName)) successfulMapWrites++;
            if (event.type !== 'message_update' && event.type !== 'message_end') return;
            if (event.message.role !== 'assistant') return;
            if (event.type === 'message_end') modelResponses++;
            if (firstTextMs === null && userFacingTextOf(event.message.content).length) firstTextMs = Math.max(0, now() - start);
        },
        finish(aborted: boolean): LessonDeliveryMetrics {
            return {schemaVersion: 1, firstTextMs, totalMs: Math.max(0, now() - start), modelResponses,
                toolCalls: {...toolCalls}, successfulMapWrites, aborted,
                acknowledgementInput: /^(ok(?:ay)?|yes|yep|got it|next|continue|sure|thanks)[.!\s]*$/i.test(inputText.trim())};
        },
    };
}
