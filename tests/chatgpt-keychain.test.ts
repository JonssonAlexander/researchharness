import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { keychainStore, credentialStore, FORMAT, SERVICE } = require("../electron/chatgpt-keychain.cjs");

const empty = () => ({ version: 1, hostId: "urn:uuid:retained-fixture-host", activeId: null, registrations: [], allowBackgroundUse: false });
const state = (token = "fixture-access") => ({
	...empty(), activeId: "account", registrations: [{
		id: "account", clientId: "oaiapp_fixture", issuer: "https://auth.openai.com", subject: "fixture-subject", email: "fixture@example.invalid",
		tokens: { accessToken: token, refreshToken: "fixture-refresh", idToken: "fixture-id", expiresAt: 9999999999999, scopes: ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"] },
	}],
});
async function fixture() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-keychain-unit-"));
	const file = path.join(dir, "chatgpt-credentials.json");
	const values = new Map<string, string>();
	const controls = { denied: false, mismatch: false, failDelete: false, afterWrite: false };
	const entryFactory = (service: string, id: string) => {
		assert.equal(service, SERVICE);
		return {
			async setPassword(value: string) {
				if (controls.denied) throw new Error("fixture-private-error-token");
				values.set(id, value);
				if (controls.afterWrite) throw new Error("crash after durable Keychain write");
			},
			async getPassword() {
				if (controls.denied) throw new Error("fixture-private-error-token");
				return controls.mismatch ? "invalid-readback" : values.get(id) ?? null;
			},
			async deletePassword() {
				if (controls.denied || controls.failDelete) throw new Error("fixture-private-error-token");
				return values.delete(id);
			},
		};
	};
	const store = () => keychainStore(file, { entryFactory });
	const legacy = async () => fs.writeFile(file, JSON.stringify(state()), { mode: 0o600 });
	return { dir, file, values, controls, entryFactory, store, legacy, close: () => fs.rm(dir, { recursive: true, force: true }) };
}

test("macOS migration preserves complete identity/consent, verifies Keychain and removes active plaintext", async () => {
	const f = await fixture();
	try {
		await f.legacy();
		assert.deepEqual(await f.store().read(), state());
		const bytes = await fs.readFile(f.file, "utf8");
		assert.doesNotMatch(bytes, /fixture-access|fixture-refresh|fixture-id|fixture@example/);
		const locator = JSON.parse(bytes);
		assert.equal(locator.format, FORMAT); assert.equal(locator.version, 1);
		assert.equal((await fs.stat(f.file)).mode & 0o777, 0o600);
		assert.equal(f.values.size, 1);
		assert.deepEqual(await f.store().read(), state(), "fresh owner restores from Keychain");
		assert.deepEqual(await fs.readdir(f.dir), ["chatgpt-credentials.json"]);
	} finally { await f.close(); }
});

test("new and fully disconnected accounts retain nonsecret host/consent without touching Keychain", async () => {
	const f = await fixture();
	try {
		const store = keychainStore(f.file, { entryFactory: () => assert.fail("no secrets to access") });
		assert.equal(await store.read(), null);
		await store.write(empty());
		assert.deepEqual(await store.read(), empty());
		assert.equal(JSON.parse(await fs.readFile(f.file, "utf8")).itemId, null);
	} finally { await f.close(); }
});

for (const missing of [false, true]) test(`active Keychain ${missing ? "missing" : "denied"} fails closed without changing its locator`, async () => {
	const f = await fixture();
	try {
		await f.store().write(state()); const before = await fs.readFile(f.file, "utf8");
		if (missing) f.values.clear(); else f.controls.denied = true;
		await assert.rejects(f.store().read(), /^Error: storage$/);
		await assert.rejects(f.store().write(empty()), /^Error: storage$/);
		assert.equal(await fs.readFile(f.file, "utf8"), before);
	} finally { await f.close(); }
});

for (const phase of ["denied", "mismatch", "afterWrite"] as const) test(`migration ${phase} preserves legacy source and reconciles pending Keychain work`, async () => {
	const f = await fixture();
	try {
		await f.legacy(); const original = await fs.readFile(f.file, "utf8");
		f.controls[phase] = true;
		await assert.rejects(f.store().read(), /^Error: storage$/);
		assert.equal(await fs.readFile(f.file, "utf8"), original);
		const intent = await fs.readFile(`${f.file}.keychain-pending.json`, "utf8");
		assert.doesNotMatch(intent, /fixture-access|fixture-refresh|fixture-id/);
		f.controls[phase] = false;
		assert.deepEqual(await f.store().read(), state());
		assert.equal(f.values.size, 1, "recovery removed the interrupted item");
	} finally { await f.close(); }
});

