import type {AgentMessage} from "@earendil-works/pi-agent-core";
import type {ImageContent, Message} from "@earendil-works/pi-ai";
import {activeCompactionOf, keptIndexFor} from "../core/compaction.ts";
import type {LearningSession} from "../core/learning-session.ts";
import {INTERRUPTED_TEXT, nativeInputCause, type LhMessage} from "../core/native-messages.ts";

export function historicalLessonImages(initial: readonly AgentMessage[]) {
    const start = initial.findLastIndex(message => nativeInputCause(message, initial) === "learner");
    return new Set(initial.slice(0, start < 0 ? initial.length : start).flatMap(message =>
        Array.isArray(message.content) ? message.content.filter(part => part.type === "image") : []));
}

function withoutHistoricalImages(projected: readonly Message[], historicalImages: ReadonlySet<ImageContent>): Message[] {
    return projected.map(message => {
        if ((message.role !== "user" && message.role !== "toolResult") || !Array.isArray(message.content) ||
            !message.content.some(part => part.type === "image" && historicalImages.has(part))) return message;
        return {...message, content: [
            ...message.content.filter(part => part.type !== "image" || !historicalImages.has(part)),
            {type: "text", text: "[Historical image omitted. Use the original attachment or source if its pixels are needed.]"},
        ]};
    });
}

function completeToolPairs(messages: readonly Message[]) {
    const pending = new Map<string, string>();
    for (const message of messages) {
        if (message.role === "toolResult") {
            if (pending.get(message.toolCallId) !== message.toolName ||
                message.content.some(part => part.type === "text" && part.text === INTERRUPTED_TEXT)) return false;
            pending.delete(message.toolCallId);
            continue;
        }
        if (pending.size) return false;
        if (message.role !== "assistant") continue;
        if (message.stopReason === "error" || message.stopReason === "aborted") return false;
        for (const part of message.content) {
            if (part.type !== "toolCall") continue;
            if (pending.has(part.id)) return false;
            pending.set(part.id, part.name);
        }
    }
    return pending.size === 0;
}

/** Operate on the existing post-compaction projection, never on the native record. */
export function selectLessonHistory(native: readonly AgentMessage[], projected: readonly Message[], options: {
    lesson: LearningSession | null;
    originalGoal: string | null;
    inputId?: string;
    canRetrieve: boolean;
    background?: boolean;
    historicalImages: ReadonlySet<ImageContent>;
}) {
    const fallback = (reason: string) => ({
        messages: withoutHistoricalImages(projected, options.historicalImages), reason, droppedMessages: 0,
    });
    if (options.background || !options.inputId || !options.canRetrieve) return fallback("no-eligible-input");
    const index = native.findIndex(message => (message as {id?: string}).id === options.inputId);
    const input = native[index];
    const text = input?.role === "user" ? typeof input.content === "string" ? input.content
        : input.content.length === 1 && input.content[0]?.type === "text" ? input.content[0].text : "" : "";
    if (!/^New standalone question:\s*\S/i.test(text)) return fallback("no-standalone-question");
    const lesson = options.lesson;
    if (!lesson || !options.originalGoal || lesson.plan.derivations.some(d => d.status === "working") ||
        lesson.plan.nodes.some(node => node.progress === "revisit")) return fallback("unresolved-lesson");
    if (native.slice(index + 1).some(message => nativeInputCause(message, native) !== "neutral")) return fallback("intervening-input");

    const history = native as readonly LhMessage[];
    const marker = activeCompactionOf(history);
    const kept = marker ? keptIndexFor(history, marker) : 0;
    if (kept < 0 || index < kept) return fallback("ambiguous-compaction");
    const head = (projected[0]?.role === "system" ? 1 : 0) + (kept > 0 ? 1 : 0);
    const matches = projected.flatMap((message, i) => message.role === "user" && input?.role === "user" &&
        message.timestamp === input.timestamp && message.content === input.content ? [i] : []);
    const cut = matches[0] ?? -1;
    if (matches.length !== 1 || cut < head) return fallback("ambiguous-boundary");
    if (cut === head) return fallback("nothing-to-drop");
    const dropped = projected.slice(head, cut);
    const retained = projected.slice(cut);
    if (dropped.some(message => message.role === "system")) return fallback("system-update");
    const previous = dropped.at(-1);
    if (previous?.role !== "assistant" || previous.stopReason !== "stop") return fallback("unclosed-exchange");
    if (!completeToolPairs(dropped) || !completeToolPairs(retained)) return fallback("open-tool-or-interruption");
    return {
        messages: withoutHistoricalImages([...projected.slice(0, head), ...retained], options.historicalImages),
        reason: "standalone-question", droppedMessages: dropped.length,
    };
}
