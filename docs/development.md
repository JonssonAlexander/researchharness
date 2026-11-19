# Development guide

Use Node 26, as in [CI](../.github/workflows/ci.yml). For the code layout and owning services, see [Architecture](architecture.md).

## Run locally

```bash
npm ci
npm run dev:local    # http://127.0.0.1:3005
```

**Use `dev:local` for daily work.** The launcher preserves a separate `ResearchAtlas-dev` profile under Application Support on macOS, Local AppData on Windows, and XDG data home on Linux. It stores app records in `data/` and credential files beside `auth.json` at the profile root. Nothing in the profile belongs in Git.

Set `RESEARCH_ATLAS_PROFILE_DIR`, `LH_DATA_DIR`, `LH_AUTH_FILE`, or `PORT` to override the defaults. The launcher uses saved provider connections and sets `LH_IGNORE_ENV_KEYS=1` by default. Set it to `0` when you intend to use environment API keys. Plain `npm run dev` still uses the normal Next.js startup and defaults to repository-local data and credentials.

Run one writer per data and credential directory. The launcher uses `dev-server.lock` to guard its profile. After a crash, confirm the recorded PID is gone before removing the stale lock. Stop the server before copying or restoring a profile. See [storage and recovery](architecture.md#storage-and-recovery) for what a complete backup includes.

The sidebar shows **Opening…** while a saved chat loads. The chat page includes usage figures with the initial transcript, and the model picker fetches only chat settings. When diagnosing slow navigation in dev, check the `GET /chat/…` timing in the server log. That request is separate from a tutor turn.

## Models and credentials

Set providers, model slots, and thinking levels in Settings. Strong, cheap, and vision slots supply defaults for the roles that use them. Per-role and per-chat settings can override those choices. Configure a key for the API provider you choose, or use a supported subscription connection. There is no required OpenRouter key for other providers.

Keep secrets and local overrides out of Git. Optional environment settings include `EXA_API_KEY` for web search, `DEEPGRAM_API_KEY` for dictation, and `CHROME_PATH` for the system Chrome fallback used in demo verification.

For web search, add a key in **Settings → Providers**. Automatic search tries Tavily, Brave, then Exa. An engine pinned under **Agent → Tools** needs its own key. Keys are read again on the next call.

### Learner file access

**Settings → Agent → Tools → File access** can restrict generic read, search and PDF tools to selected folders. Restrictions default off. Turning them on with an empty list denies generic access. Paths are resolved on the server, with relative paths based at the server user's home. Credentials, dotenv files and sensitive home locations are always denied, including canonical aliases. Missing roots and malformed policy fail closed. Queued PDF work checks permissions again before execution.

Managed lesson sources, scratchpads, and retained research downloads have their own scoped readers. File access guards are application checks and do not provide an OS sandbox.

### Subscription connections in web/dev

Settings → Providers supports ChatGPT, GitHub Copilot, and Grok. Plain Next dev/start and the Electron dev shell use the dev server's connections. Packaged desktop keeps its own credentials and private IPC transport.

Subscription files sit beside the configured `auth.json`. On macOS the ChatGPT file holds a locator for credentials stored in Keychain. Other subscription files and non-macOS ChatGPT records use private files. A filesystem copy of a locator has no Keychain secret. See [credential storage and recovery](credential-storage-plan.md) before migrating or restoring credentials. Keychain denial leaves the connection unavailable.

Complete ChatGPT sign-in in a browser on the server's machine because the callback listens on that machine's loopback address. Copilot and Grok use device codes. Allow the sign-in tab if the browser blocks it. The Electron dev shell uses the system browser. Browsers sharing one dev server also share its data, provider connections, and background-use consent. Keep the dev server on trusted local networks or loopback. Public hosting requires independent host and access controls.

## Checks and builds

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Use temporary data and auth roots when running tests that touch stores. The test suite uses Node's test runner and scripted providers. Some checks open local sockets or use native runtimes. Keep real credentials and model calls for explicit integration checks. Intentional format changes update the [golden fixtures](../tests/fixtures/golden-data/README.md) in the same change.

- `npm start` serves the built app.
- `npm run desktop:dev` starts the Next dev server and Electron shell.
- For packaged builds, use [Desktop release](desktop-release.md) and the target-OS native runtime gates in [CI](../.github/workflows/ci.yml).
- After building, `node scripts/smoke-web-subscriptions.mjs` checks the offline dev/start subscription paths.
- `node scripts/smoke-chatgpt-keychain.cjs` checks the native import. The opt-in `--exercise` and `--cross-runtime` checks touch Keychain with dummy records and may prompt.

## Maintenance and recovery

The source for one-shot maintenance lives in [`scripts/`](../scripts). `import-notes.ts` writes imported material to the graph. `replay-layout.ts` rewrites positions. `backfill-graph.ts` clears and re-extracts the graph. Check the target data root, isolate destructive runs, and take a backup before changing real data.

If nested dev APIs return Next HTML 404s while their route files exist, stop the server, move the generated `.next/dev` cache aside, and restart. Keep data and credential paths intact. Restart any pending OAuth attempt from the connection dialog.

[Archived development guide](archive/development-2026-11-18.md) retains the original profile migration and diagnostic records.
