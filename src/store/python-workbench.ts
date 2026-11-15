import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "./atomic-write.ts";
import type { PythonProject, PythonRun } from "../core/python-workbench.ts";
/** Metadata belongs to the app; user projects contain ordinary scripts and inputs. */
export function createPythonStore(root: string) {
    const directory = (chatId: string) => {
        if (!/^[\w-]+$/.test(chatId))
            throw new Error("Invalid session.");
        const dir = path.join(root, chatId);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        if (fs.realpathSync(dir) !== path.resolve(dir))
            throw new Error("Workbench metadata cannot be symlinked.");
        return dir;
    };
    const record = (chatId: string, id: string) => {
        if (!/^(job|run)_[\w-]+$/.test(id))
            throw new Error("Invalid run.");
        return path.join(directory(chatId), `${id}.json`);
    };
    const read = (chatId: string, id: string): PythonRun => {
        const file = record(chatId, id);
        if (fs.lstatSync(file).isSymbolicLink())
            throw new Error("Invalid run file.");
        const run = JSON.parse(fs.readFileSync(file, "utf8")) as PythonRun;
        if (run.id !== id || run.chatId !== chatId)
            throw new Error("Run does not belong to this session.");
        return run;
    };
    return {
        retainOutput(chatId: string, id: string, name: string, bytes: Buffer) {
            record(chatId, id);
            if (!/^[\w.-]+\.png$/.test(name))
                throw new Error("Invalid figure name.");
            const dir = path.join(directory(chatId), id);
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            if (fs.realpathSync(dir) !== dir)
                throw new Error("Figure storage cannot be symlinked.");
            fs.writeFileSync(path.join(dir, name), bytes, { flag: "wx", mode: 0o600 });
        },
        output(chatId: string, id: string, name: string) {
            record(chatId, id);
            if (!/^[\w.-]+\.png$/.test(name))
                throw new Error("Invalid figure name.");
            const file = path.join(directory(chatId), id, name);
            if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile() || fs.statSync(file).size > 10000000)
                throw new Error("Figure storage changed.");
            return fs.readFileSync(file);
        },
        project(chatId: string): PythonProject | null {
            const file = path.join(directory(chatId), "project.json");
            if (!fs.existsSync(file))
                return null;
            if (fs.lstatSync(file).isSymbolicLink())
                throw new Error("Invalid permission file.");
            return JSON.parse(fs.readFileSync(file, "utf8"));
        },
        configure(chatId: string, project: PythonProject | null) {
            writeFileAtomicSync(path.join(directory(chatId), "project.json"), JSON.stringify(project), { mode: 0o600 });
        },
        save(run: PythonRun) { writeFileAtomicSync(record(run.chatId, run.id), JSON.stringify(run), { mode: 0o600 }); },
        read,
        list(chatId: string) {
            return fs.readdirSync(directory(chatId)).filter(f => /^(job|run)_[\w-]+\.json$/.test(f))
                .map(f => read(chatId, f.slice(0, -5))).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        },
    };
}
