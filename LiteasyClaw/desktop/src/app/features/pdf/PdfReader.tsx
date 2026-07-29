import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import {
  CommentRegular,
  DocumentRegular,
  PanelLeftContractRegular,
  PanelLeftExpandRegular
} from "@fluentui/react-icons";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { compactPdfTextForSearch, normalizePdfTextForSearch } from "./pdfTextSearch";
import { ensureReadableStreamAsyncIterator } from "./pdfStreamCompatibility";
import type { Paper } from "../workspace/workspace.types";
import type { ReaderConversationContext } from "../assistant/assistantContext.types";
import {
  loadPdfAnnotationAutoPublic,
  loadPdfAnnotations,
  pdfAnnotationAutoPublicStorageKey,
  pdfAnnotationStorageKey,
  savePdfAnnotationAutoPublic,
  savePdfAnnotations,
  type PdfAnnotation,
  type PdfAnnotationKind,
  type PdfAnnotationRect,
  type PdfHighlightColor
} from "./pdfAnnotationStorage";
import {
  listPdfAnnotationPendingPublicItems,
  PDF_ANNOTATION_PENDING_LABEL,
  syncPdfAnnotationPendingItems
} from "./pdfAnnotationIntuechoSync";
import { resolvePaperIdentity } from "../paper-identity/paperIdentity";

ensureReadableStreamAsyncIterator();
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type AnnotationKind = PdfAnnotationKind;
type HighlightColor = PdfHighlightColor;

type PdfSelection = {
  excerpt: string;
  menuLeft: number;
  menuTop: number;
  page: number;
  rects: PdfAnnotationRect[];
};

type TextLayerPosition = {
  node: Text;
  offset: number;
  normalizedOffset: number;
};

type PdfSidebarMode = "thumbnails" | "annotations";

type PdfReaderProps = {
  loadPdfSource?: (sourcePath: string) => Promise<Uint8Array>;
  selectedPapers: Paper[];
  targetEvidence?: PdfEvidenceTarget | null;
  zoom: number;
  onAddSelectionToConversation?: (context: ReaderConversationContext) => void;
  intuechoEndpoint?: string;
};


export type PdfEvidenceTarget = {
  evidenceId: string;
  page: number;
  pageTextEnd?: number;
  pageTextStart?: number;
  textExtraction?: "embedded" | "ocr";
  paperId: string;
  quote: string;
  requestId: number;
};

const fallbackExcerpt = "Liteasy 将在这里显示清晰 PDF 页面，并把文本选区绑定到批注与 AI 问答。";

function resolvePdfDisplaySource(sourcePath: string | undefined) {
  if (!sourcePath) {
    return undefined;
  }

  const trimmed = sourcePath.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("fixtures/") && lower.split("?")[0].endsWith(".pdf")) {
    return `/${trimmed}`;
  }

  if (lower.startsWith("./fixtures/") && lower.split("?")[0].endsWith(".pdf")) {
    return trimmed.slice(1);
  }

  if (lower.startsWith("blob:") || lower.startsWith("data:application/pdf")) {
    return trimmed;
  }

  if (lower.startsWith("/") && lower.split("?")[0].endsWith(".pdf")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const canDisplay =
      ["http:", "https:", "file:"].includes(url.protocol) &&
      url.pathname.toLowerCase().endsWith(".pdf");
    return canDisplay ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export function shouldLoadPdfFromLocalBytes(sourcePath: string | undefined) {
  if (!sourcePath) return false;
  const trimmed = sourcePath.trim();
  const lower = trimmed.toLowerCase().replace(/\\/g, "/");
  if (
    lower.startsWith("blob:") ||
    lower.startsWith("data:") ||
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("fixtures/") ||
    lower.startsWith("./fixtures/") ||
    lower.startsWith("/papers/") ||
    lower.startsWith("/fixtures/")
  ) {
    return false;
  }
  return lower.startsWith("/") || /^[a-z]:\//.test(lower);
}

function getAnnotationLabel(kind: AnnotationKind) {
  if (kind === "highlight") {
    return "高亮";
  }

  if (kind === "underline") {
    return "划线";
  }

  return "注释";
}

function getHighlightColor(color: HighlightColor): string {
  switch (color) {
    case "yellow":
      return "#ffeaa7";
    case "red":
      return "#fab1a0";
    case "blue":
      return "#74b9ff";
    case "green":
      return "#55efc4";
    case "pink":
      return "#fd79a8";
    default:
      return "#ffeaa7";
  }
}

function getHighlightBorderColor(color: HighlightColor): string {
  switch (color) {
    case "yellow":
      return "#ffe69c";
    case "red":
      return "#f5c6cb";
    case "blue":
      return "#bee5eb";
    case "green":
      return "#c3e6cb";
    case "pink":
      return "#f5b7e9";
    default:
      return "#ffe69c";
  }
}

function getOverlayLabel(kind: AnnotationKind) {
  if (kind === "highlight") {
    return "高亮标注";
  }

  if (kind === "underline") {
    return "划线标注";
  }

  return "旁注";
}

function getAnnotationText(kind: AnnotationKind) {
  return getAnnotationLabel(kind);
}

function clampPercent(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, value));
}

function getElementFromRange(range: Range) {
  const node = range.commonAncestorContainer;
  if (!node) {
    return null;
  }

  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function getSelectionPageElement(range: Range, stageElement: HTMLElement) {
  const ancestorElement = getElementFromRange(range);
  if (!ancestorElement || !stageElement.contains(ancestorElement)) {
    return null;
  }

  if (!ancestorElement.closest(".pdf-text-layer")) {
    return null;
  }

  return ancestorElement.closest<HTMLElement>(".pdf-page-shell");
}

function getRangeClientRects(range: Range) {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 1 && rect.height > 1
  );

  if (rects.length > 0) {
    return rects;
  }

  const fallbackRect = range.getBoundingClientRect();
  return fallbackRect.width > 1 && fallbackRect.height > 1 ? [fallbackRect] : [];
}

