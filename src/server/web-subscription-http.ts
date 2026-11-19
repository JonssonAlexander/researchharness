import { AtlasError } from "../core/atlas.ts";
import { NATIVE_SUBSCRIPTIONS } from "../core/contracts/subscriptions.ts";
import { readRequestBody } from "./request-body.ts";
import { webSubscriptionOwner, webSubscriptionsEnabled, webSubscriptionStatus } from "./web-subscriptions.ts";

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
/** Same-origin browser controls, not user authentication. Web/dev deliberately
 * retains the existing shared-server/API-key trust model. Never trust forwarded
 * origins or add CORS grants here. A public deployment needs its own access gate. */
export function subscriptionRequestOrigin(request: Request): string | undefined {
	try {
		const url = new URL(request.url);
		const host = request.headers.get("host") ?? url.host;
		const addressed = new URL(`${url.protocol}//${host}`);
		if (!["http:", "https:"].includes(addressed.protocol) || addressed.username || addressed.password || addressed.pathname !== "/" || addressed.search || addressed.hash) return;
		return addressed.origin;
	} catch { return; }
}
function authorized(request: Request): boolean {
	const origin = subscriptionRequestOrigin(request);
	if (!origin || request.headers.get("x-learnharness-subscriptions") !== "1") return false;
	if (request.headers.get("sec-fetch-site") === "cross-site") return false;
	const supplied = request.headers.get("origin");
	return request.method === "GET" ? !supplied || supplied === origin : supplied === origin;
}
function error(message: string, status: number) { return Response.json({ error: message }, { status, headers: HEADERS }); }
export async function subscriptionControlsResponse(request: Request): Promise<Response> {
	if (!webSubscriptionsEnabled()) return error("Web subscription controls are unavailable in desktop-owned mode.", 404);
	if (!authorized(request)) return error("Subscription controls require a same-origin LearnHarness request.", 403);
	try {
		if (request.method === "GET") return Response.json(await webSubscriptionStatus(), { headers: HEADERS });
		if (request.method !== "POST") return error("Unsupported method.", 405);
		if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return error("Expected JSON.", 415);
		let body: Buffer;
		try {
			body = await readRequestBody(request, 16384, {
				missing: "Expected a command.",
				tooLarge: "Request too large.",
			});
		} catch (cause) {
			if (cause instanceof AtlasError) return error(cause.message, cause.status);
			throw cause;
		}
		const command: unknown = JSON.parse(body.toString("utf8"));
		if (!command || typeof command !== "object" || Array.isArray(command)) return error("Invalid command.", 400);
		const fields = command as Record<string, unknown>;
		const providerId = fields.providerId;
		if (providerId !== "chatgpt" && !NATIVE_SUBSCRIPTIONS.some((provider) => provider.providerId === providerId)) return error("Unsupported connection.", 400);
		const allowed = providerId === "chatgpt" ? ["login", "cancel", "select", "disconnect", "logout", "consent"] : ["login", "cancel", "respond", "open", "retry", "disconnect", "consent"];
		if (typeof fields.op !== "string" || !allowed.includes(fields.op)) return error("Unsupported control.", 400);
		return Response.json(await webSubscriptionOwner().control(providerId as string, fields, subscriptionRequestOrigin(request)!), { headers: HEADERS });
	} catch {
		return error("The subscription connection could not be changed. Retry or reconnect in Providers.", 400);
	}
}
/** One-use same-origin navigation. Full provider authorization URLs go only to
 * a top-level browser redirect, never status JSON, the SSE bus or application JS. */
export async function subscriptionBrowserResponse(request: Request): Promise<Response> {
	if (!webSubscriptionsEnabled()) return error("Unavailable.", 404);
	const origin = subscriptionRequestOrigin(request);
	if (!origin || (request.method === "POST" ? !authorized(request) : request.headers.get("sec-fetch-site") !== "same-origin")) return error("Open sign-in from LearnHarness.", 403);
	const id = new URL(request.url).searchParams.get("id");
	if (!id || !/^[0-9a-f-]{36}$/.test(id)) return error("This sign-in action is no longer available.", 410);
	const target = await webSubscriptionOwner().takeBrowserAction(id, origin);
	if (!target) return error("This sign-in action is no longer available.", 410);
	return new Response(null, { status: 303, headers: { ...HEADERS, Location: target } });
}
