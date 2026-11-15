# Python Workbench (implemented slice, 9 November 2026)

Teaching and research conversations share a deterministic `python` tool. No extra
model role or autonomous experiment agent is introduced. A compact Workbench action
opens project access and saved experiments; job results render original PNG figures
inline through the existing native result-marker, job notification, cancellation
and delivery infrastructure. Local Python execution incurs no model call itself;
normal teaching and result discussion retain existing provider/accounting rules.

## Use

Open a conversation → Workbench → explicitly create a named project or select an
existing absolute folder, select its Python interpreter, then Enable project.
Access is per session and starts off. Existing Python environments are used as-is;
packages are neither installed nor upgraded by the agent. Network is separately
opt-in for downloads such as yfinance. The local Python 3.11 framework environment
was used for the real NumPy/Matplotlib acceptance test; the installed Python 3.9
has an unrelated NumPy/Matplotlib binary incompatibility.

Ask for a calculation or simulation in chat. The agent can list/read saved runs,
write bounded Python, inspect computed outputs and rerun with changed assumptions.
Scripts receive `parameters`, `seed`, `project_dir`, and `output_dir` globals.
`project_dir` is readable; the run directory is writable. Open Matplotlib figures
are saved automatically, or code may explicitly save PNGs. Print useful numerical
summaries for the teacher; plot pixels are not automatically uploaded to a model.

Code & parameters opens the saved run. Editing there and Run as new experiment
creates a new run; the old code/results remain recorded. Open in VS Code opens the
selected ordinary folder, or experiment.py for the selected run. After editor
changes, Load file edits imports code for inspection before a fresh run. This is
not a VS Code extension, live buffer sync, notebook or shell. Keep run is a saved
bookmark; all runs already persist, and no automatic pruning is implemented.

## Boundaries

The first adapter supports macOS Seatbelt (`sandbox-exec`) only. Other hosts or an
unavailable sandbox fail closed. The profile allows project/runtime/system reads,
run-directory writes and required process/runtime operations. New child processes
are denied (threads remain available); use VS Code for multiprocessing projects. It denies unrelated
user file contents, common credential paths, and network by default. An explicitly
selected interpreter also authorizes its runtime prefix for package reads. Network
opt-in allows outbound TCP/UDP; localhost is still denied and listening/Unix socket
access is not granted. This is a local developer tool, not hostile-code hosting or
an independently audited security boundary. Do not select projects with secrets.

No shell-interpolated command exists. Python launches with isolated-mode imports,
a minimal environment without app/provider credentials, Agg plotting, one BLAS
thread, and explicit cwd. Defaults: 60 seconds wall time, maximum 120; 120 seconds
CPU, 20 MiB per-file writes, 128 file descriptors, bounded process count, 100 KB
combined logs. Cancellation/timeout kills the process group. Memory and total disk
usage are not hard quotas; use small experiments. Display limits: eight validated
PNG outputs, 10 MB each/20 MB combined. Filesystem roots and outputs reject symlink
escapes; saved figure hashes are checked before serving.

Project runs serialize inside the application (shared across route instances).
The application never overwrites existing project source/input files. Editors may
change them concurrently; an input changing during a read is a reproducibility
limitation. Disabled or changed permission is checked at execution; access cannot
be changed while a Python job is running. Interrupted runs never replay code
without a new learner/model request, including a crash before startup. Duplicate
job/request IDs return the existing execution/result.

## Storage and reproducibility

App-owned metadata and immutable figure copies live under
`data/python-workbench/<chatId>/` (0700 directories/0600 records). Each run records
original code/hash, command inputs, parameters, seed, interpreter/project/network
permission, timestamps/status/exit code, full bounded stdout/stderr, Python/platform
and package versions, and hashes of up to 100 bounded project files opened through
Python's audit hook. Run scripts, parameters, environment and input manifests are
also ordinary files under `<project>/.atlas-runs/<chatId>/<jobId>/`.

Include app data **and selected projects** in backups. Input hashes are references,
not copied datasets. Native-extension reads, downloads and live APIs may not be
fully captured; dependencies are recorded, not vendored or automatically locked.
Saved code records remain the execution-time version even if experiment.py is later
edited externally. Failed/partial attempts and their logs are retained. Numerical
observations are never proof certification or automatic Atlas integration.

Transport is session-owned `/api/chats/:id/workbench`, with bounded bodies,
same-origin mutation checks, ID validation, no arbitrary asset paths and no-store
responses. Hidden provider credentials and unrelated project contents are never
included by a workbench-wide scan. Existing trusted local deployment assumptions
still apply; do not expose this API as a public execution service.

## Validation

Focused tests cover input budgets, permissions, path/symlink containment, seeded
reruns, opened-input provenance, no automatic crash replay, no model resolution
for local jobs, save-before-delivery and retained output integrity. Opt-in real
macOS tests exercise sandbox reads/writes/network, cancellation, timeout, NumPy
and Matplotlib with the selected installed interpreter. Existing job and atomic
persistence regressions are retained. No live yfinance request, paid model call,
packaged Electron build or VS Code UI interaction is claimed by these tests.

Validation result: 111 focused/regression tests passed; all 13 real macOS execution checks passed. Typecheck,
lint and diff whitespace checks passed. A disposable browser session displayed
the actual retained plot and editable code at wide and narrow widths without
page errors. The test server/source copy was removed afterward.
