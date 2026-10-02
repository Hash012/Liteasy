import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PdfAnnotationV2 } from "./pdfAnnotationStorage";
import { schedulePdfThumbnail } from "./pdfThumbnailQueue";

import { getOverlayStyle } from "./pdfAnnotationAppearance";
export function PdfThumbnail({ active, annotations, onNavigate, pageNumber, pdfDocument, width = 150, maxHeight = width * 1.45 }: {
  active: boolean; annotations: PdfAnnotationV2[]; onNavigate(page: number): void;
  pageNumber: number; pdfDocument: PDFDocumentProxy | null; width?: number; maxHeight?: number;
}) {
  const element = useRef<HTMLLIElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [aspectRatio, setAspectRatio] = useState(1 / 1.45);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "300px" });
    observer.observe(element.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdfDocument || !visible) return;
    setFailed(false);
    let page: PDFPageProxy | undefined;
    const cancel = schedulePdfThumbnail(pdfDocument, async (signal) => {
      try {
        page = await pdfDocument.getPage(pageNumber);
        if (signal.aborted) return;
        const base = page.getViewport({ scale: 1 });
        setAspectRatio(base.width / base.height);
        const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const scale = Math.min(width * density / base.width, Math.sqrt(1_000_000 / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        const task = page.render({ canvas, canvasContext: context, viewport });
        const abort = () => task.cancel();
        signal.addEventListener("abort", abort, { once: true });
        try { await task.promise; } finally { signal.removeEventListener("abort", abort); }
      } catch { if (!signal.aborted) setFailed(true); }
      finally {
        // getPage can resolve after the effect has already been disposed. The
        // document retains the proxy, so releasing only the canvas is insufficient.
        if (signal.aborted) page?.cleanup();
      }
    });
    return () => {
      cancel();
      // PDF.js defers cleanup while another render still uses this shared page.
      page?.cleanup();
      canvas.width = 1; canvas.height = 1;
    };
  }, [pdfDocument, pageNumber, visible, width, attempt]);
  return <li ref={element} className={active ? "active" : ""}>
    <button aria-current={active ? "page" : undefined} aria-label={`转到第 ${pageNumber} 页`} title={`转到第 ${pageNumber} 页`}
      onClick={() => onNavigate(pageNumber)} type="button">
      <span className="pdf-thumbnail-page" style={{ width: `min(100%, ${Math.min(width, maxHeight * aspectRatio)}px)`, aspectRatio }}>
        <canvas aria-label={`PDF.js 缩略图 ${pageNumber}`} className="pdf-thumbnail-canvas" style={{ aspectRatio, height: "auto" }} ref={canvasRef} />
        {annotations.filter((annotation) => annotation.page === pageNumber && (annotation.kind === "highlight" || annotation.kind === "underline"))
          .flatMap((annotation) => annotation.rects.map((rect, index) => <span key={`${annotation.id}-${index}`} aria-hidden="true"
            className={`pdf-thumbnail-mark ${annotation.kind}`} style={getOverlayStyle(annotation.kind, rect, annotation.color)} />))}
      </span><span className="pdf-thumbnail-number">{pageNumber}</span>
    </button>
    {failed ? <button type="button" className="pdf-thumbnail-retry" onClick={() => setAttempt((value) => value + 1)}>重试第 {pageNumber} 页预览</button> : null}
  </li>;
}
