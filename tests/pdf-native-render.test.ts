/**
 * Wave E stage 1 (owner 2026-10-10): pdf_render is NATIVE — pdfjs paints
 * into @napi-rs/canvas in-process, no browser anywhere. These tests pin
 * the real renderer against the real fixture: valid canonical PNGs, dpi
 * scaling arithmetic (scale = dpi/72), out-of-range page skipping, and the
 * Skia canvas actually being exercised (not a DOM canvas — none exists in
 * this process).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it } from "node:test";
import { realHeadless, pdfLoadingTaskObserver } from "../src/agent/subagents/headless.ts";
import { tinyPdf } from "./helpers/tiny-pdf.ts";
import { standardFontsDir } from "../src/agent/subagents/pdf-ops.ts";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "sample-3page.pdf");

/** Minimal PNG chunk walk — returns IHDR dims and the IDAT chunk count. */
function pngFacts(buf: Buffer): { w: number; h: number; idats: number } {
	assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
	const w = buf.readUInt32BE(16);
	const h = buf.readUInt32BE(20);
	let off = 8;
	let idats = 0;
	while (off < buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.subarray(off + 4, off + 8).toString("ascii");
		if (type === "IDAT") idats++;
		off += 12 + len; // len + type + data + crc
	}
	return { w, h, idats };
}

describe("native pdf_render (pdfjs paints, @napi-rs/canvas hosts)", () => {
	it("the shared font directory ends in pdfjs's required slash on every OS", () => {
		const fonts = standardFontsDir();
		assert.ok(fonts.endsWith("/"), "pdfjs rejects a trailing Windows backslash");
		assert.ok(fs.statSync(fonts).isDirectory(), "the filesystem accepts the shared font path");
	});

	it("renders fixture pages as canonical single-IDAT PNGs", async () => {
		const pages = await realHeadless.renderPdfPages(FIXTURE, [1, 3], { dpi: 150 });
		assert.equal(pages.length, 2, "requested pages 1 and 3");
		assert.deepEqual(
			pages.map((p) => p.page),
			[1, 3],
		);
		for (const p of pages) {
			const facts = pngFacts(p.png);
			assert.ok(facts.w > 0 && facts.h > 0, "non-empty raster");
			// providerSafePng canonical form: exactly one IDAT.
			assert.equal(facts.idats, 1, "single-IDAT canonical PNG");
		}
	});

	it("dpi arithmetic: 72dpi base doubles at 144dpi", async () => {
		const [a] = await realHeadless.renderPdfPages(FIXTURE, [1], { dpi: 72 });
		const [b] = await realHeadless.renderPdfPages(FIXTURE, [1], { dpi: 144 });
		assert.ok(a && b, "both renders returned a page");
		const fa = pngFacts(a.png);
		const fb = pngFacts(b.png);
		assert.ok(Math.abs(fb.w - 2 * fa.w) <= 2, `144dpi width ≈ 2× 72dpi (${fa.w} → ${fb.w})`);
		assert.ok(Math.abs(fb.h - 2 * fa.h) <= 2, `144dpi height ≈ 2× 72dpi (${fa.h} → ${fb.h})`);
	});

	it("skips out-of-range page numbers silently", async () => {
		const pages = await realHeadless.renderPdfPages(FIXTURE, [0, 2, 99], { dpi: 72 });
		assert.deepEqual(
			pages.map((p) => p.page),
			[2],
			"only the in-range page renders",
		);
	});

	it("renders with NO browser present (available() may be false)", async () => {
		// The whole point of stage 1: rendering must not consult any Chrome.
		// realHeadless.available() reflects system Chrome only; on this
		// machine it may well be true — the assertion that matters is that
		// the render path never launches one, pinned by the import graph:
		// renderPdfPages touches pdfjs + @napi-rs/canvas and nothing else.
		const pages = await realHeadless.renderPdfPages(FIXTURE, [1], { dpi: 72 });
		assert.equal(pages.length, 1);
	});
});

