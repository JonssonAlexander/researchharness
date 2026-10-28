"use strict";

// Shared by the Node web owner and Electron main. No renderer/native OAuth access.
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { validateState, fileStore } = require("./chatgpt.cjs");

const SERVICE = "org.researchatlas.chatgpt";
const FORMAT = "research-atlas.chatgpt.keychain";
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const optionalId = (value) => value === null || uuid(value);
const failure = () => Object.assign(new Error("storage"), { code: "storage" });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Only a fresh/disconnected record with no accounts or extra fields can live on disk.
const inline = (state) => state.registrations.length === 0 && Object.keys(state).every((key) => ["version", "hostId", "activeId", "registrations", "allowBackgroundUse"].includes(key));

/** One writer per auth directory, as for the existing JSON adapter. All methods serialize.
 * Each update creates an immutable Keychain item, verifies it, then atomically publishes
 * its locator. A nonsecret intent file makes interrupted item creation/deletion retryable.
 */
function keychainStore(file, { entryFactory, keyringRoot, io = fs } = {}) {
	const journal = `${file}.keychain-pending.json`;
	let queue = Promise.resolve();
	const serial = (fn) => {
		const next = queue.then(fn, fn);
		queue = next.catch(() => {});
		return next.catch(() => { throw failure(); });
	};
	const entry = (id) => {
		if (entryFactory) return entryFactory(SERVICE, id);
		const binding = keyringRoot
			? createRequire(path.join(keyringRoot, "package.json"))("@napi-rs/keyring")
			: require("@napi-rs/keyring");
		return new binding.AsyncEntry(SERVICE, id);
	};
	async function readJSON(target) {
		try {
			const stat = await io.lstat(target);
			if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw failure();
			return JSON.parse(await io.readFile(target, "utf8"));
		} catch (err) { if (err.code === "ENOENT") return undefined; throw failure(); }
	}
	async function syncDirectory() {
		const dir = await io.open(path.dirname(file), "r");
		try { await dir.sync(); } finally { await dir.close(); }
	}
	async function atomicJSON(target, value) {
		await io.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
		const temp = `${target}.${randomUUID()}.tmp`;
		let handle;
		try {
			handle = await io.open(temp, "wx", 0o600);
			await handle.writeFile(`${JSON.stringify(value)}\n`);
			await handle.sync(); await handle.close(); handle = null;
			await io.rename(temp, target);
			await syncDirectory();
		} finally { await handle?.close().catch(() => {}); await io.unlink(temp).catch(() => {}); }
	}
	function document(value) {
		if (value === undefined) return null;
		if (!value || typeof value !== "object" || Array.isArray(value)) throw failure();
		if (value.format !== FORMAT) return { legacy: validateState(value) };
		if (value.version !== 1 || !optionalId(value.itemId)) throw failure();
		if (value.itemId === null) {
			validateState(value.state);
			if (!inline(value.state)) throw failure();
		} else if (Object.hasOwn(value, "state")) throw failure();
		return value;
	}
	async function load(doc) {
		if (!doc) return null;
		if (doc.legacy) return doc.legacy;
		if (doc.itemId === null) return doc.state;
		const secret = await entry(doc.itemId).getPassword();
		if (typeof secret !== "string") throw failure();
		return validateState(JSON.parse(secret));
	}
	async function recover(doc) {
		const intent = await readJSON(journal);
		if (intent === undefined) return doc;
		if (!intent || typeof intent !== "object") throw failure();
		if (intent.format !== `${FORMAT}.intent` || intent.version !== 1 || !optionalId(intent.next) || !optionalId(intent.previous) || !/^[a-f0-9]{64}$/.test(intent.digest) || (intent.next !== null && intent.next === intent.previous)) throw failure();
		const active = doc?.itemId ?? null;
		if ((!doc && intent.previous !== null) || (active !== intent.next && active !== intent.previous)) throw failure();
		// A refresh may already have rotated remotely. Preserve a completely written
		// staged revision even when the process died before publishing its locator.
		if (intent.next !== null && active !== intent.next) {
			const bytes = await entry(intent.next).getPassword();
			if (typeof bytes === "string" && digest(bytes) === intent.digest) {
				validateState(JSON.parse(bytes));
				doc = { format: FORMAT, version: 1, itemId: intent.next };
				await atomicJSON(file, doc);
			}
		}
		for (const id of new Set([intent.next, intent.previous])) {
			if (id !== null && id !== doc?.itemId) await entry(id).deletePassword();
		}
		await io.unlink(journal);
		await syncDirectory();
		return doc;
	}
	async function publish(state, previous) {
		validateState(state);
		const id = inline(state) ? null : randomUUID();
		const bytes = JSON.stringify(state);
		// Persist only nonsecret item identifiers before any externally durable step.
		await atomicJSON(journal, { format: `${FORMAT}.intent`, version: 1, next: id, previous: previous?.itemId ?? null, digest: digest(bytes) });
		if (id !== null) {
			const secret = entry(id);
			await secret.setPassword(bytes);
			if (await secret.getPassword() !== bytes) throw failure();
		}
		const doc = { format: FORMAT, version: 1, itemId: id, ...(id === null ? { state } : {}) };
		// Replacing the original file removes its active plaintext representation.
		await atomicJSON(file, doc);
		await recover(doc);
	}
	return {
		read: () => serial(async () => {
			let doc = document(await readJSON(file));
			await load(doc); // Verify the active item before retiring anything.
			doc = await recover(doc);
			const state = await load(doc);
			if (doc?.legacy) await publish(state, doc);
			return state;
		}),
		write: (state) => serial(async () => {
			let doc = document(await readJSON(file));
			await load(doc);
			doc = await recover(doc);
			await publish(state, doc);
		}),
	};
}

function credentialStore(file, options = {}) {
	if ((options.platform ?? process.platform) === "darwin") return keychainStore(file, options);
	// Never reinterpret a macOS locator as an empty/new connection on another OS.
	return fileStore(file);
}

module.exports = { credentialStore, keychainStore, SERVICE, FORMAT };
