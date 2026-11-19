import {Type} from "typebox";
import {z} from "zod";
import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {LhMessage} from "../../core/native-messages.ts";
import {serverExecute} from "../tool-execute.ts";

const name = "read_chat_history";
const messageId = z.string().min(1).max(160);
const input = z.object({
    operation: z.enum(["read", "around", "search"]),
    ids: z.array(messageId).min(1).max(8).optional(),
    offset: z.number().int().nonnegative().optional(),
    id: messageId.optional(),
    before: z.number().int().min(0).max(5).optional(),
    after: z.number().int().min(0).max(5).optional(),
    query: z.string().trim().min(1).max(120).optional(),
    beforeId: messageId.optional(),
}).strict();
const parameters = Type.Unsafe<z.infer<typeof input>>(z.toJSONSchema(input));
const contentBudget = 12_000;

function provenance(message: LhMessage, index: number) {
    const images = Array.isArray(message.content) ? message.content.filter(part => part.type === "image").length : 0;
    const base = {id: message.id, index, role: message.role, timestamp: message.timestamp, images: images || undefined};
    if (message.role === "toolResult") {
        return {...base, toolName: message.toolName, toolCallId: message.toolCallId, isError: message.isError};
    }
    if (message.role === "custom") return {...base, kind: message.customType};
    if (message.role === "assistant") {
        const calls = message.content.flatMap(part => part.type === "toolCall" ? [{id: part.id, name: part.name}] : []);
        return {...base, model: message.model, provider: message.provider, calls: calls.length ? calls.slice(0, 8) : undefined,
            remainingCalls: calls.length > 8 ? calls.length - 8 : undefined};
    }
    return base;
}

function textOf(message: LhMessage) {
    if (typeof message.content === "string") return message.content;
    return message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n");
}

/** Budget the encoded text so escaping LaTeX, quotes, or control characters cannot inflate the result. */
function exactSlice(text: string, offset: number, budget: number) {
    const tail = text.slice(offset, offset + budget);
    let start = 0, end = tail.length;
    while (start < end) {
        const mid = Math.ceil((start + end) / 2);
        if (JSON.stringify(tail.slice(0, mid)).length <= budget) start = mid;
        else end = mid - 1;
    }
    // Keep a surrogate pair on the same page. Offsets are JavaScript string offsets.
    const last = tail.charCodeAt(start - 1);
    if (offset + start < text.length && last >= 0xd800 && last <= 0xdbff) start--;
    const next = offset + start;
    return {text: tail.slice(0, start), offset, nextOffset: next < text.length ? next : undefined};
}

export function chatHistoryTool(chatId: string, read: () => readonly LhMessage[]): AgentTool<any> {
    return {
        name, label: "Read saved chat history",
        description: "Retrieve saved evidence from this chat only. Use search with query (all keywords must match, case-insensitive), and beforeId for older hits. Use read with ids (up to eight), or around with id and optional before/after counts. If nextOffset is present, read that ID alone with offset for the next exact slice. Text and saved provenance only. Use read_scratchpad for drawing pixels. Retrieve only what the current question needs.",
        parameters,
        execute: serverExecute(name, parameters, raw => {
            const request = input.parse(raw);
            const messages = read().map((message, index) => ({message, index})).filter(({message}) =>
                (message.role !== "custom" || message.customType === "scratchpad-attempt" || message.customType === "subagent-steer") &&
                (message.role !== "toolResult" || message.toolName !== name));
            if (request.operation === "search") {
                if (!request.query) throw new Error("Search requires a keyword query.");
                const end = request.beforeId ? messages.findIndex(({message}) => message.id === request.beforeId) : messages.length;
                if (end < 0) throw new Error("History cursor was not found in this chat.");
                const terms = request.query.toLowerCase().split(/\s+/);
                const hits = [];
                for (let i = end - 1; i >= 0; i--) {
                    const {message, index} = messages[i]!;
                    const text = textOf(message);
                    const searchable = text.toLowerCase();
                    if (!terms.every(term => searchable.includes(term))) continue;
                    const start = Math.max(0, searchable.indexOf(terms[0]!) - 60);
                    hits.push({...provenance(message, index), excerpt: text.slice(start, start + 240), excerptOffset: start});
                    if (hits.length === 8) break;
                }
                return {chatId, hits, beforeId: hits.length === 8 ? hits.at(-1)?.id : undefined};
            }
            let selected;
            let missingIds: string[] = [];
            let offset = 0;
            if (request.operation === "around") {
                if (!request.id) throw new Error("Around requires a message ID.");
                const center = messages.findIndex(({message}) => message.id === request.id);
                if (center < 0) throw new Error("Message was not found in this chat.");
                selected = messages.slice(Math.max(0, center - (request.before ?? 3)), center + 1 + (request.after ?? 3));
            } else {
                if (!request.ids) throw new Error("Read requires a list of message IDs.");
                const ids = new Set(request.ids);
                if (request.offset !== undefined && ids.size !== 1) throw new Error("Use offset with a single message ID.");
                selected = messages.filter(({message}) => ids.has(message.id));
                for (const {message} of selected) ids.delete(message.id);
                missingIds = [...ids];
                offset = request.offset ?? 0;
            }
            const budget = Math.floor(contentBudget / Math.max(1, selected.length));
            return {chatId, missingIds, messages: selected.map(({message, index}) => {
                const text = textOf(message);
                if (offset > text.length) throw new Error("Offset is past the end of this message.");
                return {...provenance(message, index), ...exactSlice(text, offset, budget)};
            })};
        }),
    };
}
