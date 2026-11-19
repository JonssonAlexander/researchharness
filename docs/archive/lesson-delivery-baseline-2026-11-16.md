# Lesson delivery baseline — 16 November 2026

Historical measurements for [lesson delivery](../lesson-delivery.md).

Available owner regression: `chat_mwhv1059_1fef6789`, 95 native messages:

| Observation before this change | Count |
|---|---:|
| User messages / short acknowledgements | 11 / 9 |
| Admitted model steps | 45 |
| Tool calls | 38 |
| read_lesson calls | 15 |
| Map write calls / successful calls | 12 / 11 |
| Reported input/output/cache tokens across all steps | 1,366,757 |
| Sum of 45 provider-reported model durations | 894,022 ms |

These are accumulated inference tokens, not unique context or subscription quota.
Provider-duration sum is not complete-turn latency. Historical first useful text
and complete-turn timings were not recorded and cannot be reconstructed reliably.
The owner's current regression lesson snapshot is 2,569 characters including its
label (revision 12, 18 nodes, 7 main topics, one current topic with active target).
The saved record/map were inspected read-only and remain unchanged.

A scripted native test develops covariance structure and estimation in one
response: 1 model call, 0 map reads/writes, 0 acknowledgement turns. This proves
that the optimized path needs no bookkeeping calls; it does NOT measure a real
model's new teaching behavior, wall-clock improvement or token savings. Other
checks cover live refresh after edits, stable prefix, bounded whole-topic
omission, active targets, text-before-tool delivery, stale-write rejection,
restart persistence and deterministic latency counting. Validation: typecheck, lint and diff checks passed; 201 tests passed across
lesson/evidence, chat/retry/compaction, subscription admission/accounting, Practice,
turn recovery and PDF/source suites (including nine new delivery tests). No paid
model or browser/pen test was run for this stage.
