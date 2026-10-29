import { z } from "zod";
import { AtlasError, type AtlasStore } from "../core/atlas.ts";
import { MINDMAP_LIMITS, mindmapInput, mindmapId } from "../core/mindmaps.ts";
import { emit } from "../core/events.ts";
import { stores } from "./stores.ts";
import { prepareRnote } from "./rnote.ts";

export function createMindmapService(store: AtlasStore, prepare = prepareRnote) {
	return {
		async import(raw: unknown, original: Uint8Array, preview: Uint8Array | null, signal?: AbortSignal) {
			const parsed = mindmapInput.safeParse(raw);
			if (!parsed.success) throw new AtlasError(parsed.error.issues[0]?.message ?? "Invalid map import.");
			if (!!preview !== parsed.data.manualPreviewAcknowledged)
				throw new AtlasError("Confirm that the PNG was exported from this exact Rnote file.");
			const prepared = await prepare(original, preview, signal);
			if (signal?.aborted) throw new AtlasError("Import cancelled.", 499);
			store.mindmaps.capture(parsed.data, original, prepared.preview, prepared.info);
			emit("atlas-changed", {});
			return store.read();
		},
		archive(raw: unknown) {
			const input = z.object({id: mindmapId, expectedRevision: z.number().int().positive(), archived: z.boolean()}).strict().safeParse(raw);
			if (!input.success) throw new AtlasError("Invalid archive request.");
			store.mindmaps.setArchived(input.data.id, input.data.expectedRevision, input.data.archived);
			emit("atlas-changed", {});
			return store.read();
		},
	};
}
async function body(request: Request, limit: number) {
	if (Number(request.headers.get("content-length")) > limit) throw new AtlasError("Import exceeds the upload limit.", 413);
	const reader = request.body?.getReader();
	if (!reader) throw new AtlasError("Expected an upload.");
	const chunks: Uint8Array[] = []; let size = 0;
	try {
		for (;;) {
			const {value, done} = await reader.read(); if (done) break;
			size += value.length;
			if (size > limit) { await reader.cancel(); throw new AtlasError("Import exceeds the upload limit.", 413); }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	return Buffer.concat(chunks);
}
export async function importMindmapResponse(request: Request): Promise<Response> {
	try {
		const type = request.headers.get("content-type") ?? "";
		if (!type.startsWith("multipart/form-data;")) throw new AtlasError("Expected a file upload.", 415);
		const bytes = await body(request, MINDMAP_LIMITS.request);
		const form = await new Response(bytes, {headers: {"content-type": type}}).formData();
		for (const key of form.keys())
			if (!["metadata", "original", "preview"].includes(key) || form.getAll(key).length !== 1) throw new AtlasError("Unexpected or repeated upload field.");
		const raw = form.get("metadata"), original = form.get("original"), preview = form.get("preview");
		if (typeof raw !== "string" || raw.length > 32000 || !(original instanceof File) || (preview !== null && !(preview instanceof File)))
			throw new AtlasError("Choose an original Rnote file.");
		if (original.size > MINDMAP_LIMITS.original || (preview && preview.size > MINDMAP_LIMITS.preview)) throw new AtlasError("Original limit: 32 MB. PNG limit: 10 MB.", 413);
		const input = JSON.parse(raw);
		if (input.filename !== original.name || (preview && !preview.name.toLowerCase().endsWith(".png"))) throw new AtlasError("File name does not match its format.");
		return Response.json(await createMindmapService(stores.atlasStore).import(input, new Uint8Array(await original.arrayBuffer()),
			preview ? new Uint8Array(await preview.arrayBuffer()) : null, request.signal));
	} catch (error) { return failure(error); }
}
export async function archiveMindmapResponse(request: Request): Promise<Response> {
	try {
		if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new AtlasError("Expected JSON.", 415);
		return Response.json(createMindmapService(stores.atlasStore).archive(JSON.parse((await body(request, 4096)).toString("utf8"))));
	} catch (error) { return failure(error); }
}
export function mindmapAssetResponse(request: Request): Response {
	try {
		const query = new URL(request.url).searchParams, kind = query.get("kind");
		if (kind !== "original" && kind !== "preview") throw new AtlasError("Choose an original or preview.");
		const asset = stores.atlasStore.mindmaps.asset(query.get("revision") ?? "", kind);
		return new Response(Buffer.from(asset.bytes), {headers: {
			"Content-Type": kind === "original" ? "application/octet-stream" : "image/png",
			"Content-Disposition": `${kind === "original" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
			"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
		}});
	} catch (error) { return failure(error); }
}
function failure(error: unknown) {
	if (error instanceof AtlasError) return Response.json({error: error.message}, {status: error.status});
	if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError)
		return Response.json({error: "Invalid mind map request."}, {status: 400});
	if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return Response.json({error: "Source file is missing. Restore it from backup."}, {status: 404});
	return Response.json({error: "Mind map operation failed. Original files were not overwritten."}, {status: 500});
}