function getLineHeightPercent(rect: DOMRect, pageHeight: number) {
  return Math.max(1.1, Math.min(2.8, (rect.height / pageHeight) * 100));
}

function getVerticalCenter(rect: DOMRect) {
  return rect.top + rect.height / 2;
}

function mergeLineRects(rects: DOMRect[]) {
  if (rects.length <= 1) {
    return rects;
  }

  const sortedHeights = rects.map((rect) => rect.height).sort((left, right) => left - right);
  const referenceHeight =
    sortedHeights[Math.floor((sortedHeights.length - 1) * 0.25)] ?? sortedHeights[0] ?? 1;
  const lineSizedRects = rects.filter(
    (rect) => rect.height <= Math.max(referenceHeight * 1.8, referenceHeight + 4)
  );
  const sourceRects = lineSizedRects.length > 0 ? lineSizedRects : rects;
  const sortedRects = [...sourceRects].sort(
    (left, right) => left.top - right.top || left.left - right.left
  );
  const lines: DOMRect[][] = [];

  for (const rect of sortedRects) {
    const line = lines.find((candidate) => {
      const lineCenter =
        candidate.reduce((sum, item) => sum + getVerticalCenter(item), 0) / candidate.length;
      const tolerance = Math.max(3, Math.min(rect.height, candidate[0]?.height ?? rect.height) * 0.55);
      return Math.abs(getVerticalCenter(rect) - lineCenter) <= tolerance;
    });

    if (line) {
      line.push(rect);
    } else {
      lines.push([rect]);
    }
  }

  return lines.map((line) => {
    const left = Math.min(...line.map((rect) => rect.left));
    const right = Math.max(...line.map((rect) => rect.right));
    const top = Math.min(...line.map((rect) => rect.top));
    const bottom = Math.max(...line.map((rect) => rect.bottom));
    return {
      bottom,
      height: bottom - top,
      left,
      right,
      toJSON: () => ({}),
      top,
      width: right - left,
      x: left,
      y: top
    } as DOMRect;
  });
}

function buildAnnotationRects(range: Range, pageRect: DOMRect | undefined) {
  const pageWidth = pageRect?.width && pageRect.width > 0 ? pageRect.width : 760;
  const pageHeight = pageRect?.height && pageRect.height > 0 ? pageRect.height : 980;
  const pageLeft = pageRect?.left ?? 0;
  const pageTop = pageRect?.top ?? 0;

  const visibleRects = getRangeClientRects(range)
    .filter((rect) => {
      const pageBottom = pageTop + pageHeight;
      const pageRight = pageLeft + pageWidth;
      return rect.bottom >= pageTop && rect.top <= pageBottom && rect.right >= pageLeft && rect.left <= pageRight;
    })
    .map((rect) => {
      const left = Math.max(pageLeft, rect.left);
      const right = Math.min(pageLeft + pageWidth, rect.right);
      const top = Math.max(pageTop, rect.top);
      const bottom = Math.min(pageTop + pageHeight, rect.bottom);
      return {
        bottom,
        height: bottom - top,
        left,
        right,
        toJSON: () => ({}),
        top,
        width: right - left,
        x: left,
        y: top
      } as DOMRect;
    });

  return mergeLineRects(visibleRects)
    .map((rect) => ({
      height: getLineHeightPercent(rect, pageHeight),
      left: clampPercent(((rect.left - pageLeft) / pageWidth) * 100, 16),
      top: clampPercent(((rect.top - pageTop) / pageHeight) * 100, 22),
      width: Math.max(4, clampPercent((rect.width / pageWidth) * 100, 48))
    }));
}

function buildSelectionFromRange(stageElement: HTMLElement, selection: Selection): PdfSelection | null {
  const excerpt = selection.toString().trim().replace(/\s+/g, " ");
  if (!excerpt || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rangeRect = range.getBoundingClientRect();
  const pageElement = getSelectionPageElement(range, stageElement);
  if (!pageElement) {
    return null;
  }

  const pageRect = pageElement?.getBoundingClientRect();
  const pageNumber = Number(pageElement?.dataset.page ?? "1");
  const rects = buildAnnotationRects(range, pageRect);
  if (rects.length === 0) {
    return null;
  }

  const stageRect = stageElement.getBoundingClientRect();

  return {
    excerpt,
    menuLeft: Math.max(12, rangeRect.left - stageRect.left + stageElement.scrollLeft),
    menuTop: Math.max(12, rangeRect.top - stageRect.top + stageElement.scrollTop - 44),
    page: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1,
    rects
  };
}

function collectTextLayerNodes(textLayer: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE && current.textContent) {
      nodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  return nodes;
}

function normalizeQuoteForSearch(value: string) {
  return normalizePdfTextForSearch(value);
}

function buildNormalizedTextLayerIndex(nodes: Text[]) {
  let text = "";
  const positions: TextLayerPosition[] = [];
  let previousWasWhitespace = true;

  for (const node of nodes) {
    const value = node.nodeValue ?? "";
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset];
      if (/\s/.test(character)) {
        if (!previousWasWhitespace && text.length > 0) {
          text += " ";
          positions.push({ node, normalizedOffset: text.length - 1, offset });
          previousWasWhitespace = true;
        }
        continue;
      }

      const normalizedCharacter = character
        .normalize("NFKC")
        .replace(/[‐‑‒–—]/g, "-")
        .replace(/\u00ad/g, "")
        .toLowerCase();
      if (!normalizedCharacter) {
        continue;
      }
      for (const item of normalizedCharacter) {
        text += item;
        positions.push({ node, normalizedOffset: text.length - 1, offset });
      }
      previousWasWhitespace = false;
    }
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    positions.pop();
  }

  return { positions, text };
}

