import { useEffect, useRef, useCallback, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { invoke } from "@tauri-apps/api/core";
import type { Highlight } from "./reader.store";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type ReaderPaneProps = {
  filePath: string;
  pageNumber: number;
  scale: number;
  highlights: Highlight[];
  onPageChange: (n: number) => void;
  onScaleChange: (s: number) => void;
  onTotalPages: (n: number) => void;
  onTextSelect: (text: string, pageNo: number, bbox: string | null, menuX: number, menuY: number) => void;
};

/** A flat glyph record from PDF.js textContent items */
interface Glyph {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function ReaderPane({
  filePath, pageNumber, scale, highlights,
  onPageChange, onScaleChange, onTotalPages, onTextSelect,
}: ReaderPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const pageNumRef = useRef(pageNumber);
  const glyphsRef = useRef<Glyph[]>([]);
  const highlightsRef = useRef(highlights);
  const scaleRef = useRef(scale);

  pageNumRef.current = pageNumber;
  highlightsRef.current = highlights;
  scaleRef.current = scale;

  const [pdfError, setPdfError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Adaptive fit-to-width scale
  const [fitScale, setFitScale] = useState(scale);

  // ── Extract flat glyphs from PDF.js textContent ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractGlyphs(textContent: any): Glyph[] {
    const result: Glyph[] = [];
    if (!textContent?.items) return result;
    for (const item of textContent.items) {
      if (!item.str || !item.transform) continue;
      const t = item.transform as number[];
      const fontSize = Math.sqrt(t[0] * t[0] + t[1] * t[1]);
      const x = t[4];
      const y = t[5] - fontSize;
      const w = item.width as number;
      if (item.str.trim()) {
        result.push({ str: item.str, x, y, w, h: fontSize });
      }
    }
    return result;
  }

  // ── Find word at viewport coordinate ──
  function findWordAt(x: number, y: number): { text: string; bbox: { x: number; y: number; width: number; height: number } } | null {
    const glyphs = glyphsRef.current;
    // Find glyph under cursor
    let hitIdx = -1;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) {
        hitIdx = i;
        break;
      }
    }
    if (hitIdx < 0) return null;

    // Expand to surrounding word-like glyphs on same line
    const hit = glyphs[hitIdx];
    const lineY = hit.y;
    const lineH = hit.h;
    let start = hitIdx;
    let end = hitIdx;

    // Walk left
    while (start > 0) {
      const prev = glyphs[start - 1];
      if (Math.abs(prev.y - lineY) > lineH * 0.5) break;
      if (prev.x + prev.w < glyphs[start].x - hit.w * 2) break;
      start--;
    }
    // Walk right
    while (end < glyphs.length - 1) {
      const next = glyphs[end + 1];
      if (Math.abs(next.y - lineY) > lineH * 0.5) break;
      if (next.x > glyphs[end].x + glyphs[end].w + hit.w * 2) break;
      end++;
    }

    const selectedGlyphs = glyphs.slice(start, end + 1);
    const text = selectedGlyphs.map(g => g.str).join("");
    const minX = Math.min(...selectedGlyphs.map(g => g.x));
    const minY = Math.min(...selectedGlyphs.map(g => g.y));
    const maxX = Math.max(...selectedGlyphs.map(g => g.x + g.w));
    const maxY = Math.max(...selectedGlyphs.map(g => g.y + g.h));

    return {
      text: text.trim(),
      bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    };
  }

  // ── Render page (canvas + text layer) ──
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfRef.current || !canvasRef.current) return;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    const page = await pdfRef.current.getPage(pageNum);
    const effectiveScale = scaleRef.current;
    const viewport = page.getViewport({ scale: effectiveScale });
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Text layer
    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = "";
      textLayerRef.current.style.width = `${viewport.width}px`;
      textLayerRef.current.style.height = `${viewport.height}px`;
    }

    // Render PDF page to canvas
    const renderTask = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = renderTask;
    await renderTask.promise;

    // Render text layer + extract glyphs
    const textContent = await page.getTextContent();
    glyphsRef.current = extractGlyphs(textContent);
    if (textLayerRef.current) {
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerRef.current,
        viewport,
      });
      await textLayer.render();
    }

    // Draw highlights on a second pass
    drawHighlights(ctx, dpr, pageNum);
    renderTaskRef.current = null;
  }, []); // stable — uses refs for scale/highlights

  // ── Draw highlight overlays only (no full re-render) ──
  const drawHighlights = useCallback((ctx: CanvasRenderingContext2D, dpr: number, pageNum: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hls = highlightsRef.current.filter(h => h.pageNo === pageNum);
    for (const h of hls) {
      try {
        const b = JSON.parse(h.bbox) as { x: number; y: number; width: number; height: number };
        ctx.fillStyle = h.color + "40";
        ctx.fillRect(b.x, b.y, b.width, b.height);
      } catch {}
    }
  }, []);

  // ── Redraw highlights when they change (no page re-render) ──
  useEffect(() => {
    if (!canvasRef.current || !pdfRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    // Re-render page first, then highlights
    const pageNum = pageNumRef.current;
    if (pdfRef.current) {
      pdfRef.current.getPage(pageNum).then(async page => {
        const viewport = page.getViewport({ scale: scaleRef.current });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvasContext: ctx, viewport }).promise;
        // Re-render text layer
        const textContent = await page.getTextContent();
        glyphsRef.current = extractGlyphs(textContent);
        if (textLayerRef.current) {
          textLayerRef.current.innerHTML = "";
          textLayerRef.current.style.width = `${viewport.width}px`;
          textLayerRef.current.style.height = `${viewport.height}px`;
          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textLayerRef.current,
            viewport,
          });
          await textLayer.render();
        }
        drawHighlights(ctx, dpr, pageNum);
      });
    }
  }, [highlights]);

  // ── Selection + right-click handling ──
  useEffect(() => {
    const textLayer = textLayerRef.current;
    if (!textLayer) return;

    const showMenu = (mx: number, my: number) => {
      const containerRect = textLayer.getBoundingClientRect();
      const sel = window.getSelection();
      // Prefer browser selection over glyph detection
      if (sel && sel.toString().trim() && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const bbox = JSON.stringify({
          x: rect.x - containerRect.x,
          y: rect.y - containerRect.y,
          width: rect.width,
          height: rect.height,
        });
        onTextSelect(sel.toString().trim(), pageNumRef.current, bbox, mx, my);
        return;
      }
      // Fallback: glyph detection at click position
      const x = mx - containerRect.x;
      const y = my - containerRect.y;
      const word = findWordAt(x, y);
      if (word) {
        const bbox = JSON.stringify(word.bbox);
        onTextSelect(word.text, pageNumRef.current, bbox, mx, my);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      // Small delay for browser to populate Selection
      setTimeout(() => {
        const sel = window.getSelection();
        if (sel && sel.toString().trim()) {
          showMenu(e.clientX, e.clientY);
        }
      }, 50);
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY);
    };

    textLayer.addEventListener("mouseup", onMouseUp);
    textLayer.addEventListener("contextmenu", onContextMenu);
    return () => {
      textLayer.removeEventListener("mouseup", onMouseUp);
      textLayer.removeEventListener("contextmenu", onContextMenu);
    };
  }, [onTextSelect]);

  // ── Adapt fit-to-width scale when page loads ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!pdfRef.current) return;
      // Get first page dimensions and compute fit
      pdfRef.current.getPage(1).then(page => {
        const raw = page.getViewport({ scale: 1 });
        const containerW = el.clientWidth - 24; // padding
        const fit = containerW / raw.width;
        setFitScale(Math.max(0.5, Math.min(3, fit)));
      }).catch(() => {});
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [filePath]);

  // ── Load PDF ──
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    setPdfError(null);
    setLoading(true);

    (async () => {
      try {
        const b64 = await invoke<string>("read_pdf_bytes", { path: filePath });
        if (cancelled) return;
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const pdf = await pdfjsLib.getDocument({
          data: bytes,
          cMapUrl: "/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/standard_fonts/",
        }).promise;
        if (cancelled) { pdf.destroy(); return; }
        pdfRef.current?.destroy();
        pdfRef.current = pdf;
        onTotalPages(pdf.numPages);
        setLoading(false);
        renderPage(pageNumber);
      } catch (err) {
        if (!cancelled) {
          setPdfError(`PDF 加载失败: ${err instanceof Error ? err.message : String(err)}`);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [filePath]);

  // ── Re-render on page / scale change ──
  useEffect(() => {
    if (pdfRef.current) renderPage(pageNumber);
  }, [pageNumber, scale]);

  // ── Toolbar: fit-to-width button ──
  const handleFitWidth = () => {
    onScaleChange(fitScale);
  };

  return (
    <div className="reader-pane">
      {pdfError && <div className="reader-error">{pdfError}</div>}
      {loading && !pdfError && (
        <div className="reader-placeholder" style={{ padding: 40, textAlign: "center" }}>
          正在加载 PDF...
        </div>
      )}
      {!filePath && !pdfError && (
        <div className="reader-placeholder" style={{ padding: 40, textAlign: "center" }}>
          请在左侧文献库中选择一篇论文以开始阅读
        </div>
      )}
      <div className="reader-toolbar">
        <button onClick={() => { const p = pageNumber - 1; if (p > 0) onPageChange(p); }}
          disabled={pageNumber <= 1}>◀</button>
        <span className="reader-page-indicator">第 {pageNumber} 页</span>
        <button onClick={() => onPageChange(pageNumber + 1)}>▶</button>
        <span className="reader-toolbar-sep">|</span>
        <button onClick={() => onScaleChange(Math.max(0.5, scale - 0.25))}
          disabled={scale <= 0.5}>🔍−</button>
        <span className="reader-scale-label">{Math.round(scale * 100)}%</span>
        <button onClick={() => onScaleChange(Math.min(3, scale + 0.25))}
          disabled={scale >= 3}>🔍+</button>
        <span className="reader-toolbar-sep">|</span>
        <button onClick={handleFitWidth} title="适应宽度">⊞ 适应</button>
      </div>
      <div className="reader-viewport" ref={viewportRef}>
        <div
          className="reader-page-container"
          style={{ "--scale-factor": scale } as React.CSSProperties}
        >
          <canvas ref={canvasRef} className="reader-canvas" />
          <div ref={textLayerRef} className="reader-text-layer" />
        </div>
      </div>
    </div>
  );
}
