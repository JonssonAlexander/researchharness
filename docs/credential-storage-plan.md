# ChatGPT credential storage — macOS Keychain

Status: implemented in this working tree, 28 October 2026. The owner approved macOS Keychain for browser development and Electron desktop. Requirement: R16. Validation results are recorded below; this does not extend secure storage to API keys or other providers.

## As-built storage and ownership

Both `src/server/web-subscriptions.ts` and `electron/main.cjs` select the shared `credentialStore` adapter from `electron/chatgpt-keychain.cjs`. On macOS it uses `@napi-rs/keyring` **2.1.2**, pinned in the lockfile, through its asynchronous native Keychain interface. Credentials do not pass through a shell, command-line arguments, browser responses or renderer IPC. The API-key fallback behavior is unchanged: this connection never silently changes billing paths.

The service name is `org.researchatlas.chatgpt`. Each immutable credential revision has a random UUID account label. Different auth directories receive independent item IDs. Credential-bearing records, including the existing OAuth host ID, client IDs, account identity, tokens and preferences, live in Keychain. The original `chatgpt-credentials.json` filename becomes a versioned locator containing only its backend, format version and item UUID. A fresh or fully disconnected record with no accounts and only known nonsecret fields can stay inline without accessing Keychain.

The owning connection retains the existing injected `read()` / `write()` port. Operations are serialized within the adapter. Keep one application writer per configured auth directory; this change does not introduce a multiprocess credential service. Node and Electron can require separate macOS access grants. Packaged Electron resolves the native binding from the standalone server payload, outside ASAR; the Next trace explicitly includes its package, macOS binary and shipped license notices.

On other platforms the existing private JSON adapter remains in use. It refuses a macOS locator rather than resetting it or treating it as plaintext credentials. Other providers, `auth.json` and external environment variables are outside this change.

## Migration, durability and recovery

On first access, an owner-only valid legacy JSON record is read and validated. A credential-bearing record is written to a new Keychain item and read back byte-for-byte before its locator atomically replaces the legacy file. Host identity, registrations, account selection, scopes, token state and background consent are retained. No plaintext migration backup is created. Replacing a file does not erase historical filesystem snapshots or backups.

A mode-0600 `chatgpt-credentials.json.keychain-pending.json` journal records only item IDs and a SHA-256 revision digest before Keychain work. A fully written staged revision can be activated on restart, preserving a token that rotated remotely before a crash. Incomplete items are reconciled; previous items are removed only after the new locator is published and the active record is verified. Interrupted cleanup is retried. Corrupt or unrelated recovery state fails closed instead of deleting recoverable items.

Fully disconnecting the last account publishes a nonsecret empty record and removes the obsolete secret item. Removing one of several accounts creates a revision without that account and retires the old item. Existing remote-revocation attempts and honest failure warnings remain unchanged. A failed cleanup blocks the operation and retains recovery metadata; it is never reported as a completed clean removal.

Locked, missing, denied or corrupt Keychain data produces the existing sanitized storage error and blocks this connection. No native error details or secrets are returned to the UI. There is no automatic plaintext fallback and no automatic reset of a missing credential-bearing record. Symlink and broadly readable credential/intent files are refused.

## Backup, rollback and operational limits

A locator file alone does not back up credentials. Keychain contents are managed by macOS. Copying a data/auth directory to another machine may require restoring Keychain access or explicitly establishing a new connection. This change does not export Keychain secrets. Do not run an older plaintext-only application against a migrated locator and expect it to authenticate.

If the Keychain item is lost, the app fails closed; reconnecting requires an explicit credential-storage repair/reset rather than overwriting the locator silently. Preserve the locator and any pending journal while investigating interrupted migration. Do not delete unrelated app data or other applications' Keychain entries. Restoring an old refresh token from a backup may fail because OpenAI may already have rotated or revoked it.

This is protection for secrets at rest, not a guarantee against malicious code already authorized to use the relevant Keychain item, a compromised running app, or content the user intentionally sends to OpenAI. This implementation was tested on macOS arm64 only; it does not claim signed-installer or real-account OAuth verification.

## Validation

- Focused migration/authentication tests: passed (34 tests at the focused checkpoint), all with injected dummy vaults and no OS Keychain use.
- Real macOS Keychain CRUD using dummy credentials: passed independently under host Node and Electron bundled Node. Test entries were deleted afterward.
- The initial optional Node-to-Electron shared-item probe did not complete; the owner reported accidentally declining an OS prompt and asked to skip further live tests. Cross-application ACL sharing is not signed off. No further live Keychain tests are required for this task.
- Final validation: all **2,536 tests** passed (499 suites, no failures/skips); typecheck, lint and production build passed. Standalone server startup passed under both host Node and Electron bundled Node, including import-only checks of the packaged Keychain binding. Four pre-existing broad-filesystem tracing warnings remain.
- No real-account sign-in, signed installer or interactive desktop window was tested. The current development instance had zero saved ChatGPT accounts before this change, so there were no real account tokens to migrate.

The optional probe is `scripts/smoke-chatgpt-keychain.cjs`: without flags it initializes only the native binding and performs no credential access. `--exercise` creates, restores, rotates and deletes unique dummy records. `--cross-runtime` adds cross-application access and can prompt. The standalone server smoke automatically performs an import-only native-binding check on macOS, under the selected Node/Electron runtime.

Dependency: [@napi-rs/keyring](https://github.com/Brooooooklyn/keyring-node), MIT; macOS native packages include `LICENSE.third-party.md` for their bundled Rust crates. The existing application license and attribution are unchanged.
