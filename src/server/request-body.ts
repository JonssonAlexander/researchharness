import { AtlasError } from "../core/atlas.ts";

export async function readRequestBody(
	request: Request,
	limit: number,
	messages = { missing: "Expected an upload.", tooLarge: "Import exceeds the upload limit." },
) {
	if (Number(request.headers.get("content-length")) > limit) throw new AtlasError(messages.tooLarge, 413);
	const reader = request.body?.getReader();
	if (!reader) throw new AtlasError(messages.missing);

	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				void reader.cancel().catch(() => undefined);
				throw new AtlasError(messages.tooLarge, 413);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks);
}
