import { OptionPicker } from "../../shared/ui/productPrimitives";
import { useEffect, useRef, useState } from "react";
import { Button, Field, Spinner } from "@fluentui/react-components";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ArtifactExportPayload } from "../artifacts/artifactExport.types";
import { exportPreviewGeometry, type ExportPreviewMode } from "./exportPreviewGeometry";
import "./documentExport.css";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type ReadyDocument = { payload: ArtifactExportPayload; document: pdfjs.PDFDocumentProxy };
export function ExportPdfPreview({ payload }: { payload: ArtifactExportPayload }) {
  const canvas = useRef<HTMLCanvasElement>(null), textLayer = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const [ready, setReady] = useState<ReadyDocument>();
  const [page, setPage] = useState(1), [error, setError] = useState("");
  const [mode, setMode] = useState<ExportPreviewMode>("fit-page"), [zoom, setZoom] = useState(100);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: window.devicePixelRatio || 1 });
  const [painted, setPainted] = useState<{ document: ReadyDocument; page: number; geometry: string }>();
  const [limited, setLimited] = useState(false);
  const current = ready?.payload === payload ? ready : undefined;
  const geometryIdentity = JSON.stringify([size, mode, zoom]);
  const visible = painted?.document === current && painted?.page === page && painted?.geometry === geometryIdentity;
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => { const box = element.getBoundingClientRect(); setSize(previous => {
      const next = { width: Math.max(0, box.width - 24), height: Math.max(0, box.height - 24), dpr: window.devicePixelRatio || 1 };
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    }); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    let media: MediaQueryList;
    const onDpr = () => { media?.removeEventListener("change", onDpr); measure(); media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); media.addEventListener("change", onDpr); };
    onDpr(); window.addEventListener("resize", measure);
    return () => { observer.disconnect(); media.removeEventListener("change", onDpr); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => {
    let active = true;
    setReady(undefined); setPage(1); setError(""); setPainted(undefined);
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    try {
      task = pdfjs.getDocument({ data: Uint8Array.from(atob(payload.content), char => char.charCodeAt(0)) });
      void task.promise.then(document => { if (active) setReady({ payload, document }); }).catch(() => { if (active) setError("PDF 预览读取失败，请重新生成。"); });
    } catch { setError("PDF 预览读取失败，请重新生成。"); }
    return () => {
      active = false;
      // Rendering cleanup runs in this commit; destroy only after its serial lane settles.
      void Promise.resolve().then(() => serial.current).catch(() => undefined).then(() => task?.destroy()).catch(() => undefined);
    };
  }, [payload]);
  useEffect(() => {
    let active = true, renderTask: pdfjs.RenderTask | undefined, layer: pdfjs.TextLayer | undefined;
    let ownedPage: pdfjs.PDFPageProxy | undefined;
    setPainted(undefined); if (current) setError("");
    const queued = serial.current.catch(() => undefined).then(async () => {
      if (!active || !current || !canvas.current || !textLayer.current) return;
      const outputCanvas = canvas.current, outputText = textLayer.current;
      try {
        ownedPage = await current.document.getPage(page);
        if (!active) return;
        const base = ownedPage.getViewport({ scale: 1 });
        const geometry = exportPreviewGeometry({ width: base.width, height: base.height, availableWidth: size.width, availableHeight: size.height, dpr: size.dpr, mode, zoom });
        if (!geometry) return;
        const viewport = ownedPage.getViewport({ scale: geometry.scale });
        outputCanvas.width = geometry.backingWidth; outputCanvas.height = geometry.backingHeight;
        outputCanvas.style.width = `${geometry.width}px`; outputCanvas.style.height = `${geometry.height}px`;
        outputText.replaceChildren(); outputText.style.width = `${geometry.width}px`; outputText.style.height = `${geometry.height}px`;
        outputText.style.setProperty("--total-scale-factor", String(viewport.scale));
        renderTask = ownedPage.render({ canvas: outputCanvas, viewport, transform: [geometry.ratio, 0, 0, geometry.ratio, 0, 0] });
        await renderTask.promise;
        if (!active) return;
        const text = await ownedPage.getTextContent();
        if (!active) return;
        layer = new pdfjs.TextLayer({ container: outputText, textContentSource: text, viewport });
        await layer.render();
        if (!active) return;
        setLimited(geometry.limited); setPainted({ document: current, page, geometry: geometryIdentity });
      } catch (error) {
        if (active && (error as Error)?.name !== "RenderingCancelledException") setError("PDF 页面预览失败，请切换页面或重新生成。");
      } finally { ownedPage?.cleanup(); }
    });
    serial.current = queued;
    return () => { active = false; renderTask?.cancel(); layer?.cancel(); };
  }, [current, page, size, mode, zoom, geometryIdentity]);
  return <section className="export-pdf-preview" aria-label="实际 PDF 预览" aria-busy={!visible && !error}>
    <div className="export-preview-toolbar"><Button disabled={!current || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page} / {current?.document.numPages ?? 0} 页</span><Button disabled={!current || page >= current.document.numPages} onClick={() => setPage(value => value + 1)}>下一页</Button>
      <Field label="预览缩放"><OptionPicker aria-label="预览缩放" value={mode === "custom" ? String(zoom) : mode} onValueChange={(value) => { if (/^\d+$/.test(value)) { setMode("custom"); setZoom(Number(value)); } else setMode(value as ExportPreviewMode); }} options={[{ value: "fit-page", label: "适合整页" }, { value: "fit-width", label: "适合页宽" }, { value: "actual-size", label: "100%（纸张原尺寸，96 CSS px/in）" }, ...[50, 75, 125, 150, 200, 300].map(value => ({ value: String(value), label: `${value}%（相对纸张）` }))]} /></Field>
    </div>
    <div className="export-preview-status">{error ? <p role="alert">{error}</p> : !visible ? <Spinner label={size.width > 0 && size.height > 0 ? "正在读取 PDF 页面…" : "等待预览区域显示…"} /> : null}
    {visible && limited ? <p role="status">为控制内存，当前预览分辨率已降低；保存的 PDF 字节不受影响。</p> : null}</div>
    <div className="export-preview-stage" ref={stage}><div className="export-preview-paper" data-surface="authored-paper" style={{ visibility: visible ? "visible" : "hidden" }}><canvas ref={canvas} aria-label="本次实际生成的 PDF 页面" /><div ref={textLayer} className="pdf-text-layer export-pdf-text-layer" aria-label={`第 ${page} 页文字`} /></div></div>
  </section>;
}
