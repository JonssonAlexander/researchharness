/** Persistent local development profile. Does not migrate, clear or reset data. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.platform === "darwin"
	? path.join(os.homedir(), "Library", "Application Support")
	: process.platform === "win32"
		? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
		: process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
const profile = path.resolve(process.env.RESEARCH_ATLAS_PROFILE_DIR || path.join(base, "ResearchAtlas-dev"));
const data = path.resolve(process.env.LH_DATA_DIR || path.join(profile, "data"));
const auth = path.resolve(process.env.LH_AUTH_FILE || path.join(profile, "auth.json"));
const lock = path.join(profile, "dev-server.lock");
fs.mkdirSync(profile, { recursive: true, mode: 0o700 });

let locked = false;
let child;
function unlock() {
	if (!locked) return;
	fs.unlinkSync(lock);
	locked = false;
}
try {
	const handle = fs.openSync(lock, "wx", 0o600);
	locked = true;
	try { fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, data, auth }) + "\n"); }
	finally { fs.closeSync(handle); }
	console.log(`[Research Atlas] Persistent profile: ${profile}`);
	child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", process.env.PORT || "3005", ...process.argv.slice(2)], {
		cwd: root, stdio: "inherit",
		env: { ...process.env, LH_DATA_DIR: data, LH_AUTH_FILE: auth, LH_IGNORE_ENV_KEYS: process.env.LH_IGNORE_ENV_KEYS ?? "1", NEXT_TELEMETRY_DISABLED: "1" },
	});
	child.once("error", () => { unlock(); console.error("Could not start the development server."); process.exitCode = 1; });
	child.once("exit", (code, signal) => { unlock(); process.exitCode = code ?? (signal ? 1 : 0); });
	for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child?.kill(signal));
} catch (error) {
	if (locked) unlock();
	console.error(error.code === "EEXIST"
		? `This profile is locked. Stop its running server first. After a crash, verify the PID in ${lock} is no longer running before removing that lock.`
		: "Could not open the persistent development profile. Check its permissions.");
	process.exitCode = 1;
}