function buildCompactTextLayerIndex(index: ReturnType<typeof buildNormalizedTextLayerIndex>) {
  const positions: TextLayerPosition[] = [];
  let text = "";
  for (let offset = 0; offset < index.text.length; offset += 1) {
    const character = index.text[offset];
    if (/\s/.test(character) || character === "-") {
      continue;
    }
    text += character;
    const position = index.positions[offset];
    if (position) {
      positions.push(position);
    }
  }
  return { positions, text };
}

function compactQuoteForSearch(value: string) {
  return compactPdfTextForSearch(value);
}

function findQuoteRangeInIndex(input: {
  index: ReturnType<typeof buildNormalizedTextLayerIndex>;
  preferredStart?: number;
  query: string;
}) {
  let start = input.index.text.indexOf(input.query);
  if (start < 0) {
    return null;
  }
  if (typeof input.preferredStart === "number" && Number.isFinite(input.preferredStart)) {
    let closestStart = start;
    let closestDistance = Math.abs(
      (input.index.positions[start]?.normalizedOffset ?? start) - input.preferredStart
    );
    let nextStart = input.index.text.indexOf(input.query, start + 1);
    while (nextStart >= 0) {
      const distance = Math.abs(
        (input.index.positions[nextStart]?.normalizedOffset ?? nextStart) - input.preferredStart
      );
      if (distance < closestDistance) {
        closestStart = nextStart;
        closestDistance = distance;
      }
      nextStart = input.index.text.indexOf(input.query, nextStart + 1);
    }
    start = closestStart;
  }
  const end = start + input.query.length - 1;
  const startPosition = input.index.positions[start];
  const endPosition = input.index.positions[end];
  if (!startPosition || !endPosition) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset + 1);
  return range;
}

export function findQuoteRangeInTextLayer(
  textLayer: HTMLElement,
  quote: string,
  preferredStart?: number
): Range | null {
  const query = normalizeQuoteForSearch(quote);
  if (!query) {
    return null;
  }

  const index = buildNormalizedTextLayerIndex(collectTextLayerNodes(textLayer));
  const exactRange = findQuoteRangeInIndex({ index, preferredStart, query });
  if (exactRange) {
    return exactRange;
  }

  const compactQuery = compactQuoteForSearch(quote);
  if (!compactQuery) {
    return null;
  }
  return findQuoteRangeInIndex({
    index: buildCompactTextLayerIndex(index),
    preferredStart,
    query: compactQuery
  });
}

export function buildTargetEvidenceRects(
  textLayer: HTMLElement,
  pageElement: HTMLElement,
  quote: string,
  preferredStart?: number
) {
  const range = findQuoteRangeInTextLayer(textLayer, quote, preferredStart);
  if (!range) {
    return [];
  }
  return buildAnnotationRects(range, pageElement.getBoundingClientRect()).slice(0, 8);
}

function getInitialSelection(activePaper: Paper | null): PdfSelection {
  return {
    excerpt: activePaper
      ? `当前选中文段来自《${activePaper.title}》第 1 页，后续会接入真实 PDF 文本选区。`
      : fallbackExcerpt,
    menuLeft: 120,
    menuTop: 120,
    page: 1,
    rects: [{ height: 2.4, left: 16, top: 22, width: 58 }]
  };
}

function getPageNumbers(pageCount: number) {
  return Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1);
}

function getScaleForStage(baseViewport: PageViewport, stageWidth: number, zoom: number) {
  const availableWidth = Math.max(420, stageWidth - 72);
  return Math.max(0.6, Math.min(2.8, (availableWidth / baseViewport.width) * (zoom / 100)));
}

function isJsdomRuntime() {
  return typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom");
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  if (isJsdomRuntime()) {
    return null;
  }

  return canvas.getContext("2d");
}

