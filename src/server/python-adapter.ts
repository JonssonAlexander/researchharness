import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pythonInput, type PythonInput, type PythonProject, type PythonResult, type PythonWorkbench } from "../core/python-workbench.ts";
import { createPythonStore } from "../store/python-workbench.ts";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const within = (file: string, root: string) => file === root || file.startsWith(root + path.sep);
const literal = (value: string) => JSON.stringify(value);
export function validatePythonProject(project: PythonProject, dataRoot: string): PythonProject {
    if (!path.isAbsolute(project.path) || !path.isAbsolute(project.interpreter))
        throw new Error("Choose absolute project and Python interpreter paths.");
    const root = fs.realpathSync(project.path), interpreter = fs.realpathSync(project.interpreter);
    if (!fs.statSync(root).isDirectory() || !fs.statSync(interpreter).isFile())
        throw new Error("Project or interpreter is unavailable.");
    if (root === "/" || root === os.homedir() || within(root, dataRoot) || within(dataRoot, root) || /\/(\.ssh|\.aws|\.codex|Library|\.config)(\/|$)/i.test(root))
        throw new Error("Choose a dedicated experiment folder, outside app data and private configuration.");
    if (!/python[\d.]*$/.test(path.basename(interpreter)))
        throw new Error("Choose a Python interpreter executable.");
    fs.accessSync(interpreter, fs.constants.X_OK);
    return { path: root, interpreter: project.interpreter, network: project.network === true };
}
/** macOS Seatbelt adapter. Unsupported hosts fail closed; no unrestricted fallback. */
export function pythonSandbox(project: PythonProject, runDir: string): string {
    const runtimeRoots = [project.interpreter, fs.realpathSync(project.interpreter)].flatMap(file => {
        const bin = path.dirname(file), prefix = path.dirname(bin);
        return path.basename(bin) === "bin" && prefix !== os.homedir() && prefix !== "/" ? [prefix] : [];
    });
    const reads = [...runtimeRoots, "/System", "/usr", "/bin", "/sbin", "/Library/Frameworks", "/Library/Apple", "/Library/Developer", "/opt/homebrew", "/usr/local", "/private/var/db", "/private/etc", "/dev", project.path];
    const credentialDenials='(deny file-read* (regex #"/[.]env($|[./])" #"/[.](ssh|aws|gnupg|codex)(/|$)" #"/(auth[.]json|chatgpt-credentials[.]json.*|github-copilot-credentials[.]json.*|[.]netrc|[.]npmrc|[.]pypirc|[.]git-credentials)$"))';
    return `(version 1)\n(deny default)\n(allow process* sysctl-read mach-lookup file-map-executable)\n(deny process-fork)\n(allow file-read-metadata)\n(allow file-read* (literal "/"))\n${reads.map(p => `(allow file-read* (subpath ${literal(p)}))`).join("\n")}\n(allow file-write* (subpath ${literal(runDir)}))\n${project.network ? '(allow network-outbound (remote tcp "*:*") (remote udp "*:*"))(deny network-outbound (remote ip "localhost:*"))' : ""}\n${credentialDenials}\n`;
}
const bootstrap = `import os, sys, json, random, platform, importlib.metadata, resource, runpy, hashlib, signal
resource.setrlimit(resource.RLIMIT_CPU, (120,120))
resource.setrlimit(resource.RLIMIT_FSIZE, (20*1024*1024,20*1024*1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (128,128))
resource.setrlimit(resource.RLIMIT_CORE, (0,0))
try: resource.setrlimit(resource.RLIMIT_NPROC, (64,64))
except (ValueError, OSError): pass
config=json.load(open('parameters.json'))
signal.alarm(config['timeout'])
random.seed(config['seed'])
try:
 import numpy as np
 np.random.seed(config['seed'])
except ImportError: pass
json.dump(dict(python=sys.version, executable=sys.executable, platform=platform.platform(), packages=sorted(str(d.metadata.get('Name','?'))+'=='+d.version for d in importlib.metadata.distributions())), open('environment.json','w'))
# Record bounded, actually opened project inputs, without copying their contents.
inputs={}
root=os.environ['ATLAS_PROJECT']
def audit(event,args):
 if event!='open' or len(inputs)>=100: return
 try:
  name=os.path.realpath(os.fspath(args[0]))
  if not name.startswith(root+os.sep) or '/.atlas-runs/' in name or name in inputs: return
  if not os.path.isfile(name) or os.path.getsize(name)>20*1024*1024: return
  inputs[name]=None
  with open(name,'rb') as f: digest=hashlib.sha256(f.read()).hexdigest()
  inputs[name]=dict(name=os.path.relpath(name,root),sha256=digest,bytes=os.path.getsize(name))
 except (TypeError,OSError): pass
sys.addaudithook(audit)
try:
 sys.path.insert(0,root)
 runpy.run_path('experiment.py',init_globals=dict(parameters=config['parameters'],seed=config['seed'],project_dir=root,output_dir=os.getcwd()),run_name='__main__')
 try:
  import matplotlib.pyplot as plt
  for n in plt.get_fignums()[:8]: plt.figure(n).savefig('figure-'+str(n)+'.png',dpi=140,bbox_inches='tight')
 except ImportError: pass
finally:
 json.dump([v for v in inputs.values() if v],open('inputs.json','w'))
`;
export function createPythonWorkbench(store: ReturnType<typeof createPythonStore>, dataRoot: string): PythonWorkbench & {
    asset(chatId: string, runId: string, name: string): Buffer;
    open(chatId: string, runId?: string): Promise<void>;
} {
    const state = globalThis as typeof globalThis & {
        __atlasPythonProjects?: Set<string>;
    };
    const locks = state.__atlasPythonProjects ??= new Set<string>();
    const project = (chatId: string) => { const p = store.project(chatId); return p ? validatePythonProject(p, dataRoot) : null; };
    const runDirectory = (chatId: string, id: string) => {
        const run = store.read(chatId, id);
        const dir = path.join(run.project.path, ".atlas-runs", chatId, id);
        if (fs.realpathSync(dir) !== dir)
            throw new Error("Run directory changed or symlinked.");
        return dir;
    };
    return {
        project, list: store.list, read: store.read,
        async run(chatId: string, id: string, raw: PythonInput, signal: AbortSignal): Promise<PythonResult> {
            const input = pythonInput.parse(raw);
            const old = store.list(chatId).find(r => r.id === id);
            if (old) {
                if (old.status === "running") {
                    store.save({ ...old, status: "interrupted", finishedAt: new Date().toISOString(), stderr: "Execution interrupted. Rerun explicitly; Python side effects are never replayed automatically." });
                }
                const saved = store.read(chatId, id);
                return { runId: id, title: saved.title, status: saved.status, stdout: saved.stdout, stderr: saved.stderr, outputs: saved.outputs };
            }
            const p = project(chatId);
            if (!p)
                throw new Error("Enable a project in Workbench before running Python.");
            if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec"))
                throw new Error("Bounded Python currently requires macOS sandbox-exec. No unrestricted fallback is used.");
            if (locks.has(p.path))
                throw new Error("Another experiment is using this project. Try again after it finishes.");
            if (signal.aborted)
                throw new Error("Cancelled.");
            locks.add(p.path);
            try {
                const dir = path.join(p.path, ".atlas-runs", chatId, id);
                // Check existing ancestors before mkdir: do not follow a preplanted run-folder symlink.
                let ancestor = dir;
                while (!fs.existsSync(ancestor))
                    ancestor = path.dirname(ancestor);
                if (fs.realpathSync(ancestor) !== ancestor)
                    throw new Error("Experiment folders cannot be symlinked.");
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
                if (fs.realpathSync(dir) !== dir)
                    throw new Error("Experiment folders cannot be symlinked.");
                for (const [name, text] of Object.entries({ "experiment.py": input.code, "parameters.json": JSON.stringify({ parameters: input.parameters, seed: input.seed, timeout: input.timeout }), "_atlas_runner.py": bootstrap }))
                    fs.writeFileSync(path.join(dir, name), text, { flag: "wx", mode: 0o600 });
                const command = [p.interpreter, "-I", "-B", "_atlas_runner.py"];
                const environmentVariables = { NODE_ENV: "production" as const, PATH: "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin", HOME: dir, TMPDIR: dir, MPLCONFIGDIR: dir, MPLBACKEND: "Agg", PYTHONHASHSEED: String(input.seed), ATLAS_PROJECT: p.path, OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" };
                const run = { ...input, command, executionDirectory: dir, environmentVariables, id, chatId, project: p, startedAt: new Date().toISOString(), status: "running" as const, codeHash: hash(input.code), stdout: "", stderr: "", exitCode: null, outputs: [], inputs: [], kept: false, limitations: ["Numerical evidence is not a proof. Input hashes reference local files; external data and native-library reads may not be fully captured. Packages are recorded, not vendored. Memory is not hard-capped; use small experiments."] };
                store.save(run);
                const result = await new Promise<{
                    stdout: string;
                    stderr: string;
                    exitCode: number | null;
                }>((resolve, reject) => {
                    const child = spawn("/usr/bin/sandbox-exec", ["-p", pythonSandbox(p, dir), ...command], { cwd: dir, detached: true, env: environmentVariables, stdio: ["ignore", "pipe", "pipe"] as [
                            "ignore",
                            "pipe",
                            "pipe"
                        ] });
                    let stdout = "", stderr = "", bytes = 0, reason = "";
                    const kill = () => { try {
                        process.kill(-child.pid!, "SIGKILL");
                    }
                    catch {
                        child.kill("SIGKILL");
                    } };
                    const cancel = () => { reason = "Cancelled by learner."; kill(); };
                process.once("exit",kill);
                    const timer = setTimeout(() => { reason = `Stopped after ${input.timeout} seconds.`; kill(); }, input.timeout * 1000);
                    signal.addEventListener("abort", cancel, { once: true });
                    if (signal.aborted)
                        cancel();
                    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); process.removeListener("exit",kill); };
                    const collect = (data: Buffer, which: "stdout" | "stderr") => { bytes += data.length; if (bytes > 100000) {
                        reason = "Output limit reached.";
                        kill();
                        return;
                    } if (which === "stdout")
                        stdout += data.toString();
                    else
                        stderr += data.toString(); };
                    child.stdout.on("data", d => collect(d, "stdout"));
                    child.stderr.on("data", d => collect(d, "stderr"));
                    child.once("error", e => { cleanup(); reject(e); });
                    child.once("close", (code, terminationSignal) => { cleanup(); kill(); if (terminationSignal && !reason)
                        reason = `Python terminated by ${terminationSignal}.`; resolve({ stdout, stderr: stderr + (reason ? `\n${reason}` : ""), exitCode: reason ? null : code }); });
                }).catch(error => ({ stdout: "", stderr: error instanceof Error ? error.message : "Python could not start.", exitCode: null }));
                const readJSON = (name: string) => { try {
                    const file = path.join(dir, name);
                    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 1000000)
                        return undefined;
                    return JSON.parse(fs.readFileSync(file, "utf8"));
                }
                catch {
                    return undefined;
                } };
                let total = 0;
                const outputs = fs.readdirSync(dir).filter(name => /^[\w.-]+\.png$/.test(name)).slice(0, 8).flatMap(name => {
                    const file = path.join(dir, name), stat = fs.lstatSync(file);
                    if (!stat.isFile() || stat.size > 10000000 || (total += stat.size) > 20000000)
                        return [];
                    const bytes = fs.readFileSync(file);
                    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20) || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16000000)
                        return [];
                    store.retainOutput(chatId, id, name, bytes);
                    return [{ name, sha256: hash(bytes), bytes: bytes.length }];
                });
                const completed = { ...run, ...result, finishedAt: new Date().toISOString(), status: result.exitCode === 0 ? "done" as const : "error" as const, outputs, environment: z.object({ python: z.string().max(1000), executable: z.string().max(2000), platform: z.string().max(1000), packages: z.array(z.string().max(1000)).max(10000) }).safeParse(readJSON("environment.json")).data, inputs: z.array(z.object({ name: z.string().max(2000), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative().max(20 * 1024 * 1024) })).max(100).safeParse(readJSON("inputs.json")).data ?? [] };
                store.save(completed);
                return { runId: id, title: input.title, status: completed.status, stdout: result.stdout, stderr: result.stderr, outputs };
            }
            finally {
                locks.delete(p.path);
            }
        },
        asset(chatId, id, name) {
            const run = store.read(chatId, id), output = run.outputs.find(o => o.name === name);
            if (!output)
                throw new Error("Output not found.");
            const bytes = store.output(chatId, id, name);
            if (hash(bytes) !== output.sha256)
                throw new Error("Output changed since execution.");
            return bytes;
        },
        async open(chatId, id) {
            const p = project(chatId);
            if (!p)
                throw new Error("Enable a project first.");
            if (id && store.read(chatId, id).project.path !== p.path)
                throw new Error("Enable this run’s original project to open its editable files.");
            const target = id ? path.join(runDirectory(chatId, id), "experiment.py") : p.path;
            if (process.platform !== "darwin")
                throw new Error("VS Code opening currently supports macOS.");
            await new Promise<void>((resolve, reject) => { const child = spawn("/usr/bin/open", ["-a", "Visual Studio Code", target], { stdio: "ignore" }); child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error("Install Visual Studio Code to open this project."))); });
        },
    };
}
