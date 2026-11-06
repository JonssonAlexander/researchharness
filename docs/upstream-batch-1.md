# Upstream batch 1: persistence and replay

Implemented against Atlas `ceb4c6696f9577a3c7c574460b8707cf36a4fc0d`, using
LearnHarness `713377f366771e3e4730e6acd1bc290e0ebc6d6e` as the pinned reference.
This is a selective port, not a merge of upstream main. No dependency, UI,
provider, source-folder management or storage-schema changes are included.

## Adopted changes

Whole commits retain upstream authorship and `-x` provenance:

- `b018c71cda5d4ef781f58cc4ba45a61f18a7ce41`: initial atomic helper/tests.
- `c0256a927132da6756edecf37c4cf98eeda9cf12`: chat/job writes and crash fixture.
- `a7069195799863bd5e9265dafd07177a27379e55`: source map, graph stamp,
  render settings and prompt overrides.
- `4b2417acd03f0347cdea2d40309d5fea49614c13`: missing-target error handling.
- `fe188489b291c6bc09b7b2f344582f6dc34f6c2e`: retain complete temp on failed fallback.
- `4a97cfc9565a0612a08aec3486d89c1bf20908cc`: deduplicate adopted native messages.

Manual ports reconcile these donors to their final implementation:

- `523161403aed4f68d17f8807a1a2f12a4a46b68a`: settings persistence only.
- `2106a3cb12fbe73da9abb6aef2dc4d9cffb26a36`: source deletion, ledger replacements
  and positions; no source-organization store or auth rewrite.
- `03acd5ce79f24d250c2603728f2a2de21119d59e` and
  `d45609d6f1ddb8a8c4558127d3cb824b2e3d580e`: deletion/purge temp cleanup.
- `05f34865eaeca12d4a78cd620b21efa5fd96d250` and
  `936f894cc6536e7a5cd121154f61560cfc74a5c4`: store failure and retry tests.
- `240f454b260bd9b7c70e4fdaceabf0bc4daab5e1`: unlink cleanup, including Unicode paths.
- `dbcaab19be92c237d02700a6c7c8ad039395527d` and
  `c4e088e9c20ec992f823f731f5dbeea10536910a`: strict helper default, explicit
  legacy Windows fallback, symlink protection and final helper tests.
- `0d66cd8c85fea154abe1ec5945756a68c0a7ca5b`: canonical wake replay suppression,
  wire/record ordering, repeated events and reattachment tests.

Credential-temp denylist changes remain batch 3. The existing auth writer and
Keychain implementation are unchanged; no new credential temp format is introduced.
Tests isolate dummy credentials and account for the existing auth temp convention.
The source-deletion adapter is available for future callers; no new delete UI/API
or source-organization feature is enabled.

## Save boundaries

The shared helper writes an exclusive adjacent temp, fsyncs its contents and renames
it over the target. Errors propagate before a success event. Listings skip temps;
chat/job/prompt deletes and source/ledger purges clear matching crash leftovers.

Only previously in-place upstream writers opt into Windows compatibility fallback:
chats, jobs, user settings, source upserts, render settings, graph stamp and prompts.
Positions, ledger rewrites and source deletion remain strict replacements.

Atlas learning-session heads, scratchpad heads/manifests, lesson-document manifests
and Problems records use the helper with mode 0600 and **no** in-place fallback.
Revision guards and synchronous read-modify-write behavior are retained. Previous
lesson revisions and scratchpad recovery copies remain available. Original documents
and attempt images still publish before their manifests; retries verify/reuse them.

Atlas SQLite transactions, integration journals/receipts, content hashes and
exclusive hard-link publication for immutable concept notes and Rnote blobs remain
unchanged. An atomic file replacement is not a multi-file transaction. Inference
premises, stable canonical IDs, hidden challenge solutions and FSRS policies are
unchanged.

## Limits and validation

No directory fsync is added by the shared helper: do not claim power-loss durability.
There is no cross-process lock. The optional legacy Windows fallback can still tear
an in-place write; a failed fallback retains the complete new temp for recovery.
Native Windows held-file behavior needs a Windows machine; modeled sharing-violation
coverage is not that acceptance test. Real macOS Keychain prompts are not exercised;
credential round trips use the injected test backend, without accessing owner secrets.

Checks cover process exit immediately before rename and fresh-process reopening of
teaching, short Practice and Challenge chats; write/fsync/rename failures; Windows
retry/fallback policy; symlink referents; Unicode paths; restrictive manifest modes;
leftover cleanup; Atlas draft/attempt/source retry; canonical integration recovery;
and probe/job replay in all adoption orders. The upstream folder timing assertion
uses a direct no-wait check to avoid filesystem timing flakiness under parallel load.

Validation on 6 November 2026: 459 tests passed in the 22-file regression run,
with one native-Windows-only skip. The final helper suite (including the additional
denied-cleanup regression) passed 29 tests, with that same platform skip.
`npm run typecheck`, targeted ESLint and `git diff --check` passed.
No live owner profile, real Keychain entry, paid provider call or packaged Electron
runtime was used. Production build/native-platform acceptance was not run for this
non-packaging change. Main remains unchanged until the completed branch is merged.