function drawCanvasFallback(canvas: HTMLCanvasElement | null, title: string, pageNumber: number, compact = false) {
  if (!canvas) {
    return;
  }

  const width = compact ? 108 : 760;
  const height = compact ? 146 : 980;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  const context = getCanvasContext(canvas);
  if (!context) {
    return;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#d9e5ef";
  context.fillRect(compact ? 14 : 72, compact ? 22 : 110, compact ? 80 : 500, compact ? 6 : 16);
  context.fillRect(compact ? 14 : 72, compact ? 38 : 150, compact ? 58 : 430, compact ? 5 : 12);
  context.fillStyle = "#1b66b3";
  context.font = compact ? "700 18px sans-serif" : "700 28px sans-serif";
  context.fillText(String(pageNumber), compact ? 12 : 72, compact ? 128 : 900);
  context.fillStyle = "#5d6978";
  context.font = compact ? "700 8px sans-serif" : "700 18px sans-serif";
  context.fillText(title.slice(0, compact ? 18 : 52), compact ? 14 : 72, compact ? 18 : 78);
}

function getOverlayStyle(kind: AnnotationKind, rect: PdfAnnotationRect, color?: HighlightColor): CSSProperties {
  if (kind === "note") {
    return {
      backgroundColor: "rgba(36, 80, 142, 0.95)",
      borderRadius: "999px",
      height: "2%",
      left: `${Math.max(0, rect.left - 1.2)}%`,
      top: `${rect.top + Math.min(rect.height, 1)}%`,
      width: "2%"
    };
  }

  if (kind === "underline") {
    return {
      border: "none",
      boxShadow: "none",
      background: "none",
      height: `${rect.height}%`,
      left: `${rect.left}%`,
      top: `${rect.top + rect.height - 0.3}%`,
      width: `${rect.width}%`,
      borderBottom: "2px solid rgba(27, 102, 179, 0.8)"
    };
  }

  const highlightColor = color ? getHighlightColor(color) : getHighlightColor("yellow");

  return {
    backgroundColor: highlightColor,
    height: `${rect.height}%`,
    left: `${rect.left - 0.1}%`,
    top: `${rect.top - 0.05}%`,
    width: `${rect.width + 0.2}%`
  };
}

type PdfPageViewProps = {
  annotations: PdfAnnotation[];
  activePaper: Paper | null;
  focused: boolean;
  onEvidenceHighlightResolved?: (matched: boolean) => void;
  pageNumber: number;
  pdfDocument: PDFDocumentProxy | null;
  stageWidth: number;
  targetEvidence?: PdfEvidenceTarget | null;
  zoom: number;
};

function PdfPageView({
  activePaper,
  annotations,
  focused,
  onEvidenceHighlightResolved,
  pageNumber,
  pdfDocument,
  stageWidth,
  targetEvidence,
  zoom
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageShellRef = useRef<HTMLElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pageTitle = activePaper?.title ?? "选择文献后开始阅读";
  const [pageSize, setPageSize] = useState({ height: 980, width: 760 });
  const [targetHighlightRects, setTargetHighlightRects] = useState<PdfAnnotationRect[]>([]);

  function updateTargetHighlightRects() {
    const textLayer = textLayerRef.current;
    const pageElement = pageShellRef.current;
    if (
      focused &&
      targetEvidence?.textExtraction === "ocr" &&
      targetEvidence.paperId === activePaper?.id
    ) {
      setTargetHighlightRects([]);
      onEvidenceHighlightResolved?.(false);
      return;
    }
    if (
      !focused ||
      !targetEvidence?.quote ||
      targetEvidence.paperId !== activePaper?.id ||
      !textLayer ||
      !pageElement
    ) {
      setTargetHighlightRects([]);
      return;
    }
    const rects = buildTargetEvidenceRects(
      textLayer,
      pageElement,
      targetEvidence.quote,
      targetEvidence.pageTextStart
    );
    setTargetHighlightRects(rects);
    onEvidenceHighlightResolved?.(rects.length > 0);
  }

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    async function renderPage() {
      if (!pdfDocument) {
        drawCanvasFallback(canvasRef.current, pageTitle, pageNumber);
        setTargetHighlightRects([]);
        if (focused && targetEvidence?.paperId === activePaper?.id) {
          onEvidenceHighlightResolved?.(false);
        }
        return;
      }

      const canvas = canvasRef.current;
      const textLayer = textLayerRef.current;
      if (!canvas || !textLayer) {
        return;
      }

      try {
        const page: PDFPageProxy = await pdfDocument.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: getScaleForStage(baseViewport, stageWidth, zoom)
        });
        const outputScale = window.devicePixelRatio || 1;
        const context = getCanvasContext(canvas);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;
        textLayer.style.setProperty("--total-scale-factor", String(viewport.scale));
        setPageSize({ height: viewport.height, width: viewport.width });

        if (context) {
          context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
          renderTask = page.render({ canvas, canvasContext: context, viewport });
          await renderTask.promise;
        }

        if (cancelled) {
          return;
        }

        textLayer.innerHTML = "";
        const textContent = await page.getTextContent();
        const layer = new pdfjsLib.TextLayer({
          container: textLayer,
          textContentSource: textContent,
          viewport
        });
        await layer.render();
        if (!cancelled) {
          updateTargetHighlightRects();
        }
      } catch {
        drawCanvasFallback(canvasRef.current, pageTitle, pageNumber);
        setTargetHighlightRects([]);
        if (focused && targetEvidence?.paperId === activePaper?.id) {
          onEvidenceHighlightResolved?.(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [activePaper?.id, focused, onEvidenceHighlightResolved, pageNumber, pageTitle, pdfDocument, stageWidth, targetEvidence?.pageTextStart, targetEvidence?.quote, targetEvidence?.requestId, zoom]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateTargetHighlightRects);
    return () => window.cancelAnimationFrame(frame);
  }, [activePaper?.id, focused, pageNumber, pageSize.height, pageSize.width, targetEvidence?.pageTextStart, targetEvidence?.quote, targetEvidence?.requestId]);

  const pageAnnotations = annotations.filter((annotation) => annotation.page === pageNumber);

  return (
    <article
      aria-label={`PDF.js 页面 ${pageNumber}`}
      className={`pdf-page-shell ${focused ? "evidence-target" : ""}`}
      data-page={pageNumber}
      ref={pageShellRef}
      style={{ minHeight: pageSize.height, width: pageSize.width }}
    >
      <canvas aria-label={`PDF.js 页面画布 ${pageNumber}`} className="pdf-page-canvas" ref={canvasRef} />
      <div aria-hidden="true" className="pdf-page-shadow" />
      <div className="textLayer pdf-text-layer" ref={textLayerRef}>
        <span className="pdf-text-layer-fallback">{fallbackExcerpt}</span>
      </div>
      <div aria-label={pageNumber === 1 ? "PDF 批注覆盖层" : undefined} className="pdf-annotation-overlay">
        {pageAnnotations.map((annotation) =>
          annotation.rects.map((rect, index) => (
            <div
              aria-label={`${getOverlayLabel(annotation.kind)}：第 ${annotation.page} 页：${annotation.excerpt}`}
              className={`pdf-overlay-mark ${annotation.kind}`}
              key={`${annotation.id}-${index}`}
              style={getOverlayStyle(
                annotation.kind,
                rect,
                annotation.kind === "highlight" ? annotation.color : undefined
              )}
              title={`第 ${annotation.page} 页：${annotation.excerpt}`}
            />
          ))
        )}
        {targetHighlightRects.map((rect, index) => (
          <div
            aria-label={`Agent 引用证据高亮：第 ${pageNumber} 页：${targetEvidence?.quote ?? ""}`}
            className="pdf-overlay-mark highlight agent-evidence"
            key={`target-evidence-${targetEvidence?.requestId ?? pageNumber}-${index}`}
            style={getOverlayStyle("highlight", rect, "blue")}
            title={`Agent 引用证据：${targetEvidence?.quote ?? ""}`}
          />
        ))}
      </div>
    </article>
  );
}

type PdfThumbnailProps = {
  active: boolean;
  activePaper: Paper | null;
  pageNumber: number;
  pdfDocument: PDFDocumentProxy | null;
};

function PdfThumbnail({ active, activePaper, pageNumber, pdfDocument }: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const title = activePaper?.title ?? "PDF";

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    async function renderThumbnail() {
      if (!pdfDocument) {
        drawCanvasFallback(canvasRef.current, title, pageNumber, true);
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        const viewport = page.getViewport({ scale: 0.18 });
        const context = getCanvasContext(canvas);
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        if (context) {
          renderTask = page.render({ canvas, canvasContext: context, viewport });
          await renderTask.promise;
        }
      } catch {
        drawCanvasFallback(canvasRef.current, title, pageNumber, true);
      }
    }

    void renderThumbnail();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdfDocument, title]);

  return (
    <li className={active ? "active" : ""}>
      <canvas aria-label={`PDF.js 缩略图 ${pageNumber}`} className="pdf-thumbnail-canvas" ref={canvasRef} />
      <span className="pdf-thumbnail-number">{pageNumber}</span>
    </li>
  );
}

