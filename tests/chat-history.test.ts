import assert from "node:assert/strict";
import test from "node:test";
import {fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {chatHistoryTool} from "../src/agent/tools/chat-history.ts";
import type {LhMessage} from "../src/core/native-messages.ts";

test("history discovers, reads and orders exact saved text with its tool provenance", async () => {
    const equation = String.raw`For the tower property, \(E[E[X\mid Y]]=E[X]\).`;
    const messages: LhMessage[] = [
        {id: "old-user", role: "user", timestamp: 1, content: "Prove the tower property."},
        {...fauxAssistantMessage([fauxToolCall("read_atlas", {id: "claim"}, {id: "call-1"})]), id: "call-msg"},
        {id: "old-result", role: "toolResult", toolCallId: "call-1", toolName: "read_atlas", content: [{type: "text", text: equation}], isError: false, timestamp: 3},
    ];
    const tool = chatHistoryTool("lesson", () => messages);
    const run = async (input: unknown) => (await tool.execute("lookup", input, undefined)).details as any;
    const found = await run({operation: "search", query: "TOWER property"});
    assert.deepEqual(found.hits.map((m: {id: string}) => m.id), ["old-result", "old-user"]);
    const older = await run({operation: "search", query: "tower", beforeId: "old-result"});
    assert.deepEqual(older.hits.map((m: {id: string}) => m.id), ["old-user"]);
    const around = await run({operation: "around", id: "old-result"});
    assert.deepEqual(around.messages.map((m: {id: string}) => m.id), ["old-user", "call-msg", "old-result"]);
    assert.equal(around.messages[1].calls[0].id, "call-1");
    assert.equal(around.messages[2].toolCallId, "call-1");
    const exact = await run({operation: "read", ids: ["old-result", "foreign-msg", "old-user"]});
    assert.deepEqual(exact.missingIds, ["foreign-msg"]);
    assert.equal(exact.messages[1].text, equation);
    assert.equal(exact.messages[1].toolName, "read_atlas");
    assert.equal(exact.messages[1].timestamp, 3);
    await assert.rejects(() => run({operation: "around", id: "foreign-msg"}), /not found in this chat/);
    await assert.rejects(() => run({operation: "read", ids: ["old-user"], chatId: "another-chat"}));
});

test("large history text pages losslessly and lookup results do not match themselves", async () => {
    const large = String.raw`\frac{\partial^2 u}{\partial x^2} = 0`.repeat(700) + "😀";
    const messages: LhMessage[] = [
        {id: "equations", role: "user", timestamp: 1, content: large},
        {id: "receipt", role: "toolResult", toolName: "read_chat_history", toolCallId: "prior", timestamp: 2,
            content: [{type: "text", text: "unique copied phrase"}], isError: false},
    ];
    const tool = chatHistoryTool("lesson", () => messages);
    const run = async (input: unknown) => (await tool.execute("lookup", input, undefined)).details as any;
    const found = await run({operation: "search", query: "unique copied phrase"});
    assert.deepEqual(found.hits, []);
    let offset: number | undefined = 0;
    let joined = "";
    do {
        const response = await run({operation: "read", ids: ["equations"], offset});
        const page = response.messages[0];
        assert(JSON.stringify(page.text).length <= 12_000);
        if (page.nextOffset !== undefined) assert(page.nextOffset > offset);
        joined += page.text;
        offset = page.nextOffset;
    } while (offset !== undefined);
    assert.equal(joined, large);
});
