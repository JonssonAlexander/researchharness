import { AtlasError, atlasCommandSchema, type AtlasStore } from "../core/atlas.ts";
import { emit } from "../core/events.ts";
import { stores } from "./stores.ts";

/** Only explicit owner-authored saves are exposed. No model tool writes Atlas. */
export function createAtlasService(store: AtlasStore, propositionIds: () => Set<string>) {
	return {
		read: () => store.read(),
		save(input: unknown) {
			const result = atlasCommandSchema.safeParse(input);
			if (!result.success) throw new AtlasError(result.error.issues[0]?.message ?? "Invalid Atlas input.");
			const command = result.data;
			if (command.kind === "concept") {
				const known = propositionIds();
				if (command.propositionIds.some((id) => !known.has(id)))
					throw new AtlasError("A linked proposition no longer exists. Reload before saving.", 409);
			}
			store.save(command);
			emit("atlas-changed", {});
			return store.read();
		},
	};
}
const service = () =>
	createAtlasService(stores.atlasStore, () => new Set(stores.graphStore.readNodes().map((n) => n.id)));
export function atlasResponse(): Response {
	try {
		return Response.json(service().read(), { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		return failure(error);
	}
}
export async function saveAtlasResponse(request: Request): Promise<Response> {
	if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
		return Response.json({ error: "Expected JSON." }, { status: 415 });
	try {
		const reader = request.body?.getReader();
		if (!reader) throw new AtlasError("Expected an Atlas change.");
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > 65536) {
					await reader.cancel();
					throw new AtlasError("Atlas change is too large.", 413);
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		return Response.json(service().save(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
	} catch (error) {
		return failure(error);
	}
}
function failure(error: unknown): Response {
	if (error instanceof AtlasError) return Response.json({ error: error.message }, { status: error.status });
	if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON." }, { status: 400 });
	return Response.json({ error: "Atlas could not be read or saved." }, { status: 500 });
}