export function PdfReader({
  loadPdfSource,
  selectedPapers,
  targetEvidence,
  zoom,
  onAddSelectionToConversation,
  intuechoEndpoint = ""
}: PdfReaderProps) {
  const activePaper = selectedPapers[0] ?? null;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [selectedColor, setSelectedColor] = useState<HighlightColor>("yellow");
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [focusedPage, setFocusedPage] = useState(1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<PdfSidebarMode>("annotations");
  const [stageWidth, setStageWidth] = useState(960);
  const [status, setStatus] = useState("选择文段后可添加高亮、划线，或把选中文段交给 AI。");
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [annotationNoteDraft, setAnnotationNoteDraft] = useState("");
  const [syncingAnnotations, setSyncingAnnotations] = useState(false);
  const pdfDisplaySource = resolvePdfDisplaySource(activePaper?.sourcePath);
  const annotationStorageKey = pdfAnnotationStorageKey(activePaper);
  const autoPublicStorageKey = pdfAnnotationAutoPublicStorageKey(activePaper);
  const [autoPublicAnnotations, setAutoPublicAnnotations] = useState(false);
  const [hydratedAnnotationStorageKey, setHydratedAnnotationStorageKey] = useState<string | null>(null);
  const pageNumbers = useMemo(() => getPageNumbers(pageCount), [pageCount]);
  const pendingPublicAnnotations = useMemo(
    () => listPdfAnnotationPendingPublicItems(annotations),
    [annotations]
  );

  const handleEvidenceHighlightResolved = useCallback((matched: boolean) => {
    if (!targetEvidence || targetEvidence.paperId !== activePaper?.id) {
      return;
    }
    setStatus(targetEvidence.textExtraction === "ocr"
      ? `已定位到第 ${targetEvidence.page} 页；该证据来自 OCR 识别，当前只能页级定位。`
      : matched
        ? `已定位并高亮第 ${targetEvidence.page} 页的 Agent 引用证据。`
        : `已定位到第 ${targetEvidence.page} 页；原文文本层未能精确匹配，当前为页级定位。`);
  }, [activePaper?.id, targetEvidence]);

  useEffect(() => {
    const stageElement = stageRef.current;
    if (!stageElement) {
      return undefined;
    }
    const measuredStageElement = stageElement;

    function updateLayout() {
      setStageWidth(measuredStageElement.clientWidth);
    }

    updateLayout();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateLayout);
      return () => window.removeEventListener("resize", updateLayout);
    }

    const observer = new ResizeObserver(updateLayout);
    observer.observe(measuredStageElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setAnnotations(loadPdfAnnotations(
      annotationStorageKey,
      activePaper ? resolvePaperIdentity(activePaper) : undefined
    ));
    setAutoPublicAnnotations(loadPdfAnnotationAutoPublic(autoPublicStorageKey));
    setHydratedAnnotationStorageKey(annotationStorageKey);
    setSelection(null);
    setActiveAnnotationId(null);
    setPageCount(1);
    setFocusedPage(1);

    const localSourcePath = loadPdfSource && shouldLoadPdfFromLocalBytes(activePaper?.sourcePath)
      ? activePaper!.sourcePath
      : undefined;
    if (!pdfDisplaySource && !localSourcePath) {
      setPdfDocument(null);
      setStatus(
        activePaper?.sourcePath
          ? "浏览器不能直接打开此 PDF 路径。"
          : "选择文献后开始阅读，可在 PDF 文本层上选中文段。"
      );
      return undefined;
    }

    if (isJsdomRuntime()) {
      setPdfDocument(null);
      setStatus("PDF.js 测试画布已准备，可在浏览器中渲染真实 PDF。");
      return undefined;
    }

    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setStatus("正在用 PDF.js 加载文档。");

    const sourcePromise = localSourcePath
      ? loadPdfSource!(localSourcePath).then((data) => ({ data }))
      : Promise.resolve({ url: pdfDisplaySource! });
    sourcePromise
      .then((source) => {
        if (cancelled) return null;
        loadingTask = pdfjsLib.getDocument(source);
        return loadingTask.promise;
      })
      .then((document) => {
        if (!document) return;
        if (cancelled) {
          void document.destroy();
          return;
        }

        setPdfDocument(document);
        setPageCount(document.numPages);
        setStatus(`已加载 ${document.numPages} 页 PDF，可直接选中文本批注。`);
      })
      .catch((error) => {
        if (!cancelled) {
          setPdfDocument(null);
          const reason = error instanceof Error ? error.message : String(error);
          setStatus(`PDF.js 无法解析该文件：${reason}`);
        }
      });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [activePaper?.sourcePath, annotationStorageKey, autoPublicStorageKey, loadPdfSource, pdfDisplaySource]);

  useEffect(() => {
    if (annotationStorageKey && hydratedAnnotationStorageKey === annotationStorageKey) {
      savePdfAnnotations(annotationStorageKey, annotations);
    }
  }, [annotationStorageKey, annotations, hydratedAnnotationStorageKey]);

  useEffect(() => {
    if (!targetEvidence || targetEvidence.paperId !== activePaper?.id) {
      return undefined;
    }

    const targetPage = Math.min(
      Math.max(1, Math.trunc(targetEvidence.page || 1)),
      Math.max(1, pageCount)
    );
    setFocusedPage(targetPage);
    setSidebarMode("thumbnails");
    setSidebarCollapsed(false);
    setStatus(`已定位到第 ${targetPage} 页的 Agent 引用证据。`);

    const frame = window.requestAnimationFrame(() => {
      const pageElement = stageRef.current?.querySelector<HTMLElement>(
        `[data-page="${targetPage}"]`
      );
      if (pageElement && typeof pageElement.scrollIntoView === "function") {
        pageElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePaper?.id, pageCount, targetEvidence]);

  function clearBrowserSelection() {
    window.getSelection()?.removeAllRanges();
  }

  function handleTextSelection(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".pdf-selection-menu")) {
      return;
    }

    const stageElement = stageRef.current;
    const browserSelection = window.getSelection();
    if (!stageElement || !browserSelection) {
      return;
    }

    const nextSelection = buildSelectionFromRange(stageElement, browserSelection);
    setSelection(nextSelection);
  }

  function handleSelectionContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".pdf-selection-menu")) {
      return;
    }

    const stageElement = stageRef.current;
    const browserSelection = window.getSelection();
    if (!stageElement || !browserSelection) {
      return;
    }

    const nextSelection = buildSelectionFromRange(stageElement, browserSelection);
    if (!nextSelection && !selection) {
      return;
    }

    event.preventDefault();
    const stageRect = stageElement.getBoundingClientRect();
    if (nextSelection) {
      setSelection({
        ...nextSelection,
        menuLeft: Math.max(12, event.clientX - stageRect.left + stageElement.scrollLeft),
        menuTop: Math.max(12, event.clientY - stageRect.top + stageElement.scrollTop)
      });
    } else {
      setSelection(selection);
    }
  }

  function addAnnotation(kind: AnnotationKind) {
    const activeSelection = selection ?? getInitialSelection(activePaper);
    const now = new Date().toISOString();
    const annotation: PdfAnnotation = {
      color: kind === "highlight" ? selectedColor : undefined,
      createdAt: now,
      excerpt: activeSelection.excerpt,
      id: `${kind}-${Date.now()}-${annotations.length}`,
      kind,
      page: activeSelection.page,
      paperIdentity: resolvePaperIdentity(activePaper ?? {
        id: "local-pdf-selection",
        title: "未命名 PDF"
      }),
      rects: activeSelection.rects,
      text: getAnnotationText(kind),
      updatedAt: now,
      visibility: autoPublicAnnotations ? "pending_public" : "private"
    };
    const duplicate = annotations.some(
      (item) =>
        item.kind === annotation.kind &&
        item.page === annotation.page &&
        item.excerpt === annotation.excerpt
    );
    if (!duplicate) {
      setAnnotations((current) => [...current, annotation]);
    }
    setStatus(
      duplicate
        ? `该文段已经有${getAnnotationLabel(kind)}批注。`
        : `已创建${getAnnotationLabel(kind)}批注。`
    );
    setSidebarMode("annotations");
    setSidebarCollapsed(false);
    setSelection(null);
    clearBrowserSelection();
  }

  function addSelectionToConversation() {
    if (!selection) return;

    const context: ReaderConversationContext = {
      excerpt: selection.excerpt,
      page: selection.page,
      paperId: selectedPapers[0]?.id,
      paperTitle: selectedPapers[0]?.title,
      source: "pdf_selection"
    };

    onAddSelectionToConversation?.(context);
    setSelection(null);
    clearBrowserSelection();
    setStatus("已将选中文段添加到对话。");
  }


  function openAnnotationEditor(annotation: PdfAnnotation) {
    setActiveAnnotationId(annotation.id);
    setAnnotationNoteDraft(annotation.note || "");
    // 如果是高亮，打开颜色选择器
    if (annotation.kind === "highlight" && annotation.color) {
      setSelectedColor(annotation.color);
    }
  }

  function saveAnnotationNote() {
    if (!activeAnnotationId) return;

    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === activeAnnotationId
          ? {
              ...annotation,
              note: annotationNoteDraft,
              syncState: annotation.visibility === "pending_public" ? undefined : annotation.syncState,
              updatedAt: new Date().toISOString()
            }
          : annotation
      )
    );
    setStatus("已保存批注。");
    setActiveAnnotationId(null);
  }

  function updateHighlightColor(annotationId: string, color: HighlightColor) {
    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === annotationId
          ? {
              ...annotation,
              color,
              syncState: annotation.visibility === "pending_public" ? undefined : annotation.syncState,
              updatedAt: new Date().toISOString()
            }
          : annotation
      )
    );
    setStatus("已更新高亮颜色。");
    setActiveAnnotationId(null);
  }

  function setAnnotationPublic(annotationId: string, isPublic: boolean) {
    setAnnotations((current) => current.map((annotation) => annotation.id === annotationId
      ? {
          ...annotation,
          syncState: undefined,
          updatedAt: new Date().toISOString(),
          visibility: isPublic ? "pending_public" : "private"
        }
      : annotation));
  }

  function setAutoPublic(value: boolean) {
    setAutoPublicAnnotations(value);
    savePdfAnnotationAutoPublic(autoPublicStorageKey, value);
  }

  async function syncPublicAnnotations() {
    if (syncingAnnotations || pendingPublicAnnotations.length === 0) return;
    setSyncingAnnotations(true);
    try {
      const results = await syncPdfAnnotationPendingItems({ endpoint: intuechoEndpoint, items: pendingPublicAnnotations });
      const attemptedAt = new Date().toISOString();
      setAnnotations((current) => current.map((annotation) => {
        const result = results.find((item) => item.annotationId === annotation.id);
        if (!result) return annotation;
        return result.status === "synced"
          ? { ...annotation, syncState: { intuechoAnnotationId: result.intuechoAnnotationId, status: "synced", syncedAt: result.syncedAt } }
          : { ...annotation, syncState: { error: result.error, lastAttemptAt: attemptedAt, status: "failed" } };
      }));
      setStatus(results.some((result) => result.status === "synced") ? "已收到 Intuecho 同步确认。" : "公开批注仍在本地等待 Intuecho 同步。");
    } finally {
      setSyncingAnnotations(false);
    }
  }


  return (
    <section
      aria-label="PDF 阅读器"
      className="pdf-reader fluid"
      data-pdf-source={pdfDisplaySource ?? ""}
    >
      <div
        aria-label="PDF 阅读工作区"
        className={`pdf-workspace ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-open"}`}
      >
        <aside
          aria-label="PDF 左侧批注栏"
          className="pdf-left-sidebar"
        >
          {sidebarCollapsed ? (
            <button
              aria-label="展开 PDF 左侧栏"
              className="pdf-sidebar-collapse-button"
              onClick={() => setSidebarCollapsed(false)}
              title="展开 PDF 左侧栏"
              type="button"
            >
              <PanelLeftExpandRegular />
            </button>
          ) : (
            <>
              <div className="pdf-sidebar-switcher">
                <button
                  aria-label="缩略图"
                  className={sidebarMode === "thumbnails" ? "active" : ""}
                  onClick={() => setSidebarMode("thumbnails")}
                  title="显示页面缩略图"
                  type="button"
                >
                  <DocumentRegular />
                </button>
                <button
                  aria-label="批注"
                  className={sidebarMode === "annotations" ? "active" : ""}
                  onClick={() => setSidebarMode("annotations")}
                  title="显示当前文档批注"
                  type="button"
                >
                  <CommentRegular />
                </button>
                <button
                  aria-label="收起 PDF 左侧栏"
                  className="pdf-sidebar-collapse-button"
                  onClick={() => setSidebarCollapsed(true)}
                  title="收起 PDF 左侧栏"
                  type="button"
                >
                  <PanelLeftContractRegular />
                </button>
              </div>

              {sidebarMode === "thumbnails" ? (
                <ol className="pdf-thumbnail-list">
                  {pageNumbers.map((pageNumber) => (
                    <PdfThumbnail
                      active={pageNumber === focusedPage}
                      activePaper={activePaper}
                      key={pageNumber}
                      pageNumber={pageNumber}
                      pdfDocument={pdfDocument}
                    />
                  ))}
                </ol>
              ) : (
                <div className="pdf-sidebar-annotations">
                  <div aria-live="polite" className="pdf-status">
                    {status}
                  </div>
                  <label className="pdf-annotation-auto-public-toggle">
                    <input
                      checked={autoPublicAnnotations}
                      onChange={(event) => setAutoPublic(event.currentTarget.checked)}
                      type="checkbox"
                    />
                    新批注自动公开到 Intuecho
                  </label>
                  {pendingPublicAnnotations.length > 0 ? (
                    <div className="pdf-public-annotation-status">
                      <span>{PDF_ANNOTATION_PENDING_LABEL} · {pendingPublicAnnotations.length}</span>
                      <button disabled={syncingAnnotations} onClick={() => void syncPublicAnnotations()} type="button">
                        {syncingAnnotations ? "正在同步" : "立即同步"}
                      </button>
                    </div>
                  ) : null}
                  {annotations.length > 0 ? (
                    <ul className="pdf-annotation-list">
                      {annotations.map((annotation) => (
                        <li className={`pdf-annotation-item ${annotation.kind}`} key={annotation.id}>
                          {annotation.kind === "highlight" && annotation.color && (
                            <div
                              className="annotation-color-indicator"
                              style={{ backgroundColor: getHighlightColor(annotation.color) }}
                            />
                          )}
                          <button
                            aria-label={`编辑批注：${annotation.excerpt}`}
                            className="pdf-annotation-summary"
                            onClick={() => openAnnotationEditor(annotation)}
                            title="打开此批注的补充笔记"
                            type="button"
                          >
                            <span className="pdf-annotation-kind">{annotation.text}</span>
                            <span className="pdf-annotation-excerpt">{annotation.excerpt}</span>
                          </button>
                          {annotation.note && (
                            <div className="annotation-divider" />
                          )}
                          {activeAnnotationId === annotation.id ? (
                            <div className="pdf-annotation-editor">
                              <div className="note-editor">
                                <textarea
                                  aria-label="补充批注笔记"
                                  onChange={(e) => setAnnotationNoteDraft(e.target.value)}
                                  placeholder="添加批注..."
                                  rows={3}
                                  value={annotationNoteDraft}
                                />
                                <div className="editor-actions">
                                  <button onClick={saveAnnotationNote} type="button" className="save-button">
                                    保存笔记
                                  </button>
                                  <button onClick={() => setActiveAnnotationId(null)} type="button" className="cancel-button">
                                    取消
                                  </button>
                                </div>
                              </div>
                              {annotation.kind === "highlight" && (
                                <div className="color-selector">
                                  {(["yellow", "red", "blue", "green", "pink"] as HighlightColor[]).map((color) => (
                                    <button
                                      key={color}
                                      className={`color-option ${selectedColor === color ? "active" : ""}`}
                                      style={{ backgroundColor: getHighlightColor(color) }}
                                      onClick={() => {
                                        // 更新高亮颜色
                                        setAnnotations(current =>
                                          current.map(a =>
                                            a.id === annotation.id
                                              ? { ...a, color }
                                              : a
                                          )
                                        );
                                        setStatus("已更新高亮颜色。");
                                      }}
                                      title={`选择${color === "yellow" ? "黄色" : color === "red" ? "红色" : color === "blue" ? "蓝色" : color === "green" ? "绿色" : "粉色"}高亮`}
                                      type="button"
                                    />
                                  ))}
                                </div>
                              )}
                              <button onClick={() => {
                                // 删除批注
                                setAnnotations(current => current.filter(a => a.id !== annotation.id));
                                setActiveAnnotationId(null);
                                setStatus("已删除批注。");
                              }} type="button" className="delete-button">
                                删除
                              </button>
                            </div>
                          ) : annotation.note ? (
                            <div className="annotation-note-preview">
                              补充：{annotation.note.length > 50
                                ? `${annotation.note.substring(0, 50)}...`
                                : annotation.note}
                            </div>
                          ) : null}
                          <label className="pdf-annotation-public-toggle">
                            <input
                              checked={annotation.visibility === "pending_public"}
                              onChange={(event) => setAnnotationPublic(annotation.id, event.currentTarget.checked)}
                              type="checkbox"
                            />
                            公开到 Intuecho
                          </label>
                          {annotation.visibility === "pending_public" ? <small>{PDF_ANNOTATION_PENDING_LABEL}</small> : null}
                          {annotation.syncState?.status === "synced" ? <small>已同步到 Intuecho</small> : null}
                          {annotation.syncState?.status === "failed" ? <small>同步失败：{annotation.syncState.error}</small> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="pdf-empty-note">暂无批注</div>
                  )}
                </div>
              )}
            </>
          )}
        </aside>


        <section
          aria-label="PDF 页面预览"
          className="pdf-main-stage"
        >
          {targetEvidence?.paperId === activePaper?.id ? (
            <div aria-live="polite" className="pdf-evidence-status" role="status">
              {status}
            </div>
          ) : null}
          <div
            aria-label="PDF 页面滚动区"
            className="pdf-stage"
            onContextMenu={handleSelectionContextMenu}
            onMouseUp={handleTextSelection}
            ref={stageRef}
          >
            <div aria-label="PDF.js 页面列表" className="pdf-page-list responsive">
              {pageNumbers.map((pageNumber) => (
                <PdfPageView
                  activePaper={activePaper}
                  annotations={annotations}
                  focused={pageNumber === focusedPage}
                  key={pageNumber}
                  onEvidenceHighlightResolved={handleEvidenceHighlightResolved}
                  pageNumber={pageNumber}
                  pdfDocument={pdfDocument}
                  stageWidth={stageWidth}
                  targetEvidence={targetEvidence}
                  zoom={zoom}
                />
              ))}
            </div>
            {selection ? (
              <div
                aria-label="选中文本批注菜单"
                className="pdf-selection-menu"
                style={{ left: selection.menuLeft, top: selection.menuTop }}
              >
                <div className="selection-menu-row">
                  <button onClick={() => addAnnotation("highlight")} title="高亮选中文段" type="button">
                    高亮
                  </button>
                  <div className="color-selector">
                    {(["yellow", "red", "blue", "green", "pink"] as HighlightColor[]).map((color) => (
                      <button
                        key={color}
                        className={`color-option ${selectedColor === color ? "active" : ""}`}
                        style={{ backgroundColor: getHighlightColor(color) }}
                        onClick={() => setSelectedColor(color)}
                        title={`选择${color === "yellow" ? "黄色" : color === "red" ? "红色" : color === "blue" ? "蓝色" : color === "green" ? "绿色" : "粉色"}高亮`}
                        type="button"
                      />
                    ))}
                  </div>
                </div>
                <div className="selection-menu-row">
                  <button onClick={() => addAnnotation("underline")} title="给选中文段添加下划线" type="button">
                    划线
                  </button>
                </div>
                <div className="selection-menu-row">
                  <button onClick={() => addAnnotation("note")} title="给选中文段添加旁注" type="button">
                    注释
                  </button>
                </div>
                <div className="selection-menu-row">
                  <button onClick={addSelectionToConversation} title="把选中文段加入右侧对话上下文" type="button" className="add-to-conversation">
                    加入对话
                  </button>
                </div>
                              </div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
