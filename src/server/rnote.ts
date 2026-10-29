import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { crc32, inflateSync, gunzipSync } from "node:zlib";
import { AtlasError } from "../core/atlas.ts";
import { MINDMAP_LIMITS, type MindmapPreparation } from "../core/mindmaps.ts";

/** Accept bounded, noninterlaced 8-bit PNGs, not executable SVG/HTML or APNG.
 * Check CRCs, dimensions, decompression size and every scanline before serving. */
export function validateMindmapPng(bytes: Uint8Array): void {
	const b = Buffer.from(bytes), bad = () => { throw new AtlasError("Use a valid, noninterlaced 8-bit PNG exported from Rnote."); };
	if (b.length > MINDMAP_LIMITS.preview || b.subarray(0,8).toString("hex") !== "89504e470d0a1a0a") bad();
	let offset = 8, width = 0, height = 0, channels = 0, ended = false, palette = false, dataEnded = false;
	const data: Buffer[] = [];
	while (offset+12 <= b.length) {
		const length = b.readUInt32BE(offset), end = offset+8+length;
		if (end+4 > b.length || crc32(b.subarray(offset+4,end)) !== b.readUInt32BE(end)) bad();
		const type = b.toString("ascii", offset+4, offset+8), chunk = b.subarray(offset+8,end);
		if (offset === 8 && type !== "IHDR") bad();
		if (type === "IHDR") {
			if (offset !== 8 || length !== 13) bad();
			width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
			channels = ({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[chunk[9]!] ?? 0;
			if (!width || !height || width > 8192 || height > 8192 || width*height > 16000000 ||
				!channels || chunk[8] !== 8 || chunk[10] || chunk[11] || chunk[12]) bad();
		} else if (type === "PLTE") {
			if (data.length || !length || length%3 || length > 768) bad();
			palette = true;
		} else if (type === "IDAT") {
			if (dataEnded || (b[25] === 3 && !palette)) bad();
			data.push(chunk);
		} else if (type === "IEND") {
			if (length || end+4 !== b.length || !data.length) bad();
			ended = true; break;
		} else {
			if (type[0] === type[0]?.toUpperCase() || ["acTL","fcTL","fdAT"].includes(type)) bad();
			if (data.length) dataEnded = true;
		}
		offset = end+4;
	}
	if (!ended) bad();
	const stride = width*channels+1, size = stride*height;
	try {
		const pixels = inflateSync(Buffer.concat(data), {maxOutputLength: size});
		if (pixels.length !== size) bad();
		for (let y=0; y<height; y++) if (pixels[y*stride]! > 4) bad();
	} catch { bad(); }
}

const run = promisify(execFile);
export function rnoteExecutable(): string | null {
	const configured = process.env.RNOTE_CLI;
	if (configured && path.isAbsolute(configured)) return configured;
	return process.platform === "darwin" ? "/Applications/Rnote.app/Contents/MacOS/rnote-cli" : null;
}

/** Only the generated temporary paths reach the CLI. No shell, user arguments,
 * external file writes, provider credentials, network calls or original overwrites. */
export async function prepareRnote(original: Uint8Array, manual: Uint8Array | null, signal?: AbortSignal) {
	if (original.length < 3 || original.length > MINDMAP_LIMITS.original || original[0] !== 0x1f || original[1] !== 0x8b || original[2] !== 8)
		throw new AtlasError("Choose a .rnote file saved by Rnote (up to 32 MB).");
	try { gunzipSync(original, {maxOutputLength: 128 * 1024 * 1024}); }
	catch { throw new AtlasError("The Rnote file is damaged or expands beyond the 128 MB import limit."); }
	if (manual) validateMindmapPng(manual);
	const info: MindmapPreparation = {validation: "unverified", previewKind: manual ? "manual-png" : "none",
		notice: "Rnote validation is unavailable on this host. Original preserved without format validation."};
	const cli = rnoteExecutable();
	if (!cli || !(await fs.stat(cli).catch(() => null))?.isFile()) return {preview: manual, info};
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-rnote-"));
	try {
		const source = path.join(dir, "source.rnote"), preview = path.join(dir, "preview.png");
		await fs.writeFile(source, original, {mode: 0o600});
		const options = {timeout: 30000, maxBuffer: 65536, signal, killSignal: "SIGKILL" as const,
			env: {NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: os.homedir(), LANG: "en_US.UTF-8", TMPDIR: os.tmpdir()}};
		try {
			const checked = await run(cli, ["test", source], {...options, timeout: 60000, encoding: "utf8"});
			if (!checked.stdout.includes("Test succeeded for file")) throw new Error("Rnote did not confirm validation");
		}
		catch (error) {
			if (signal?.aborted) throw error;
			if (typeof (error as NodeJS.ErrnoException).code === "string") return {preview: manual, info};
			throw new AtlasError((error as {killed?:boolean}).killed
				? "Rnote validation timed out after 60 seconds. Nothing was imported; your original is unchanged. Retry once Rnote has finished opening."
				: "Rnote could not validate this file. Nothing was imported; open it in Rnote and check that it loads correctly.", 422);
		}
		info.validation = "rnote-cli"; info.notice = null;
		if (manual) return {preview: manual, info};
		try {
			await run(cli, ["thumbnail", "--size", "3072", source, preview], options);
			const stat = await fs.stat(preview);
			if (stat.size > MINDMAP_LIMITS.preview) throw new Error("Preview too large");
			const bytes = await fs.readFile(preview);
			validateMindmapPng(bytes);
			return {preview: bytes, info: {...info, previewKind: "rnote-thumbnail" as const}};
		} catch (error) {
			if (signal?.aborted) throw error;
			return {preview: null, info: {...info, notice: "Automatic preview failed. Original preserved; import another revision with a PNG exported from this file."}};
		}
	} finally { await fs.rm(dir, {recursive: true, force: true}); }
}

/** Readable pages for interpretation; thumbnails are never a model-input fallback. */
export async function exportRnotePages(original:Uint8Array,signal?:AbortSignal):Promise<Uint8Array[]> {
	const cli=rnoteExecutable();
	if(!cli || !(await fs.stat(cli).catch(()=>null))?.isFile())
		throw new AtlasError("Full-page export is unavailable. Import this revision with a readable PNG exported from Rnote.",422);
	const dir=await fs.mkdtemp(path.join(os.tmpdir(),"atlas-rnote-pages-"));
	try {
		const source=path.join(dir,"source.rnote"),pages=path.join(dir,"pages");
		await fs.writeFile(source,original,{mode:0o600});await fs.mkdir(pages,{mode:0o700});
		await run(cli,["export","doc-pages","--output-dir",pages,"--output-file-stem","page","--export-format","png","--bitmap-scalefactor","1.5","--on-conflict","overwrite",source],{
			timeout:30000,maxBuffer:65536,killSignal:"SIGKILL",signal,
			env:{NODE_ENV:process.env.NODE_ENV,PATH:process.env.PATH,HOME:os.homedir(),LANG:"en_US.UTF-8",TMPDIR:os.tmpdir()},
		});
		const names=(await fs.readdir(pages)).filter(n=>/^page.*\.png$/.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
		if(!names.length||names.length>8)throw new AtlasError("Interpretation supports 1–8 pages. Export a smaller map or a readable PNG.",422);
		const images:Uint8Array[]=[];let total=0;
		for(const name of names) {
			const file=path.join(pages,name),stat=await fs.lstat(file);
			if(!stat.isFile()||stat.size>MINDMAP_LIMITS.preview||(total+=stat.size)>20*1024*1024)
				throw new AtlasError("Exported pages exceed the interpretation image limit.",422);
			const bytes=await fs.readFile(file);validateMindmapPng(bytes);images.push(bytes);
		}
		return images;
	} finally {await fs.rm(dir,{recursive:true,force:true});}
}
