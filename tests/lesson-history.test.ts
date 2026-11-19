import assert from "node:assert/strict";
import test from "node:test";
import {fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {historicalLessonImages, selectLessonHistory} from "../src/agent/lesson-history.ts";
import {newCompactionMarker} from "../src/core/compaction.ts";
import {initialLesson, type LearningSession} from "../src/core/learning-session.ts";
import {asAgentMessages, toLlmMessages, type LhMessage} from "../src/core/native-messages.ts";

const goal = "Study conditional expectation";
const lesson = (): LearningSession => ({schemaVersion: 1, revision: 1, status: "active", plan: initialLesson(goal)});
const user = (id: string, content: string): LhMessage => ({id, role: "user", content, timestamp: 1});
const reply = (id: string, content: string): LhMessage => ({...fauxAssistantMessage(content), id});
const old = user("old", "Previous assumptions and corrections.");
const answer = reply("answer", "This argument is complete.");
const fresh = user("new", "New standalone question: Prove the tower law for bounded random variables.");
const call = {...fauxAssistantMessage([fauxToolCall("read_chat_history", {}, {id: "lookup"})], {stopReason: "toolUse"}), id: "call"};
const result: LhMessage = {id: "result", role: "toolResult", toolCallId: "lookup", toolName: "read_chat_history",
    content: [{type: "text", text: "Earlier equation"}], isError: false, timestamp: 2};

function selection(messages: LhMessage[], changes: Partial<Parameters<typeof selectLessonHistory>[2]> = {}) {
    const native = asAgentMessages(messages);
    const projected = toLlmMessages(native);
    return selectLessonHistory(native, projected, {lesson: lesson(), originalGoal: goal, inputId: "new", canRetrieve: true,
        historicalImages: historicalLessonImages(native), ...changes});
}

test("standalone selection keeps the compaction summary, fresh question and complete live tool group", () => {
    const stamp = newCompactionMarker("Existing compaction summary", {firstKeptMessageId: "old", tokensBefore: 8000, at: "fixture"});
    const history = [user("compacted", "Before compaction"), old, answer, stamp, fresh, call, result];
    const before = structuredClone(history);
    const selected = selection(history);
    assert.equal(selected.droppedMessages, 2);
    assert.deepEqual(selected.messages.map(message => message.role), ["user", "user", "assistant", "toolResult"]);
    assert.match(JSON.stringify(selected.messages[0]), /Existing compaction summary/);
    assert.match(JSON.stringify(selected.messages[1]), /tower law/);
    assert.deepEqual(history, before);
});

test("selection falls back for unresolved work, interrupted or pending groups and ambiguous input", () => {
    const working = lesson();
    working.plan.derivations = [{id: "proof", nodeId: "topic_0", title: "Proof", start: "Given A", finish: "Show B", status: "working"}];
    const revisit = lesson();
    revisit.plan.nodes[0]!.progress = "revisit";
    const broken = {...fauxAssistantMessage("Stopped.", {stopReason: "aborted"}), id: "interrupted"};
    const cases: [LhMessage[], Partial<Parameters<typeof selectLessonHistory>[2]>, string][] = [
        [[old, answer, user("new", "Continue from a new topic.")], {}, "no-standalone-question"],
        [[old, answer, fresh], {lesson: working}, "unresolved-lesson"],
        [[old, answer, fresh], {lesson: revisit}, "unresolved-lesson"],
        [[old, answer, fresh], {background: true}, "no-eligible-input"],
        [[old, answer, fresh], {inputId: undefined}, "no-eligible-input"],
        [[old, answer, fresh, user("steer", "Actually use the old assumption.")], {}, "intervening-input"],
        [[old, broken, fresh], {}, "unclosed-exchange"],
        [[old, call, result, fresh], {}, "unclosed-exchange"],
        [[old, call, answer, fresh], {}, "open-tool-or-interruption"],
        [[old, answer, fresh, call], {}, "open-tool-or-interruption"],
    ];
    for (const [messages, options, reason] of cases) {
        const selected = selection(messages, options);
        assert.equal(selected.reason, reason);
        assert.equal(selected.droppedMessages, 0);
        assert.deepEqual(selected.messages, toLlmMessages(asAgentMessages(messages)));
    }
});

test("full text fallback removes historical image bytes while preserving the current input and tool identities", () => {
    const historicalImage = {type: "image", data: "old-image", mimeType: "image/png"} as const;
    const currentImage = {type: "image", data: "current-image", mimeType: "image/png"} as const;
    const messages: LhMessage[] = [old, call, {...result, content: [historicalImage]}, answer,
        {id: "new", role: "user", timestamp: 3, content: [{type: "text", text: "Check my drawing."}, currentImage]}];
    const selected = selection(messages);
    assert.equal(selected.droppedMessages, 0);
    assert(!JSON.stringify(selected.messages).includes("old-image"));
    assert(JSON.stringify(selected.messages).includes("current-image"));
    assert.equal(selected.messages[2]?.role, "toolResult");
    assert.match(JSON.stringify(selected.messages[2]), /lookup/);
    assert(JSON.stringify(messages).includes("old-image"));
});
