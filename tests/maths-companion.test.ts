import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createResearchSourceStore } from "../src/store/research-sources.ts";
import { sameInvestigation } from "../src/core/maths-companion.ts";
import { pdfLocatePassage } from "../src/agent/subagents/pdf-ops.ts";
import { companionEvidenceTools, runMathsCompanion } from "../src/agent/subagents/maths-companion.ts";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-companion-test-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const quote = "The marginal laws do not determine the joint law.";
/** Real PDF bytes with xref offsets; no external files or network. */
function pdf(texts: string[]) {
    const objects: string[] = [];
    const pages = texts.map((_, i) => 3 + i * 2), font = 3 + texts.length * 2;
    objects[1] = "<</Type/Catalog/Pages 2 0 R>>";
    objects[2] = `<</Type/Pages/Kids[${pages.map(id => `${id} 0 R`).join(" ")}]/Count ${pages.length}>>`;
    texts.forEach((text, i) => {
        const id = pages[i]!, stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/([()\\])/g, "\\$1")}) Tj ET`;
        objects[id] = `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${id + 1} 0 R/Resources<</Font<</F1 ${font} 0 R>>>>>>`;
        objects[id + 1] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
    });
    objects[font] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";
    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) {
        offsets[i] = body.length;
        body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = body.length;
    body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++)
        body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    return new TextEncoder().encode(body + `trailer\n<</Size ${objects.length}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
}
const bytes = pdf(["Introduction", quote]);
const file = path.join(root, "fixture.pdf");
fs.writeFileSync(file, bytes);
function fixture(name: string) { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); return { dir, store: createResearchSourceStore(path.join(dir, "saved")) }; }
const finding = (passageId: string) => ({ title: "Marginals and dependence", claim: quote, relationship: "Joint dependence must also be specified.", assumptions: "Marginal laws alone; no joint model was fixed.", assessment: "technique", nextStep: "Compare admissible couplings.", passageId });
const submit = (passageId: string) => ({ summary: "Inspect dependence before drawing a uniqueness conclusion.", findings: [finding(passageId)], limitations: "This quotation alone does not prove the payoff claim." });
describe("PDF passage locations", () => {
    it("verifies a unique quotation on the requested PDF page", async () => { const result = await pdfLocatePassage(file, 2, quote); assert.equal(result.location, "exact"); assert.equal(result.pages, 2); assert.equal(result.rects.length, 1); assert.equal(result.reference, ""); for (const r of result.rects) {
        assert(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1 && r.y + r.height <= 1);
    } });
    it("uses page-only for absent, repeated or too short text", async () => {
        for (const text of ["invented mathematical theorem", "The"])
            assert.equal((await pdfLocatePassage(file, 2, text)).location, "page-only");
        const duplicate = path.join(root, "duplicate.pdf");
        fs.writeFileSync(duplicate, pdf([`${quote} ${quote}`]));
        assert.equal((await pdfLocatePassage(duplicate, 1, quote)).location, "page-only");
        await assert.rejects(pdfLocatePassage(file, 3, quote), /valid PDF page/);
    });
});
describe("durable research sources", () => {
    it("retains immutable originals, deduplicates bytes, reopens after restart and isolates sessions", () => {
        const { dir, store } = fixture("durable");
        const source = store.retain("chat", { bytes, title: "Couplings", authors: "", url: "https://example.test/paper.pdf", pages: 2 });
        assert.equal(store.retain("chat", { bytes, title: "Other title", authors: "", url: "https://example.test/other", pages: 2 }).id, source.id);
        const passage = store.putPassage("chat", { source, page: 2, quote, reference: "Proposition 1", location: "page-only", rects: [] });
        const restarted = createResearchSourceStore(path.join(dir, "saved"));
        assert.deepEqual(restarted.passage("chat", passage.id), passage);
        assert.deepEqual(restarted.asset("chat", source.id).bytes, Buffer.from(bytes));
        assert.throws(() => restarted.passage("other", passage.id));
        assert.throws(() => store.asset("chat", "../fixture.pdf"));
        assert.throws(() => store.retain("../escape", { bytes, title: "x", authors: "", url: "https://example.test/p", pages: 2 }));
        fs.writeFileSync(path.join(dir, "saved", "chat", `${source.id}.pdf`), "changed");
        assert.throws(() => restarted.passage("chat", passage.id), /changed/);
    });
    it("refuses credential URLs, symlink folders and altered highlight metadata", () => {
        const { dir, store } = fixture("guards");
        assert.throws(() => store.retain("chat", { bytes, title: "x", authors: "", url: "https://secret@example.test/p", pages: 2 }));
        const source = store.retain("chat", { bytes, title: "x", authors: "", url: "https://example.test/p", pages: 2 });
        const passage = store.putPassage("chat", { source, page: 1, quote, reference: "", location: "page-only", rects: [] });
        const metadata = path.join(dir, "saved", "chat", `${passage.id}.json`);
        fs.writeFileSync(metadata, JSON.stringify({ ...passage, quote: "tampered" }));
        assert.throws(() => store.passage("chat", passage.id), /changed/);
        fs.symlinkSync(path.join(dir, "saved", "chat"), path.join(dir, "saved", "alias"));
        assert.throws(() => store.asset("alias", source.id), /directory/);
    });
});
describe("evidence submission", () => {
    it("cannot cite arbitrary paths or fabricate citation IDs; persists before report", async () => {
        const { dir, store } = fixture("evidence"), tools = companionEvidenceTools({ chatId: "chat", pdfDir: dir, sources: store });
        const arbitrary = await tools.tools.cite_passage!.execute!("bad", { path: file, page: 2, quote, reference: "", title: "x" });
        assert.match(JSON.stringify(arbitrary), /Use a PDF path/);
        const fabricated = await tools.tools.submit_findings!.execute!("fake", submit("invented"));
        assert.match(JSON.stringify(fabricated), /Unknown passage/);
        assert.equal(tools.result(), undefined);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(bytes.slice().buffer, { headers: { "content-type": "application/pdf" } });
        try {
            const fetched = await tools.tools.web_fetch_pdf!.execute!("download", { url: "https://example.test/paper.pdf" });
            const local = (fetched as {
                details: {
                    path: string;
                };
            }).details.path;
            const result = await tools.tools.cite_passage!.execute!("cite", { path: local, page: 2, quote, reference: "Proposition 1", title: "Couplings" });
            const id = (result as {
                details: {
                    passageId: string;
                };
            }).details.passageId;
            assert.equal(store.passage("chat", id).location, "exact");
            assert.equal(store.passage("chat", id).reference, "", "unverified theorem references are omitted");
            await tools.tools.submit_findings!.execute!("submit", submit(id));
            assert.equal(tools.result()?.passages[0]?.id, id);
        }
        finally {
            globalThis.fetch = originalFetch;
        }
    });
    it("keeps ambiguous readings unresolved and refuses writes after cancellation", async () => {
        const { dir, store } = fixture("cancel"), controller = new AbortController(), tools = companionEvidenceTools({ chatId: "chat", pdfDir: dir, sources: store, abortSignal: controller.signal });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(bytes.slice().buffer, { headers: { "content-type": "application/pdf" } });
        try {
            const fetched = await tools.tools.web_fetch_pdf!.execute!("download", { url: "https://example.test/paper.pdf" });
            const local = (fetched as {
                details: {
                    path: string;
                };
            }).details.path;
            const result = await tools.tools.cite_passage!.execute!("cite", { path: local, page: 2, quote: "This quotation does not exist.", reference: "", title: "Couplings" });
            const id = (result as {
                details: {
                    passageId: string;
                };
            }).details.passageId;
            assert.match(JSON.stringify(await tools.tools.submit_findings!.execute!("bad", submit(id))), /unverified quotations/i);
            controller.abort();
            await tools.tools.submit_findings!.execute!("cancel", { ...submit(id), findings: [] });
            assert.equal(tools.result(), undefined);
            assert.match(JSON.stringify(await tools.tools.cite_passage!.execute!("late", { path: local, page: 2, quote, reference: "", title: "x" })), /cancelled/);
        }
        finally {
            globalThis.fetch = originalFetch;
        }
    });
});
it("compares exact investigation question/context, never mathematical equivalence", () => {
    assert(sameInvestigation({ mode: "mathematical", question: " same  question " }, { mode: "mathematical", question: "same question" }));
    assert(!sameInvestigation({ mode: "mathematical", question: "q", context: "old" }, { mode: "mathematical", question: "q", context: "new" }));
    assert(!sameInvestigation({ question: "q" }, { question: "q" }));
});
it("runs the model loop with structure-led instructions and honest no-results submission", async () => {
    const { dir, store } = fixture("loop"), body = { summary: "No source verified.", findings: [], limitations: "Search unavailable; this does not establish novelty." };
    const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
    faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_findings", body)], { stopReason: "toolUse" })]);
    const engine: PiEngine = { model: faux.getModel(), streamFn: faux.streamSimple };
    const result = await runMathsCompanion("Does a marginal determine the joint law?", { chatId: "chat", pdfDir: dir, sources: store, engine });
    assert.equal(result.findings.length, 0);
    assert.match(result.limitations, /novelty/);
});
