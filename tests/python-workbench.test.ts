import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPythonStore } from "../src/store/python-workbench.ts";
import { createPythonWorkbench, pythonSandbox, validatePythonProject } from "../src/server/python-adapter.ts";
import { pythonInput } from "../src/core/python-workbench.ts";
import { buildSubagentSteer, isSubagentFailure } from "../src/core/contracts/jobs.ts";
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "atlas-python-test-"))), project = path.join(root, "project"), data = path.join(root, "data");
    fs.mkdirSync(project);
    const store = createPythonStore(data), workbench = createPythonWorkbench(store, data);
    return { root, project, data, store, workbench, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test("Python input budgets and seeds are validated", () => {
    assert.equal(pythonInput.parse({ title: "Test", code: "print(seed)" }).seed, 0);
    for (const input of [{ timeout: 121 }, { code: "x".repeat(40001) }, { seed: -1 }, { parameters: { x: Infinity } }])
        assert.throws(() => pythonInput.parse({ title: "Test", code: "pass", ...input }));
});
test("project access is off; home and app-data roots cannot be granted", () => {
    const f = fixture();
    try {
        assert.equal(f.workbench.project("chat_test"), null);
        assert.throws(() => validatePythonProject({ path: os.homedir(), interpreter: "/usr/bin/python3", network: false }, f.data));
        fs.mkdirSync(f.data, { recursive: true });
        assert.throws(() => validatePythonProject({ path: f.root, interpreter: "/usr/bin/python3", network: false }, f.data));
        const p = validatePythonProject({ path: f.project, interpreter: "/usr/bin/python3", network: false }, f.data);
        assert.equal(p.path, f.project);
        f.store.configure("chat_test", p);
        assert.deepEqual(f.workbench.project("chat_test"), p);
        f.store.configure("chat_test", null);
        assert.equal(f.workbench.project("chat_test"), null);
    }
    finally {
        f.cleanup();
    }
});
test("sandbox permits only project reads and run writes, with network opt-in", () => {
    const profile = pythonSandbox({ path: "/tmp/project", interpreter: "/usr/bin/python3", network: false }, "/tmp/project/run");
    assert.match(profile, /deny default/);
    assert.match(profile, /allow file-write\* \(subpath "\/tmp\/project\/run"/);
    assert.doesNotMatch(profile, /allow network/);
    assert.match(pythonSandbox({ path: "/tmp/project", interpreter: "/usr/bin/python3", network: true }, "/tmp/project/run"), /allow network/);
});
test("no project means no execution; session IDs cannot escape metadata", async () => {
    const f = fixture();
    try {
        await assert.rejects(f.workbench.run("chat_test", "job_test", pythonInput.parse({ title: "Test", code: "print(1)" }), new AbortController().signal), /Enable a project/);
        assert.throws(() => f.store.list("../../elsewhere"));
        assert.throws(() => f.store.read("chat_test", "../../secret"));
    }
    finally {
        f.cleanup();
    }
});
test("Python steers expose actual status and numerical limitations", () => {
    const result = { runId: "job_test", title: "Experiment", status: "error" as const, stdout: "", stderr: "missing numpy", outputs: [] };
    assert.equal(isSubagentFailure("python", result), true);
    const steer = buildSubagentSteer({ id: "job_test", kind: "python", toolCallId: "call_test" }, result);
    assert.match(String(steer.content), /missing numpy/);
    assert.match(String(steer.content), /not proof/);
});
const live = process.platform === "darwin" && process.env.ATLAS_TEST_PYTHON === "1";
test("real sandbox: run, seeded rerun, provenance, integrity and restart isolation", { skip: !live }, async () => {
    const f = fixture();
    try {
        f.store.configure("chat_test", { path: f.project, interpreter: process.env.ATLAS_TEST_INTERPRETER ?? "/usr/bin/python3", network: false });
        fs.writeFileSync(path.join(f.project, "input.txt"), "approved input");
        const secret = path.join(f.root, "private.txt");
        fs.writeFileSync(secret, "must not read");
        const code = `import random, json, os\nprint(parameters['n'], random.random())\nprint(open(project_dir+'/input.txt').read())\nfor p in [${JSON.stringify(secret)},'/Users/'+os.path.basename(os.path.expanduser('~'))+'/.ssh/id_rsa']:\n try: open(p).read(); raise RuntimeError('UNEXPECTED READ')\n except (PermissionError,FileNotFoundError): pass\ntry:\n open(project_dir+'/unauthorized.txt','w').write('no')\n raise RuntimeError('UNEXPECTED WRITE')\nexcept PermissionError: pass\nimport socket\ntry:\n socket.create_connection(('127.0.0.1',9),timeout=1)\n raise RuntimeError('UNEXPECTED NETWORK')\nexcept PermissionError: pass\nprint('boundaries held')`;
        const input = pythonInput.parse({ title: "Boundaries", code, parameters: { n: 42 }, seed: 17 });
        const first = await f.workbench.run("chat_test", "job_test", input, new AbortController().signal);
        assert.equal(first.status, "done", first.stderr);
        assert.match(first.stdout, /boundaries held/);
        const run = f.workbench.read("chat_test", "job_test");
        assert.ok(run.environment?.python);
        assert.ok(run.inputs.some(i => i.name === "input.txt"));
        const next = await f.workbench.run("chat_test", "job_second", input, new AbortController().signal);
        assert.equal(first.stdout, next.stdout);
        const restarted = createPythonWorkbench(createPythonStore(f.data), f.data);
        const duplicate = await restarted.run("chat_test", "job_test", pythonInput.parse({ title: "Changed", code: "raise Exception('must not run')" }), new AbortController().signal);
        assert.equal(duplicate.stdout, first.stdout);
        assert.throws(() => restarted.read("chat_other", "job_test"));
    }
    finally {
        f.cleanup();
    }
});
test("real sandbox: cancellation and time bounds retain failed runs", { skip: !live }, async () => {
    const f = fixture();
    try {
        f.store.configure("chat_test", { path: f.project, interpreter: process.env.ATLAS_TEST_INTERPRETER ?? "/usr/bin/python3", network: false });
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 1000);
        const result = await f.workbench.run("chat_test", "job_abort", pythonInput.parse({ title: "Cancel", code: "import time; time.sleep(30)" }), controller.signal);
        assert.equal(result.status, "error");
        assert.match(result.stderr, /Cancelled/);
        const timed = await f.workbench.run("chat_test", "job_timeout", pythonInput.parse({ title: "Timeout", code: "import time; time.sleep(30)", timeout: 1 }), new AbortController().signal);
        assert.match(timed.stderr, /Stopped after 1 seconds/);
    }
    finally {
        f.cleanup();
    }
});
test("real sandbox: NumPy simulation and Matplotlib figure survive project edits", { skip: !live }, async () => {
    const f = fixture();
    try {
        f.store.configure("chat_test", { path: f.project, interpreter: process.env.ATLAS_TEST_INTERPRETER ?? "/usr/bin/python3", network: false });
        const result = await f.workbench.run("chat_test", "job_plot", pythonInput.parse({ title: "Brownian paths", parameters: { steps: 50 }, seed: 7, code: "import numpy as np\nimport matplotlib.pyplot as plt\nx=np.cumsum(np.random.normal(size=parameters['steps']))\nplt.plot(x)\nplt.title('Seeded path')\nprint(float(x[-1]))" }), new AbortController().signal);
        assert.equal(result.status, "done", result.stderr);
        assert.equal(result.outputs.length, 1);
        const bytes = f.workbench.asset("chat_test", "job_plot", result.outputs[0]!.name);
        assert.ok(bytes.length > 1000);
        fs.writeFileSync(path.join(f.project, ".atlas-runs", "chat_test", "job_plot", result.outputs[0]!.name), "edited externally");
        assert.deepEqual(f.workbench.asset("chat_test", "job_plot", result.outputs[0]!.name), bytes);
        assert.throws(() => f.workbench.asset("chat_test", "job_plot", "../../private.txt"));
        const run = f.store.read("chat_test", "job_plot");
        f.store.save({ ...run, kept: true });
        assert.equal(createPythonStore(f.data).read("chat_test", "job_plot").kept, true);
    }
    finally {
        f.cleanup();
    }
});
test("real sandbox: project credentials and detached subprocesses are denied", { skip: !live }, async () => {
 const f=fixture();try {
  f.store.configure("chat_test",{path:f.project,interpreter:process.env.ATLAS_TEST_INTERPRETER??"/usr/bin/python3",network:false});
  fs.writeFileSync(path.join(f.project,".env"),"DUMMY_KEY=not-real");
  const result=await f.workbench.run("chat_test","job_credentials",pythonInput.parse({title:"Boundaries",code:"import subprocess\ntry:\n open(project_dir+'/.env').read()\n raise RuntimeError('Unexpected dotenv access')\nexcept PermissionError: pass\ntry:\n subprocess.Popen(['/bin/sleep','1'],start_new_session=True)\n raise RuntimeError('Unexpected child process')\nexcept OSError: pass\nprint('Denied credentials and subprocesses')"}),new AbortController().signal);
  assert.equal(result.status,"done",result.stderr);assert.match(result.stdout,/Denied credentials/);
 }finally{f.cleanup();}
});
test("real sandbox: network permission still blocks local services", { skip: !live }, async () => {
    const f = fixture();
    try {
        f.store.configure("chat_test", { path: f.project, interpreter: process.env.ATLAS_TEST_INTERPRETER ?? "/usr/bin/python3", network: true });
        const result = await f.workbench.run("chat_test", "job_network", pythonInput.parse({ title: "Local boundary", code: "import socket\ntry:\n socket.create_connection(('127.0.0.1',3005),timeout=1)\n raise RuntimeError('Unexpected local access')\nexcept PermissionError:\n print('Local services blocked')" }), new AbortController().signal);
        assert.equal(result.status, "done", result.stderr);
        assert.match(result.stdout, /Local services blocked/);
    }
    finally {
        f.cleanup();
    }
});
test("Python jobs use no model and save their result before delivery", async () => {
    const { createJobRunner } = await import("../src/agent/subagents/runner.ts");
    let job: any = { id: "job_local", kind: "python", chatId: "chat_test", toolCallId: "call_test", status: "running", input: { title: "Calc", code: "print(2)" } };
    let calls = 0, delivered = 0;
    const runner = createJobRunner({
        chatStore: { getChat: () => ({ id: "chat_test", messages: [] }) } as never,
        jobStore: { getJob: () => job, updateJob: (_id: string, patch: unknown) => job = { ...job, ...patch as object }, listJobs: () => [job] } as never,
        engineFor: () => { throw new Error("Local Python must not resolve a billed model"); },
        pythonWorkbench: { project: () => null, list: () => [], read: () => { throw new Error("unused"); }, run: async () => { calls++; return { runId: job.id, title: "Calc", status: "done", stdout: "2", stderr: "", outputs: [] }; } },
        deliver: async (steer) => { assert.equal(job.status, "done"); assert.equal(job.delivery.status, "pending"); assert.equal(steer.id, "steer_job_local"); delivered++; },
    });
    await runner.runJob(job.id, job.input);
    await runner.runJob(job.id);
    assert.equal(calls, 1);
    assert.equal(delivered, 1);
    assert.equal(job.usage, undefined);
});
test("interrupted run is retained and never replayed", async () => {
    const f = fixture();
    try {
        const input = pythonInput.parse({ title: "Interrupted", code: "raise Exception('never execute')" });
        f.store.save({ ...input, id: "job_interrupted", chatId: "chat_test", project: { path: f.project, interpreter: "/usr/bin/python3", network: false }, startedAt: new Date().toISOString(), status: "running", codeHash: "test", stdout: "partial", stderr: "", exitCode: null, outputs: [], inputs: [], limitations: [], kept: false });
        const result = await f.workbench.run("chat_test", "job_interrupted", input, new AbortController().signal);
        assert.equal(result.status, "interrupted");
        assert.equal(result.stdout, "partial");
        assert.match(result.stderr, /never replayed/);
    }
    finally {
        f.cleanup();
    }
});
test("symlinked run roots are rejected before writing through them", async () => {
    const f = fixture();
    try {
        const target = path.join(f.root, "elsewhere");
        fs.mkdirSync(target);
        fs.symlinkSync(target, path.join(f.project, ".atlas-runs"));
        f.store.configure("chat_test", { path: f.project, interpreter: "/usr/bin/python3", network: false });
        if (process.platform !== "darwin")
            return;
        await assert.rejects(f.workbench.run("chat_test", "job_symlink", pythonInput.parse({ title: "No escape", code: "pass" }), new AbortController().signal), /cannot be symlinked/);
        assert.deepEqual(fs.readdirSync(target), []);
    }
    finally {
        f.cleanup();
    }
});
