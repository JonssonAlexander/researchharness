import { AtlasError } from "../core/atlas.ts";
import { stores } from "./stores.ts";
/** The reader can fetch only a retained passage owned by this existing session. */
export function researchSourceResponse(request: Request, chatId: string): Response {
    try {
        if (!/^[\w-]+$/.test(chatId) || !stores.chatStore.getChat(chatId))
            throw new AtlasError("Session not found.", 404);
        const query = new URL(request.url).searchParams;
        const passage = stores.researchSources.passage(chatId, query.get("passage") ?? "");
        const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
        if (query.has("asset")) {
            const { bytes } = stores.researchSources.asset(chatId, passage.source.id);
            return new Response(new Uint8Array(bytes).buffer, { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=research-source.pdf", "Content-Security-Policy": "default-src 'none'; sandbox" } });
        }
        return Response.json({ passage }, { headers });
    }
    catch (error) {
        return Response.json({ error: error instanceof AtlasError ? error.message : "Research source could not be opened. Restore it from backup if missing or changed." }, { status: error instanceof AtlasError ? error.status : 409 });
    }
}
