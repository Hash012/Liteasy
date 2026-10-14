import { useEffect, useRef, useState } from "react";
import { Input, Spinner } from "@fluentui/react-components";
import { ChevronLeftRegular, ChevronRightRegular, ZoomInRegular, ZoomOutRegular, ArrowResetRegular } from "@fluentui/react-icons";
import { ActionButton, IconAction } from "../../shared/ui/productPrimitives";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { usePreviewScroll } from "../resource-links/usePreviewScroll";
import type { ReferencePdf, PreviewViewport } from "../resource-links/referencePdfSource";
import { createPreviewResourceCache, tracePreview } from "../resource-links/previewResource";
import "./pdfSourcePreview.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const documents = createPreviewResourceCache<pdfjs.PDFDocumentProxy>(3, 3, () => 1, 30_000, document => { void document.destroy(); });

/** Document lifetime, source navigation and raster painting are deliberately independent. */
export default function PdfSourcePreview({ source, onPageChange, initialViewport, onViewportChange }: { source: ReferencePdf; onPageChange?(page: number): void; initialViewport?: PreviewViewport; onViewportChange?(viewport: PreviewViewport): void }) {
  const stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), textLayer = useRef<HTMLDivElement>(null);
  const latest = useRef(source); latest.current = source;
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const documentKey = source.documentKey ?? source.target?.documentKey ?? source.path;
  const navigationKey = JSON.stringify([documentKey, source.page, source.target]);
  const [loaded, setLoaded] = useState<{ key: string; value: pdfjs.PDFDocumentProxy }>();
  const document = loaded?.key === documentKey ? loaded.value : undefined;
  const [navigation, setNavigation] = useState({ key: navigationKey, page: initialViewport?.page ?? source.page });
  const page = navigation.key === navigationKey ? navigation.page : source.page;
  const [width, setWidth] = useState(0), [zoom, setZoom] = useState(initialViewport?.zoom ?? 1), [pageInput, setPageInput] = useState(String(page));
  const [paintedKey, setPaintedKey] = useState(""), [error, setError] = useState<{ key: string; message: string }>(), [attempt, setAttempt] = useState(0);
  const [originRequest, setOriginRequest] = useState(0);
  const located = useRef(initialViewport ? `${navigationKey}:0` : "");
  const [regions, setRegions] = useState<{ left: number; top: number; width: number; height: number }[]>([]);
  const frameKey = JSON.stringify([documentKey, page]);
  const valid = Number.isSafeInteger(page) && page > 0 && (!document || page <= document.numPages);
  const visible = paintedKey === frameKey && valid;
  usePreviewScroll(stage, visible, initialViewport, onViewportChange);
  useEffect(() => {
    const key = `${navigationKey}:${originRequest}`, node = stage.current;
    if (!visible || !node || page !== source.page || located.current === key) return;
    if (source.target?.region?.rects.length && !regions.length) return;
    const region = node.querySelector<HTMLElement>(".source-pdf-region"), box = region?.getBoundingClientRect(), bounds = node.getBoundingClientRect();
    node.scrollLeft = box ? Math.max(0, node.scrollLeft + box.left - bounds.left + box.width / 2 - node.clientWidth / 2) : 0;
    node.scrollTop = box ? Math.max(0, node.scrollTop + box.top - bounds.top + box.height / 2 - node.clientHeight / 2) : 0;
    located.current = key;
  }, [visible, page, source.page, source.target, regions, navigationKey, originRequest]);
  const viewportCallback = useRef(onViewportChange); viewportCallback.current = onViewportChange;
  useEffect(() => { if (valid) viewportCallback.current?.({ page, zoom }); }, [page, zoom, valid]);
  const message = !valid ? `来源页码 ${page} 超出此 PDF 的范围（共 ${document?.numPages ?? "未知"} 页）。请重新选择来源或输入有效页码。` : error?.key === documentKey ? error.message : "";
  const go = (value: number) => { setNavigation({ key: navigationKey, page: value }); };
  useEffect(() => { setPageInput(String(page)); if (valid) onPageChange?.(page); }, [page, valid, onPageChange]);
  useEffect(() => {
    if (!stage.current) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = Math.max(0, Math.floor((stage.current?.clientWidth ?? 0) - 16));
        setWidth(old => { if (Math.abs(old - next) < 2) return old; tracePreview("pdf.measure", documentKey, next); return next; });
      });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(stage.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [documentKey]);
  useEffect(() => {
    const abort = new AbortController(); setError(undefined);
    const lease = documents.acquire(`${documentKey}:${attempt}`, async signal => {
      tracePreview("pdf.document.open", documentKey);
      const task = pdfjs.getDocument({ data: latest.current.bytes.slice() });
      const cancel = () => { void task.destroy(); };
      signal.addEventListener("abort", cancel, { once: true });
      try { return await task.promise; } finally { signal.removeEventListener("abort", cancel); }
    }, abort.signal);
    void lease.promise.then(value => { if (!abort.signal.aborted) setLoaded({ key: documentKey, value }); })
      .catch(() => { if (!abort.signal.aborted) setError({ key: documentKey, message: "原始 PDF 读取失败，文件可能损坏或需要密码。可重试或打开原文件。" }); });
    return () => { abort.abort(); lease.release(); };
  }, [documentKey, attempt]);
  useEffect(() => {
    let active = true, render: pdfjs.RenderTask | undefined, layer: pdfjs.TextLayer | undefined;
    const queued = serial.current.catch(() => undefined).then(async () => {
      if (!active || !document || !width || !valid || !canvas.current || !textLayer.current) return;
      let pdfPage: pdfjs.PDFPageProxy | undefined;
      try {
        pdfPage = await document.getPage(page);
        if (!active) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: Math.min(width / original.width * zoom, 4) });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        // Render offscreen; resizing never erases the last good frame while painting.
        const buffer = window.document.createElement("canvas"), text = window.document.createElement("div");
        buffer.width = Math.ceil(viewport.width * ratio); buffer.height = Math.ceil(viewport.height * ratio);
        text.style.width = `${viewport.width}px`; text.style.height = `${viewport.height}px`;
        text.style.setProperty("--total-scale-factor", String(viewport.scale));
        tracePreview("pdf.page.render", documentKey, page);
        render = pdfPage.render({ canvas: buffer, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await render.promise;
        if (!active) return;
        const content = await pdfPage.getTextContent();
        if (!active) return;
        layer = new pdfjs.TextLayer({ container: text, textContentSource: content, viewport });
        await layer.render();
        if (!active) return;
        const output = canvas.current;
        output.width = buffer.width; output.height = buffer.height;
        output.style.width = `${viewport.width}px`; output.style.height = `${viewport.height}px`;
        output.getContext("2d")!.drawImage(buffer, 0, 0);
        buffer.width = 0; buffer.height = 0;
        textLayer.current.replaceChildren(...text.childNodes);
        textLayer.current.style.cssText = text.style.cssText;
        const target = latest.current.target;
        setRegions(target?.page === page ? (target.region?.rects ?? []).map(rect => {
          // Persisted rects use the reader's rotated CropBox viewport. Convert through
          // PDF coordinates instead of assuming a zero-origin, unrotated MediaBox.
          const a = original.convertToPdfPoint(rect.x * original.width, rect.y * original.height);
          const b = original.convertToPdfPoint((rect.x + rect.width) * original.width, (rect.y + rect.height) * original.height);
          const box = viewport.convertToViewportRectangle([...a, ...b]);
          return { left: Math.min(box[0], box[2]), top: Math.min(box[1], box[3]), width: Math.abs(box[2] - box[0]), height: Math.abs(box[3] - box[1]) };
        }) : []);
        setError(undefined); setPaintedKey(frameKey); tracePreview("pdf.page.publish", documentKey, page);
      } catch (reason) {
        if (active && (reason as Error)?.name !== "RenderingCancelledException") setError({ key: documentKey, message: "此页预览失败，请重试或打开原文件。" });
      } finally { pdfPage?.cleanup(); }
    });
    serial.current = queued;
    return () => { active = false; render?.cancel(); layer?.cancel(); };
  }, [document, documentKey, frameKey, navigationKey, page, width, zoom, valid, attempt]);
  return <section className="source-pdf-preview" aria-label="原始 PDF 预览" aria-busy={!visible && !message}>
    <div className="source-pdf-toolbar">
      <IconAction label="上一页" density="compact" appearance="subtle" icon={<ChevronLeftRegular />} disabled={!document || !valid || page <= 1} onClick={() => go(page - 1)} />
      <span aria-live="polite">第 {page} / {document?.numPages ?? "…"} 页</span>
      <IconAction label="下一页" density="compact" appearance="subtle" icon={<ChevronRightRegular />} disabled={!document || !valid || page >= document.numPages} onClick={() => go(page + 1)} />
      <Input aria-label="跳到物理页" size="small" type="number" min={1} max={document?.numPages} value={pageInput} onChange={(_, data) => setPageInput(data.value)} onKeyDown={event => { if (event.key === "Enter") go(Number(pageInput)); }} />
      <IconAction label="缩小 PDF" icon={<ZoomOutRegular />} density="compact" appearance="subtle" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))} />
      <ActionButton size="small" appearance="subtle" onClick={() => setZoom(1)}>{zoom === 1 ? "适应宽度" : `${Math.round(zoom * 100)}%`}</ActionButton>
      <IconAction label="放大 PDF" icon={<ZoomInRegular />} density="compact" appearance="subtle" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))} />
      <IconAction label="回到来源" icon={<ArrowResetRegular />} density="compact" appearance="subtle" onClick={() => { go(source.page); setOriginRequest(value => value + 1); }} />
    </div>
    <div className="source-pdf-status">{message ? <div role="alert">{message}<ActionButton size="small" onClick={() => setAttempt(value => value + 1)}>重试 PDF 预览</ActionButton></div> : !visible ? <Spinner size="tiny" label="正在读取原始 PDF…" /> : null}</div>
    <div className="source-pdf-stage" ref={stage}>
      <div className="source-pdf-page" data-surface="authored-paper" style={{ visibility: visible ? "visible" : "hidden" }}>
        <canvas ref={canvas} aria-label={`原始 PDF 第 ${page} 页`} />
        <div ref={textLayer} className="pdf-text-layer" aria-label={`第 ${page} 页文字`} />
        {regions.map((rect, index) => <span key={index} className="source-pdf-region" style={rect} aria-label="来源区域" />)}
      </div>
    </div>
  </section>;
}
