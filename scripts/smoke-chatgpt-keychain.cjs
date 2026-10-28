"use strict";

// Import-only by default. --exercise explicitly opts into unique dummy Keychain
// entries on macOS and removes them afterward. --cross-runtime additionally
// checks Node -> Electron -> Node access, which can require a macOS ACL prompt.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");
let stage = "binding initialization";

const repo = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const bindingRoot = path.resolve(args.includes("--standalone") ? args[args.indexOf("--standalone") + 1] : repo);
const localRequire = createRequire(path.join(bindingRoot, "package.json"));
const inside = (file) => { const rel = path.relative(bindingRoot, file); assert(!rel.startsWith("..") && !path.isAbsolute(rel)); };
const { keychainStore, SERVICE } = require("../electron/chatgpt-keychain.cjs");
const factory = (service, id) => new (localRequire("@napi-rs/keyring").AsyncEntry)(service, id);
const store = (file) => keychainStore(file, { entryFactory: factory });

async function main() {
	inside(localRequire.resolve("@napi-rs/keyring"));
	const binding = localRequire("@napi-rs/keyring");
	assert.equal(typeof binding.AsyncEntry, "function");
	for (const file of Object.keys(require.cache).filter((p) => p.includes(`${path.sep}@napi-rs${path.sep}keyring`))) inside(file);
	console.log("[keychain-smoke] native binding initialized within selected payload; no credential access");
	if (args.includes("--child")) {
		const dir = args[args.indexOf("--child") + 1];
		assert(path.basename(dir).startsWith("atlas-keychain-smoke-"));
		const vault = store(path.join(dir, "chatgpt-credentials.json"));
		const record = await vault.read();
		assert.equal(record.hostId, "atlas-dummy-keychain-smoke");
		assert.equal(record.registrations[0].tokens.accessToken, "dummy-access-not-a-real-token");
		record.registrations[0].tokens.accessToken = "dummy-rotated-not-a-real-token";
		await vault.write(record);
		console.log("[keychain-smoke] Electron read and update passed");
		return;
	}
	if (!args.includes("--exercise")) return;
	assert.equal(process.platform, "darwin", "real Keychain exercise is macOS-only");
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-keychain-smoke-"));
	const file = path.join(dir, "chatgpt-credentials.json");
	const blank = { version: 1, hostId: "atlas-dummy-keychain-smoke", activeId: null, registrations: [], allowBackgroundUse: false };
	const record = { ...blank, activeId: "dummy", registrations: [{ id: "dummy", clientId: "oaiapp_dummy", issuer: "https://auth.openai.com", subject: "dummy", tokens: { accessToken: "dummy-access-not-a-real-token", refreshToken: "dummy-refresh-not-a-real-token", idToken: "dummy-id-not-a-real-token", scopes: [], expiresAt: 9999999999999 } }] };
	const vault = store(file);
	try {
		stage = "dummy credential creation";
		await vault.write(record);
		assert.deepEqual(await vault.read(), record);
		assert(!(await fs.readFile(file, "utf8")).includes("dummy-access"));
		stage = "credential rotation";
		if (args.includes("--cross-runtime")) {
		const electron = require("electron");
		await new Promise((resolve, reject) => {
			const child = spawn(electron, [__filename, "--child", dir, ...(args.includes("--standalone") ? ["--standalone", bindingRoot] : [])], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
			child.stdout.pipe(process.stdout);
			// No arbitrary native exception details in normal output.
			child.stderr.resume();
			const timeout = setTimeout(() => { child.kill(); reject(new Error("Electron Keychain probe timed out")); }, 60000);
			child.on("error", () => { clearTimeout(timeout); reject(new Error("Electron Keychain probe could not start")); });
			child.on("exit", (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error("Electron Keychain probe failed")); });
		});
		} else {
			record.registrations[0].tokens.accessToken = "dummy-rotated-not-a-real-token";
			await vault.write(record);
		}
		assert.equal((await vault.read()).registrations[0].tokens.accessToken, "dummy-rotated-not-a-real-token");
		stage = "credential deletion";
		const id = JSON.parse(await fs.readFile(file, "utf8")).itemId;
		await vault.write(blank);
		assert.equal(await factory(SERVICE, id).getPassword(), null);
		console.log("[keychain-smoke] create, restore, rotate and delete passed using dummy credentials only");
	} finally {
		// Reconcile pending work, then remove only this isolated probe's secret record.
		try { await vault.read(); await vault.write(blank); await fs.rm(dir, { recursive: true, force: true }); }
		catch { console.error("[keychain-smoke] dummy cleanup incomplete; isolated locator retained for retry"); process.exitCode = 1; }
	}
}
main().catch(() => { console.error(`[keychain-smoke] failed during ${stage}; credentials and native error details suppressed`); process.exitCode = 1; });
