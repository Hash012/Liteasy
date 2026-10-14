import { useEffect, useRef, useState } from "react";
import { Spinner } from "@fluentui/react-components";
import { ChevronLeftRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { ActionButton, IconAction } from "../../shared/ui/productPrimitives";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ReferencePdf } from "../resource-links/referencePdfSource";
import "./pdfSourcePreview.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** One original page at a time; scanning/OCR and Markdown are not prerequisites. */
export default function PdfSourcePreview({ source, onPageChange }: { source: ReferencePdf; onPageChange?(page: number): void }) {
  const stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), textLayer = useRef<HTMLDivElement>(null);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy>();
  const [page, setPage] = useState(source.page), [width, setWidth] = useState(0);
  const [painted, setPainted] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => { onPageChange?.(page); }, [page, onPageChange]);
  useEffect(() => {
    if (!stage.current) return;
    const measure = () => setWidth(Math.max(0, (stage.current?.clientWidth ?? 0) - 16));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    setDocument(undefined); setError(""); setPainted(false);
    // PDF.js transfers its input buffer; keep the caller's original bytes intact.
    const task = pdfjs.getDocument({ data: source.bytes.slice() });
    void task.promise.then(value => {
      if (active) { setDocument(value); setPage(Math.min(source.page, value.numPages)); }
    }).catch(() => { if (active) setError("原始 PDF 读取失败，文件可能损坏或需要密码。可重试或打开原文件。"); });
    return () => {
      active = false;
      void Promise.resolve().then(() => serial.current).catch(() => undefined).then(() => task.destroy()).catch(() => undefined);
    };
  }, [source, attempt]);
  useEffect(() => {
    let active = true, render: pdfjs.RenderTask | undefined, layer: pdfjs.TextLayer | undefined;
    setPainted(false);
    const queued = serial.current.catch(() => undefined).then(async () => {
      if (!active || !document || !width || !canvas.current || !textLayer.current) return;
      let pdfPage: pdfjs.PDFPageProxy | undefined;
      try {
        pdfPage = await document.getPage(page);
        if (!active) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: Math.min(width / original.width, 1600 / original.height) });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const output = canvas.current, text = textLayer.current;
        output.width = Math.ceil(viewport.width * ratio); output.height = Math.ceil(viewport.height * ratio);
        output.style.width = `${viewport.width}px`; output.style.height = `${viewport.height}px`;
        text.replaceChildren(); text.style.width = `${viewport.width}px`; text.style.height = `${viewport.height}px`;
        text.style.setProperty("--total-scale-factor", String(viewport.scale));
        render = pdfPage.render({ canvas: output, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await render.promise;
        if (!active) return;
        const content = await pdfPage.getTextContent();
        if (!active) return;
        layer = new pdfjs.TextLayer({ container: text, textContentSource: content, viewport });
        await layer.render();
        if (active) { setError(""); setPainted(true); }
      } catch (reason) {
        if (active && (reason as Error)?.name !== "RenderingCancelledException") setError("此页预览失败，请重试或打开原文件。");
      } finally { pdfPage?.cleanup(); }
    });
    serial.current = queued;
    return () => { active = false; render?.cancel(); layer?.cancel(); };
  }, [document, page, width]);
  return <section className="source-pdf-preview" aria-label="原始 PDF 预览" aria-busy={!painted && !error}>
    <div className="source-pdf-toolbar">
      <IconAction label="上一页" density="compact" appearance="subtle" icon={<ChevronLeftRegular />} disabled={!document || page <= 1} onClick={() => setPage(value => value - 1)} />
      <span aria-live="polite">第 {page} / {document?.numPages ?? "…"} 页</span>
      <IconAction label="下一页" density="compact" appearance="subtle" icon={<ChevronRightRegular />} disabled={!document || page >= document.numPages} onClick={() => setPage(value => value + 1)} />
    </div>
    {error ? <div role="alert">{error}<ActionButton size="small" onClick={() => setAttempt(value => value + 1)}>重试 PDF 预览</ActionButton></div> : !painted ? <Spinner size="tiny" label="正在读取原始 PDF…" /> : null}
    <div className="source-pdf-stage" ref={stage}>
      <div className="source-pdf-page" data-surface="authored-paper" style={{ visibility: painted ? "visible" : "hidden" }}>
        <canvas ref={canvas} aria-label={`原始 PDF 第 ${page} 页`} />
        <div ref={textLayer} className="pdf-text-layer" aria-label={`第 ${page} 页文字`} />
      </div>
    </div>
  </section>;
}
