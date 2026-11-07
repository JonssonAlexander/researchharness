"use client";
import { useContext } from "react";
import type { MathematicalInvestigation } from "@/src/core";
import { ChatActionsContext } from "./chat";
import { MessageResponse } from "./ai-elements/message";
export function ResearchFindings({ report }: {
    report: MathematicalInvestigation;
}) {
    const actions = useContext(ChatActionsContext);
    return <section data-testid="mathematical-findings" className="space-y-3 text-sm">
  <div><span className="font-ui text-xs text-muted-foreground">Mathematical investigation</span><MessageResponse>{report.summary}</MessageResponse></div>
  {report.findings.map((finding, index) => {
            const passage = report.passages.find(p => p.id === finding.passageId);
            return <article key={`${finding.passageId}:${index}`} className="rounded-lg border bg-card px-3 py-2">
    <div className="flex flex-wrap items-baseline justify-between gap-1"><h3 className="font-medium">{finding.title}</h3><span className="font-ui text-[11px] text-muted-foreground">{finding.assessment.replaceAll("-", " ")}</span></div>
    <MessageResponse>{finding.relationship}</MessageResponse>
    {passage && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><button type="button" disabled={!actions?.openPassage} className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50" onClick={() => actions?.openPassage?.(passage.id)}>Read passage · p. {passage.page}</button><span className="text-muted-foreground">{passage.source.title}</span></div>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">Evidence & assumptions</summary><div className="mt-2 space-y-2"><p className="font-medium">Source reading</p><MessageResponse>{finding.claim}</MessageResponse><p className="font-medium">Assumptions</p><MessageResponse>{finding.assumptions}</MessageResponse>{passage && <><p>{passage.reference} · {passage.location === "exact" ? "Quotation located; applicability is a model assessment." : "Page only; quotation not verified."}</p><blockquote className="border-l-2 pl-2">{passage.quote}</blockquote><a href={passage.source.url} target="_blank" rel="noopener noreferrer" className="underline">Original source</a></>}<p className="font-medium">Next step</p><MessageResponse>{finding.nextStep}</MessageResponse></div></details>
   </article>;
        })}
  <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Search limits</summary><MessageResponse>{report.limitations}</MessageResponse></details>
 </section>;
}
