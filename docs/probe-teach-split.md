# Probe and teach protocol

This is the legacy conversation flow. New conversational lessons use the [lesson workspace](atlas-learning-workspace.md). Both use native chat history.

## 1. Two agents, one conversation

The prober uses its own prompts, `ask_user_question`, and either `probe` (multiple choice) or `recall` (free recall). Its graded tool has no `nodeId`, and it has no plan tools. The teacher starts in planning after a successful `probe_done` and then teaches using the same saved message history. Each turn constructs the appropriate agent. Historical tool calls remain readable in the new agent's context.

The [Teacher prompt fragments](../src/agent/prompts/teacher) cover foundations, planning, the teaching loop, question design, and background jobs. The cycle fragment owns when predictions open and checks appear. The tool registry chooses `quiz` or `explain` based on the learner's settings.

## 2. `probe_done` — handoff

The prober sends a strand-by-strand learner assessment. An open question or a prior successful conclusion blocks the call. A valid conclusion needs a clean assistant call and a later matching successful result. A clean acknowledgment without an explicit `ok:true` is valid. Missing, failed, aborted, or unmatched results keep probing open.

A successful result queues a durable handoff steer. The wake turn starts the teacher and authors the plan. If wake delivery is interrupted, the next user turn still selects the teacher from the saved record. Keep the assessment and tool history.

## 3. `nodeId` — position and coverage

A tagged teaching call moves the current position to that plan node. The most recent tag identifies the current node, and prior tags mark it as visited. Answer grades do not advance the map. There is no completion ledger or fallback current node. Teaching quiz tags are required and validated. Off-map questions use the general ask tool.

## 4. Phases

[The phase fold](../src/core/phases.ts) advances probe → plan after a successful `probe_done` result, and plan → teach at the first `nodeId`-tagged quiz or explain call. Plan presentation ends the turn and the learner can request a revision or continue in plain language. Mid-lesson plan rewrites need no separate acceptance gate.

## 5. Context

Tool availability comes from the active agent and settings. The prober can use gated graph lookup. Atlas lesson context and teaching evidence follow the separate lesson workflow.

## 6. Plan display

The saved plan holds structure. The UI derives current, visited, and upcoming nodes from history. Preserve plan blocks as snapshots of authored plans while the plan window follows live focus. See [the original design record](archive/probe-teach-split-2026-09-11.md) for earlier layouts and retired rules.