test("failed locator publication preserves legacy bytes, and restart finishes without duplicated secrets", async () => {
	const f = await fixture();
	try {
		await f.legacy(); const original = await fs.readFile(f.file, "utf8");
		const io = { ...fs, rename: async (from: string, to: string) => { if (to === f.file) throw new Error("publish denied"); await fs.rename(from, to); } };
		await assert.rejects(keychainStore(f.file, { entryFactory: f.entryFactory, io }).read(), /^Error: storage$/);
		assert.equal(await fs.readFile(f.file, "utf8"), original);
		assert.deepEqual(await f.store().read(), state()); assert.equal(f.values.size, 1);
	} finally { await f.close(); }
});

test("failed pointer fsync recovers the published record rather than deleting its active item", async () => {
	const f = await fixture();
	try {
		await f.legacy(); let published = false;
		const io = { ...fs,
			rename: async (from: string, to: string) => { await fs.rename(from, to); if (to === f.file) published = true; },
			open: async (...args: Parameters<typeof fs.open>) => {
				const handle = await fs.open(...args);
				if (published && args[0] === f.dir) handle.sync = async () => { throw new Error("directory sync failed"); };
				return handle;
			},
		};
		await assert.rejects(keychainStore(f.file, { entryFactory: f.entryFactory, io }).read(), /^Error: storage$/);
		assert.deepEqual(await f.store().read(), state()); assert.equal(f.values.size, 1);
	} finally { await f.close(); }
});

test("interruption during old-item cleanup keeps the new revision and retries cleanup on restart", async () => {
	const f = await fixture();
	try {
		await f.store().write(state()); f.controls.failDelete = true;
		await assert.rejects(f.store().write(state("fixture-rotated-access")), /^Error: storage$/);
		assert.equal(f.values.size, 2);
		f.controls.failDelete = false;
		assert.deepEqual(await f.store().read(), state("fixture-rotated-access"));
		assert.equal(f.values.size, 1);
		await f.store().write(empty());
		assert.equal(f.values.size, 0, "disconnect removes Keychain secrets");
		assert.deepEqual(await f.store().read(), empty(), "host and preference survive disconnect");
	} finally { await f.close(); }
});

test("refresh updates are serialized; a late older write cannot replace the final queued revision", async () => {
	const f = await fixture();
	try {
		const store = f.store();
		await Promise.all([store.write(state("first")), store.write(state("second")), store.write(state("third"))]);
		assert.deepEqual(await store.read(), state("third")); assert.equal(f.values.size, 1);
	} finally { await f.close(); }
});

test("restart preserves a rotated token saved before locator publication", async () => {
	const f = await fixture();
	try {
		await f.store().write(state());
		f.controls.afterWrite = true;
		await assert.rejects(f.store().write(state("fixture-rotated-access")), /^Error: storage$/);
		f.controls.afterWrite = false;
		assert.deepEqual(await f.store().read(), state("fixture-rotated-access"));
		assert.equal(f.values.size, 1);
	} finally { await f.close(); }
});

test("a missing locator during interrupted rotation fails closed and preserves both recoverable items", async () => {
	const f = await fixture();
	try {
		await f.store().write(state()); f.controls.afterWrite = true;
		await assert.rejects(f.store().write(state("fixture-rotated-access")), /^Error: storage$/);
		await fs.unlink(f.file); f.controls.afterWrite = false;
		await assert.rejects(f.store().read(), /^Error: storage$/);
		assert.equal(f.values.size, 2);
	} finally { await f.close(); }
});

for (const bytes of ["{broken", "null", JSON.stringify({ format: FORMAT, version: 2, itemId: null, state: empty() }), JSON.stringify({ format: FORMAT, version: 1, itemId: null, state: state() })]) test(`invalid/future metadata cannot reset the account: ${bytes.slice(0, 60)}`, async () => {
	const f = await fixture();
	try {
		await fs.writeFile(f.file, bytes, { mode: 0o600 });
		await assert.rejects(f.store().read(), /^Error: storage$/);
		assert.equal(await fs.readFile(f.file, "utf8"), bytes);
	} finally { await f.close(); }
});

test("macOS defaults to Keychain; another platform refuses its locator instead of falling back", async () => {
	const f = await fixture();
	try {
		await credentialStore(f.file, { platform: "darwin", entryFactory: f.entryFactory }).write(state());
		await assert.rejects(credentialStore(f.file, { platform: "win32" }).read(), /^Error: storage$/);
		assert.doesNotMatch(await fs.readFile(f.file, "utf8"), /fixture-access/);
	} finally { await f.close(); }
});

test("credential paths reject symlinks and world-readable files without following or changing them", async () => {
	const f = await fixture();
	try {
		await f.legacy(); await fs.chmod(f.file, 0o644);
		await assert.rejects(f.store().read(), /^Error: storage$/);
		await fs.rename(f.file, `${f.file}.original`);
		await fs.symlink(`${f.file}.original`, f.file);
		await assert.rejects(f.store().read(), /^Error: storage$/);
		assert.equal(await fs.readFile(`${f.file}.original`, "utf8"), JSON.stringify(state()));
	} finally { await f.close(); }
});
