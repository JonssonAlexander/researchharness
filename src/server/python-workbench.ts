import {requireSameOrigin} from "./request-origin.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pythonInput } from "../core/python-workbench.ts";
import { createJobRunner } from "../agent/subagents/runner.ts";
import { deliverJobResult } from "./jobs.ts";
import { z } from "zod";
import { PATHS } from "../../config.ts";
import { AtlasError } from "../core/atlas.ts";
import { stores } from "./stores.ts";
import { createPythonWorkbench, validatePythonProject } from "./python-adapter.ts";
import { isJobLive } from "../agent/subagents/aborts.ts";
export const pythonWorkbench = createPythonWorkbench(stores.pythonStore, PATHS.data);
const configuration = z.object({
    path: z.string().min(1).max(2000), interpreter: z.string().min(1).max(2000), network: z.boolean(), create: z.boolean().default(false),
});
export async function pythonWorkbenchResponse(request: Request, chatId: string): Promise<Response> {
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    try {
        if (!/^[\w-]+$/.test(chatId) || !stores.chatStore.getChat(chatId))
            throw new AtlasError("Session not found.", 404);
        const query = new URL(request.url).searchParams;
        if (request.method === "GET") {
            const runId = query.get("run");
            if (runId && query.has("asset"))
                return new Response(new Uint8Array(pythonWorkbench.asset(chatId, runId, query.get("asset")!)).buffer, { headers: { ...headers, "Content-Type": "image/png", "Content-Security-Policy": "default-src 'none'; sandbox" } });
            if (runId)
                return Response.json({ run: pythonWorkbench.read(chatId, runId) }, { headers });
            // Interrupted computations are retained, never automatically re-executed.
            for (const run of stores.pythonStore.list(chatId))
                if (run.status === "running" && !isJobLive(run.id))
                    stores.pythonStore.save({ ...run, status: "interrupted", finishedAt: new Date().toISOString(), stderr: "Execution interrupted. Rerun explicitly." });
            return Response.json({ project: pythonWorkbench.project(chatId), runs: pythonWorkbench.list(chatId).map(({ id, title, status, kept, startedAt }) => ({ id, title, status, kept, startedAt })), suggestedInterpreter: ["/opt/homebrew/bin/python3", "/Library/Frameworks/Python.framework/Versions/Current/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"].find(p => fs.existsSync(p)), supported: process.platform === "darwin" }, { headers });
        }
        requireSameOrigin(request);
        if (Number(request.headers.get("content-length") ?? 0) > 60000)
            throw new AtlasError("Workbench request too large.", 413);
        const raw = await request.text();
        if (raw.length > 60000)
            throw new AtlasError("Workbench request too large.", 413);
        const body = JSON.parse(raw);
        const active = stores.jobStore.listJobs(chatId).some(j => j.kind === "python" && j.status === "running");
        if (body.action === "configure") {
            if (active)
                throw new AtlasError("Wait for Python to finish or cancel it before changing project access.", 409);
            if (body.project === null) {
                stores.pythonStore.configure(chatId, null);
                return Response.json({ project: null }, { headers });
            }
            const c = configuration.parse(body.project);
            if (c.create) {
                if (!/^[\w -]{1,80}$/.test(c.path))
                    throw new Error("Choose a short project name.");
                const base = path.join(os.homedir(), "Documents", "Research Atlas Experiments");
                fs.mkdirSync(base, { recursive: true, mode: 0o700 });
                if (fs.realpathSync(base) !== base)
                    throw new Error("Project base cannot be symlinked.");
                c.path = path.join(base, c.path);
                fs.mkdirSync(c.path, { mode: 0o700 });
            }
            const project = validatePythonProject(c, PATHS.data);
            stores.pythonStore.configure(chatId, project);
            return Response.json({ project }, { headers });
        }
        if (body.action === "run") {
            if (!pythonWorkbench.project(chatId))
                throw new AtlasError("Enable a project first.");
            const input = pythonInput.parse(body.input);
            const requestId = z.string().uuid().parse(body.requestId), toolCallId = `python_manual_${requestId}`;
            const existing = stores.jobStore.findJobByToolCallId(chatId, toolCallId);
            const job = existing ?? stores.jobStore.createJob({ kind: "python", chatId, toolCallId, input });
            if (!existing)
                void createJobRunner({ chatStore: stores.chatStore, jobStore: stores.jobStore, pythonWorkbench, deliver: deliverJobResult }).runJob(job.id, { ...input, action: "run" });
            return Response.json({ runId: job.id }, { headers });
        }
        if (body.action === "keep") {
            const run = stores.pythonStore.read(chatId, String(body.runId));
            stores.pythonStore.save({ ...run, kept: body.kept === true });
            return Response.json({ ok: true }, { headers });
        }
        if (body.action === "open") {
            await pythonWorkbench.open(chatId, body.runId);
            return Response.json({ ok: true }, { headers });
        }
        // Edited scripts are imported only from an explicit learner action, never run silently.
        if (body.action === "load-code") {
            const run = stores.pythonStore.read(chatId, String(body.runId));
            if (pythonWorkbench.project(chatId)?.path !== run.project.path)
                throw new Error("Enable this run’s original project to load edited files.");
            const file = path.join(run.project.path, ".atlas-runs", chatId, run.id, "experiment.py");
            if (fs.realpathSync(file) !== file || fs.statSync(file).size > 40000)
                throw new Error("Script unavailable or too large.");
            return Response.json({ code: fs.readFileSync(file, "utf8") }, { headers });
        }
        throw new AtlasError("Unknown Workbench action.");
    }
    catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Workbench unavailable." }, { status: error instanceof AtlasError ? error.status : 400, headers });
    }
}
