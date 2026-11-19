import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { createWebTools } from "../tools/web.ts";
import { createPdfReadTools } from "../tools/pdf-read.ts";
import type { SearchProvider } from "../../core/search.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";

/**
 * The researcher sub-agent (vision §2.5): a SEPARATE ToolLoopAgent instance
 * from the teacher — an isolated loop with only web_search + web_fetch, so
 * raw search/fetch churn never touches the teacher's context window.
 *
 * System prompt adapted from the pi researcher agent
 * (~/.pi/agent/extensions/interactive-subagents/agents/researcher.md).
 * The engine is injectable so tests run the loop with a scripted faux engine.
 */

const INSTRUCTIONS = `Research the brief for the teacher using only the task for lesson context.
Break the question into 2-4 searchable facets. Use web_search for direct answers, authoritative sources and practical evidence such as benchmarks and case studies. Check recent changes for time-sensitive topics. Refine queries to fill gaps.
Prefer primary, current and directly relevant sources. Skip SEO filler and tutorials below the audience's level. Read the 2–3 strongest sources with web_fetch. If it reports a PDF, use web_fetch_pdf, then pdf_extract. For long PDFs, use pdf_search first and extract only hit pages. Cite PDF claims as (p. N).
If a search or fetch fails, try another angle or URL as appropriate. Report material limitations in the brief.

If web_search reports that search is unavailable because credentials are missing, do not retry it with different queries. Use web_fetch when you have source URLs, and continue with any other available sources. If the missing search capability materially limits your work, state the limitation and the missing-key setup needed in your brief. Never invent search results or sources.

Return a standalone brief:

## Summary
Answer directly in 2–3 sentences.

## Findings
Number findings and cite sources inline.

## Sources
- Kept: title, URL and why it matters.
- Dropped: title and why it was excluded.

## Gaps
State unanswered points and useful next steps.`;

export interface ResearcherRunOptions {
	engine?: PiEngine;
	/** The search seam (search port wave, 2026-09-20): resolves the LIVE
	 *  provider per call, null = honestly unavailable (the web_search tool
	 *  reports that in its output — no crash, no silent fallback). Absent
	 *  seam reads as unavailable; web_fetch remains usable without it. */
	search?: () => SearchProvider | null;
	/** The researcher's PDF dir (PDF wave, 2026-10-07): when present, the
	 *  toolset gains web_fetch_pdf + pdf_info/pdf_extract/pdf_search scoped
	 *  to this per-job temp dir — PDFs from the web, read page-level. The
	 *  runner owns its lifecycle (mkdtemp before, rm after). */
	pdfDir?: string;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onToolStart?: (toolName: string, args: unknown) => void;
	/** Debug: raw provider-event recording key (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
}

/**
 * Run the researcher to completion: isolated context, web tools only, final
 * text = the brief. The engine and search seam are injectable so tests run
 * the loop scripted.
 */
export async function runResearcherAgent(prompt: string, opts: ResearcherRunOptions = {}): Promise<string> {
	const tools = Object.values(createWebTools(opts.search ?? (() => null)));
	if (opts.pdfDir) tools.push(...Object.values(createPdfReadTools(opts.pdfDir)));
	const { text } = await runSubagent(tools, {
		role: "researcher",
		prompt,
		engine: opts.engine,
		systemPrompt: INSTRUCTIONS,
		maxTurns: 12,
		abortSignal: opts.abortSignal,
		onUsage: opts.onUsage,
		onToolStart: opts.onToolStart,
		chatId: opts.chatId,
	});
	return text;
}

export type ResearcherAgent = ReturnType<typeof runResearcherAgent>;
