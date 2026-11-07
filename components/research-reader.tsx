"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ResearchPassage } from "@/src/core";
const button = "rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40";
/** Render the retained original, with highlights resolved from that exact content hash. */
export function ResearchReader({ chatId, passageId, onClose, onAsk }: {
    chatId: string;
    passageId: string;
    onClose: () => void;
    onAsk: (text: string) => void;
}) {
    const [passage, setPassage] = useState<ResearchPassage | null>(null), [document, setDocument] = useState<PDFDocumentProxy | null>(null), [page, setPage] = useState(1), [zoom, setZoom] = useState(1), [width, setWidth] = useState(400), [error, setError] = useState("");
    const [rendered, setRendered] = useState("");
    const renderKey = `${passageId}:${page}:${width}:${zoom}`;
    const canvas = useRef<HTMLCanvasElement>(null), container = useRef<HTMLDivElement>(null);
    const base = `/api/chats/${encodeURIComponent(chatId)}/research-source?passage=${encodeURIComponent(passageId)}`;
    useEffect(() => {
        const controller = new AbortController();
        let dead = false;
        let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
        setPassage(null);
        setDocument(null);
        setError("");
        void (async () => {
            const response = await fetch(base, { signal: controller.signal });
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.error);
            const pdfjs = await import("pdfjs-dist");
            if (dead)
                return;
            pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
            task = pdfjs.getDocument({ url: `${base}&asset=1`, standardFontDataUrl: "/pdfjs/standard_fonts/", cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, wasmUrl: "/pdfjs/wasm/" });
            const pdf = await task.promise;
            if (dead)
                return;
            setPassage(body.passage);
            setPage(body.passage.page);
            setZoom(1);
            setDocument(pdf);
        })().catch(e => { if (!dead)
            setError(e.message ?? "Unable to open this source."); });
        return () => { dead = true; controller.abort(); void task?.destroy(); };
    }, [base]);
    useEffect(() => { const element = container.current; if (!element)
        return; const observer = new ResizeObserver(entries => setWidth(Math.max(200, entries[0]!.contentRect.width - 32))); observer.observe(element); return () => observer.disconnect(); }, []);
    useEffect(() => {
        if (!document || !canvas.current)
            return;
        let cancelled = false;
        setRendered("");
        let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
        void (async () => {
            const source = await document.getPage(page);
            if (cancelled)
                return;
            const original = source.getViewport({ scale: 1 }), scale = width / original.width * zoom, viewport = source.getViewport({ scale });
            const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
            const target = canvas.current!;
            target.width = Math.ceil(viewport.width * ratio);
            target.height = Math.ceil(viewport.height * ratio);
            target.style.width = `${viewport.width}px`;
            target.style.height = `${viewport.height}px`;
            render = source.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
            await render.promise;
            if (!cancelled) setRendered(renderKey);
        })().catch(e => { if (!cancelled)
            setError(e.message ?? "Page rendering failed."); });
        return () => { cancelled = true; render?.cancel(); };
    }, [document, page, width, zoom, renderKey]);
    const exact = passage?.location === "exact" && page === passage.page && rendered === renderKey;
    return <aside data-testid="research-reader" aria-label="Research source reader" className="fixed inset-2 z-40 flex min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xl xl:static xl:z-auto xl:w-[48%] xl:min-w-80 xl:shrink-0 xl:rounded-none xl:border-y-0 xl:border-r-0">
  <header className="flex items-center gap-2 border-b px-3 py-2"><h2 className="min-w-0 flex-1 truncate text-sm" title={passage?.source.title}> {passage?.source.title ?? "Opening source…"}</h2><button type="button" className={button} onClick={onClose}>Close</button></header>
  {passage && <><div className="flex flex-wrap items-center gap-2 border-b px-3 py-2"><button type="button" className={button} disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">←</button><label className="text-xs">Page <input aria-label="PDF page" type="number" min={1} max={document?.numPages ?? 1} className="w-14 rounded border bg-background px-1" value={page} onChange={e => { const next = Number(e.target.value); if (Number.isInteger(next) && next >= 1 && next <= (document?.numPages ?? 1))
        setPage(next); }}/> / {document?.numPages ?? passage.source.pages}</label><button type="button" className={button} disabled={page >= (document?.numPages ?? 1)} onClick={() => setPage(p => p + 1)} aria-label="Next page">→</button><button type="button" className={button} disabled={zoom <= 0.5} onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} aria-label="Zoom out">−</button><button type="button" className={button} onClick={() => { setZoom(1); setPage(passage.page); }}>Passage</button><button type="button" className={button} disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + 0.25))} aria-label="Zoom in">+</button></div><div className="border-b px-3 py-2 text-xs text-muted-foreground">{passage.reference && `${passage.reference} · `}{passage.location === "exact" ? "Matching quotation highlighted on the cited page." : "Page reference only; quotation could not be uniquely located."}<details className="mt-1"><summary className="cursor-pointer">Quotation & source</summary><p className="mt-1">{passage.quote}</p><p className="mt-1">{passage.source.authors}</p><a href={passage.source.url} className="underline" target="_blank" rel="noopener noreferrer">Original URL</a></details></div></>}
  {error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}
  <div ref={container} className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4"><div className="relative mx-auto w-fit"><canvas ref={canvas} style={{visibility:rendered === renderKey ? "visible" : "hidden"}} className="block bg-white" aria-label={passage ? `Original PDF page ${page}` : "PDF source"}/>{exact && passage.rects.map((r, index) => <div key={index} data-testid="passage-highlight" className="pointer-events-none absolute bg-yellow-300/35 ring-1 ring-yellow-500/40" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }}/>)}</div></div>
  {passage && <footer className="border-t p-2"><button type="button" className={button} onClick={() => onAsk(`Explain how the saved research passage ${passage.id} from “${passage.source.title}”, PDF page ${passage.page}${passage.reference ? `, ${passage.reference}` : ""}, relates to our question. Quotation (${passage.location} location): ${passage.quote}\nSource: ${passage.source.url}\nDistinguish source assumptions from any proposed adaptation. Keep it concise.`)}>Discuss cited passage</button></footer>}
 </aside>;
}
