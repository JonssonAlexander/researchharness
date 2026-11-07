# Batch 4: Exa search

Selective port onto Atlas `45a6473`. Exa is the only added service. Firecrawl,
hosted Ollama, SDK migrations and new model routing remain excluded.

## Behavior and boundaries

Exa uses the existing web-search tool, curated key catalog and search-engine menu.
Add its API key in Settings → Providers; select it in Agent → Tools if desired.
Automatic selection preserves Tavily → Brave → Exa order. An explicit pin with a
missing key is unavailable, even when another engine has a key. Keys/settings are
read afresh; rotation needs no restart and environment keys retain precedence.

The adapter POSTs query/automatic search/result count/highlights to Exa. It accepts
only HTTP(S) results, bounds returned hits, titles and snippets, handles malformed
JSON/rows and uses a 30-second request timeout. Exa HTTP, transport and JSON errors
never echo provider bodies or arbitrary error messages. Existing Tavily and Brave
error behavior is unchanged. See the official
[Exa request examples](https://github.com/exa-labs/agent-skills/blob/main/skills/exa-search/SKILL.md).

The shared pure registry supplies engine IDs, key names, labels and order to
settings validation, server composition and the existing UI. No dependencies or
additional buttons are added. Web fetching, file-access controls, Atlas identity
policy and keyless research composition remain unchanged. No owner keys/settings
were modified, and no paid requests were made. Account billing and a real keyed
search remain a separate live smoke check.

## Provenance and validation

Manual selective ports from upstream:

- `0a587501050697ef494343d1fe721220d7efa164`: Exa foundation and registry.
- `7821ad3a70e46d18da6dadad8d66c5318cfbae8c`: Exa-specific merge-resolution hardening;
  the mixed merge itself is not cherry-picked.
- `146680b8e443777ec8cd49e9f2c49f125f4be8a9`: malformed-JSON redaction and relevant tests.

Atlas adds explicit transport-error redaction, returned-hit bounds and isolated
restart/rotation tests. The selected regression suite passed 269 tests across 15
files. It covers engine selection/pins, actual settings menu interaction, keyless
research gates, dummy-key rotation/restart/environment precedence, request shape,
unsafe URLs, malformed responses, result bounds, HTTP 401/429 and timeout handling,
plus existing file-access and research job paths. Typecheck, targeted ESLint and
diff whitespace checks passed. No separate browser visual check, packaged Electron
test or live paid search was performed.