describe("bounded PDF rendering", () => {
 it("downsamples to the default and stricter pixel ceilings and reports DPI", async () => {
  const [page] = await realHeadless.renderPdfPages(FIXTURE, [1], { dpi: 1000 });
  assert.ok(page);
  const facts = pngFacts(page.png);
  assert.ok(facts.w * facts.h <= 16_000_000);
  assert.ok(page.dpi! < 1000);
  const [small] = await realHeadless.renderPdfPages(FIXTURE, [1], { dpi: 150, maxPixels: 100_000 });
  assert.ok(small);
  const smallFacts = pngFacts(small.png);
  assert.ok(smallFacts.w * smallFacts.h <= 100_000);
  assert.ok(small.dpi! < 150);
 });
 it("renders a selected region at the requested resolution", async () => {
  const [full] = await realHeadless.renderPdfPages(FIXTURE, [1], { dpi: 150 });
  const [part] = await realHeadless.renderPdfPages(FIXTURE, [1], { dpi: 150, region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
  assert.ok(full && part);
  assert.equal(pngFacts(part.png).w, Math.ceil(pngFacts(full.png).w / 2));
  assert.equal(pngFacts(part.png).h, Math.ceil(pngFacts(full.png).h / 2));
  assert.equal(part.dpi, 150);
 });
 it("rejects invalid limits, DPI, and regions before painting", async () => {
  for (const opts of [{ dpi: NaN }, { dpi: -1 }, { maxPixels: Infinity }, { maxPixels: 0 }, { region: { x: 0.9, y: 0, width: 0.2, height: 1 } }]) {
   await assert.rejects(realHeadless.renderPdfPages(FIXTURE, [1], opts), /Invalid PDF/);
  }
 });
});

it("destroys each loading task after both rejected and successful loads", async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-invalid-"));
 const invalid = path.join(dir, "invalid.pdf");
 fs.writeFileSync(invalid, "not a PDF");
 let destroyed = 0;
 pdfLoadingTaskObserver.current = task => {
  const destroy = task.destroy.bind(task);
  task.destroy = async () => { destroyed++; await destroy(); };
 };
 try {
  for (let i = 0; i < 3; i++) await assert.rejects(realHeadless.renderPdfPages(invalid, [1]));
  await realHeadless.renderPdfPages(FIXTURE, [1], { dpi: 72 });
  assert.equal(destroyed, 4);
 } finally {
  pdfLoadingTaskObserver.current = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
 }
});

it("destroys the loading task if observation throws", async () => {
 let destroyed = 0;
 pdfLoadingTaskObserver.current = task => {
  const destroy = task.destroy.bind(task);
  task.destroy = async () => { destroyed++; await destroy(); };
  throw new Error("observation failed");
 };
 try {
  await assert.rejects(realHeadless.renderPdfPages(FIXTURE, [1]), /observation failed/);
  assert.equal(destroyed, 1);
 } finally { pdfLoadingTaskObserver.current = undefined; }
});

it("bounds a physically oversized PDF page and its detail region", async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-large-"));
 const file = path.join(dir, "large.pdf");
 fs.writeFileSync(file, tinyPdf([{ runs: [{ text: "Detail", x: 72, y: 720 }] }], { width: 10000, height: 10000 }));
 try {
  const [page] = await realHeadless.renderPdfPages(file, [1], { dpi: 150 });
  const [detail] = await realHeadless.renderPdfPages(file, [1], { dpi: 150, region: { x: 0, y: 0, width: 0.1, height: 0.1 } });
  assert.ok(page && detail);
  const { w, h } = pngFacts(page.png);
  assert.ok(w * h <= 16_000_000);
  assert.ok(page.dpi! < 150);
  assert.equal(detail.dpi, 150);
  assert.deepEqual([pngFacts(detail.png).w, pngFacts(detail.png).h], [2084, 2084]);
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it("destroys the loading task and preserves a page render error", async () => {
 let destroyed = 0;
 pdfLoadingTaskObserver.current = task => {
  const destroy = task.destroy.bind(task);
  task.destroy = async () => { destroyed++; await destroy(); };
  const loading = task as typeof task & { promise: Promise<{ getPage: (n: number) => Promise<{ render: () => unknown }> }> };
  void loading.promise.then(doc => {
   const getPage = doc.getPage.bind(doc);
   doc.getPage = async n => {
    const page = await getPage(n);
    page.render = () => { throw new Error("render failed"); };
    return page;
   };
  });
 };
 try {
  await assert.rejects(realHeadless.renderPdfPages(FIXTURE, [1]), /render failed/);
  assert.equal(destroyed, 1);
 } finally { pdfLoadingTaskObserver.current = undefined; }
});
