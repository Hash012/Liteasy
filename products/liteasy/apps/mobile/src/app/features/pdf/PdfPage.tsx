import { useEffect, useRef, useState, type ReactNode } from "react";
import { canvasOutput, pdfjs, type PDFDocumentProxy } from "./pdfEngine";

export function PdfPage({ document, pageNumber, zoom, children, onText }: {
  document: PDFDocumentProxy; pageNumber: number; zoom: number; children?: ReactNode; onText?: (text: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [size, setSize] = useState({ width: 360, height: 480 });
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(160, entry.contentRect.width)));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = stage.current;
    if (!parent) return;
    let active = true;
    let task: ReturnType<pdfjs.PDFPageProxy["render"]> | undefined;
    let layer: InstanceType<typeof pdfjs.TextLayer> | undefined;
    let renderedPage: pdfjs.PDFPageProxy | undefined;
    // Each render owns its nodes. Cancellation of a previous zoom cannot clear the new canvas.
    const canvas = window.document.createElement("canvas");
    canvas.setAttribute("aria-label", `PDF 第 ${pageNumber} 页`);
    canvas.setAttribute("role", "img");
    const text = window.document.createElement("div"); text.className = "textLayer";
    parent.prepend(canvas, text);
    setError(""); setRendering(true);
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (!active) return;
      renderedPage = page;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.max(0.1, (width - 16) / base.width) * zoom });
      const output = canvasOutput(viewport.width, viewport.height, window.devicePixelRatio || 1);
      setSize({ width: viewport.width, height: viewport.height });
      canvas.width = output.width; canvas.height = output.height;
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      text.style.setProperty("--total-scale-factor", String(viewport.scale));
      task = page.render({ canvas, viewport, transform: [output.ratio, 0, 0, output.ratio, 0, 0], annotationMode: pdfjs.AnnotationMode.DISABLE });
      await task.promise;
      if (!active) return;
      const content = await page.getTextContent();
      if (!active) return;
      onText?.(content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""));
      layer = new pdfjs.TextLayer({ container: text, textContentSource: content, viewport });
      await layer.render();
      if (active) setRendering(false);
    })().catch((reason) => { if (active) { setError(String(reason)); setRendering(false); } });
    return () => {
      active = false; task?.cancel(); layer?.cancel(); canvas.remove(); text.remove();
      const release = () => { canvas.width = 0; canvas.height = 0; renderedPage?.cleanup(); };
      if (task) void task.promise.catch(() => {}).then(release); else release();
    };
  }, [document, pageNumber, zoom, width, onText]);
  return <div className="pdf-page-host" ref={host}>
    {error ? <p role="alert" className="error-message">此页无法显示：{error}</p> : null}
    <div className="pdf-scroll"><div ref={stage} className="pdf-page" data-page={pageNumber} style={size} aria-busy={rendering}>{children}</div></div>
    {rendering ? <p role="status">正在显示第 {pageNumber} 页…</p> : null}
  </div>;
}
