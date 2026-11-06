# Batch 3A: learner-file access

Selective port from LearnHarness `713377f366771e3e4730e6acd1bc290e0ebc6d6e`
onto Atlas `e3034e7`. No attachment chips, native pickers, image annotation,
source-folder imports, custom providers or credential-store changes are included.

## Owner-facing behavior

Settings → Agent → Tools has one File access control. Restrictions are OFF when
preferences are absent; ordinary local files remain readable. Turning restrictions
ON permits only listed folders and their subfolders. ON with an empty list denies
all generic learner-file access. Adding/removing folders never flips that switch.
Relative source paths still mean relative to the server user's home; `~/` expands.
Paths in settings must be absolute on that server or home-relative with `~/`.

Credential files and their writer-specific crash temps, dotenv files, sensitive
home directories (keys, browser profiles and other agents' transcripts/settings)
are always refused by generic read/search tools, even inside an allowed parent.
Both named and canonical paths are checked, including aliased home locations and
case variants. Allowed-folder comparisons retain the host filesystem's semantics;
case folding is confined to the sensitive-location check.

Missing/unreadable allowed roots never restore home access. Pathless find/grep
search the available allowed roots with shared limits/cancellation; pathless ls
shows the configured roots. A malformed or unreadable existing settings record
blocks source reads and surfaces a safe diagnostic. Unrelated preference writes
retain a restricted-empty placeholder rather than silently reopening access.
Explicit valid File access edits repair it. Each new operation reads fresh policy.

## Boundaries preserved

The policy provider is installed by the server composition root. Filesystem tools
receive policy through their injected seam rather than importing the settings
store. Canonical resolution errors fail closed. Search walkers skip sensitive
entries and do not follow symlinks. Generic read covers text and the existing
image path. PDF jobs check admission before creating a new job, retain raw input
and replay IDs, and check current permissions again when queued execution starts.
Denied PDFs return the existing structured failure without model/renderer calls.

Managed lesson-document and scratchpad readers still validate their own scoped IDs,
hashes and image capabilities. They do not invoke the generic file picker/resolver,
so uploaded sources remain available when generic access is restricted-empty.
No blanket application-data allowlist exception was added. Researchers' downloaded
PDFs retain their independent job-directory containment checks. Keychain and auth
writers are unchanged; policy never reads credential contents to classify a path.

These are application-level read guards, not an OS sandbox or content redaction.
Renamed/copied secrets outside recognized locations cannot be recognized by content.
A hostile concurrent process can race filesystem changes; this version adds no
cross-process filesystem locking or descriptor-based traversal sandbox.
No existing owner folders were enrolled or settings altered during development.

## Provenance and validation

Whole commits retain `-x` provenance:

- `6c0d3ef44a32f2ce96f868bd87670aba432bb04a`: leading tilde expansion.
- `61d94aa483cb158bc3f0fc618db90ca63247fe92`: resolver tests.
- `96b50a4071154f50077ab5c1c0f8fb0c4a491703`: mandatory home-path exclusions.

Final-state manual ports use `964fef4e`, `5c666766`, `bbc33af3` for canonical,
configured-credential and case-variant protections; `dbcaab19` for credential temps;
`62828c78`, `c73a251d`, `e8807406` for optional restriction policy, strict settings
and compact controls. Composition-root wiring follows merge resolution `9fe1be3f`,
not a cherry-pick of that merge. Later image/snapshot assertions were adapted to
Atlas's actual image read API; those features were not introduced for test parity.
Existing PDF/job tests now expect canonical paths while pinning unchanged raw input.

Validation: 385 tests passed across 19 selected test files, with two native
Windows-only skips. Typecheck, targeted ESLint and diff whitespace checks passed.
Coverage includes sensitive paths before/after allowlisting, symlinks, relocated
credentials and temp aliases, case-sensitive models, restricted-empty, corrupt
settings, fresh policy, multi-root search, queued PDF revocation, managed source
and scratchpad access, lesson integration, Challenge privacy, FSRS and atomic saves.
Keychain tests use injected dummy credentials; no real secrets or paid models.

A headless browser exercised the actual Settings UI/API on a separate temporary
profile at port 3006: default OFF, add folder, turn ON, remove last folder, confirm
restricted-empty persistence. Screenshot `/tmp/atlas-3a-settings.png` was inspected.
The temporary server was stopped; its worktree-only dependency-root override was
removed. The running owner app/profile was not changed. Native Windows behavior
and a packaged Electron build were not exercised.
