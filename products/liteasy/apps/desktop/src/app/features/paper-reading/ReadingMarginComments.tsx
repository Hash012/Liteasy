import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { DocumentPdfRegular, EditRegular } from "@fluentui/react-icons";
import type { PdfAnnotationV2 } from "../pdf/pdfAnnotationStorage";
import { PdfAnnotationMarkdown } from "../pdf/PdfAnnotationMarkdown";
import { indexReadingHighlights, readingHighlightRange } from "./readingHighlightRanges";
import { clampReadingMarginWidth, layoutReadingMarginCards, readingMarginWidthLimits, routeReadingMarginConnectors } from "./readingMarginLayout";
import "./readingMarginComments.css";

type MarginLayout = {
  cards: ReturnType<typeof layoutReadingMarginCards>;
  left: number;
  top: number;
  bottom: number;
  width: number;
  availableWidth: number;
  pageEdge: number;
  scale: number;
  unavailable: string;
  unmatched: number;
};
const emptyLayout: MarginLayout = { cards: [], left: 0, top: 0, bottom: 0, width: 0, availableWidth: 0, pageEdge: 0, scale: 1, unavailable: "", unmatched: 0 };

export function ReadingMarginComments({ contentRef, annotations, selectedId, disabled, width: preferredWidth, onWidthChange, onSelect, onEdit, onOpenPdf, onShowList }: {
  contentRef: RefObject<HTMLDivElement>;
  annotations: readonly PdfAnnotationV2[];
  selectedId?: string;
  disabled: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onSelect: (id: string) => void;
  onEdit: (annotation: PdfAnnotationV2) => void;
  onOpenPdf: (id: string) => void;
  onShowList: () => void;
}) {
  const [layout, setLayout] = useState(emptyLayout);
  const railRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number }>();
  useEffect(() => {
    const root = contentRef.current;
    return () => { if (root) { delete root.dataset.readingMargins; root.style.removeProperty("--reading-margin-width"); } };
  }, [contentRef]);
  useLayoutEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let frame = 0;
    let disposed = false;
    let dirty = true;
    let ranges: { id: string; range: Range }[] = [];
    let unmatched = 0;
    let observedCards = new Set<Element>();
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    const measure = () => {
      frame = 0;
      const pane = root.querySelector<HTMLElement>('.paper-resource-tab__reading-pane[aria-label="原文"]');
      const translatedOnly = !pane && Boolean(root.querySelector(".paper-resource-tab__reading-pane"));
      const scroller = pane ?? root.querySelector<HTMLElement>(".paper-resource-tab") ?? root;
      const outer = root.getBoundingClientRect();
      const bounds = scroller.getBoundingClientRect();
      const scaleX = outer.width / root.clientWidth || 1;
      const scaleY = outer.height / root.clientHeight || 1;
      const available = !translatedOnly && scroller.clientWidth >= 600;
      const width = clampReadingMarginWidth(preferredWidth, scroller.clientWidth);
      root.style.setProperty("--reading-margin-width", `${width}px`);
      root.dataset.readingMargins = available ? (pane ? "pane" : "document") : "unavailable";
      if (dirty) {
        const index = indexReadingHighlights(root);
        ranges = annotations.flatMap((annotation) => {
          // Position-dependent boxes and ink have no reliable reflowed text anchor.
          if (annotation.kind === "text" || annotation.kind === "ink") return [];
          const range = readingHighlightRange(index, annotation.excerpt, annotation.page);
          return range ? [{ id: annotation.id, range }] : [];
        });
        unmatched = annotations.length - ranges.length;
        resize?.disconnect();
        observedCards.clear();
        resize?.observe(root); resize?.observe(scroller);
        root.querySelectorAll(".mineru-markdown").forEach((body) => resize?.observe(body));
        dirty = false;
      }
      const top = Math.max(8, (bounds.top - outer.top) / scaleY + 8);
      const bottom = Math.min(outer.height / scaleY - 8, (bounds.bottom - outer.top) / scaleY - 8);
      const left = (bounds.left - outer.left) / scaleX + scroller.clientWidth - width - 20;
      const anchors = available ? ranges.flatMap(({ id, range }) => {
        const rect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0 && rect.bottom > outer.top + top * scaleY && rect.top < outer.top + (bottom - 36) * scaleY);
        if (!rect) return [];
        const card = Array.from(railRef.current?.querySelectorAll<HTMLElement>("[data-margin-annotation]") ?? []).find((item) => item.dataset.marginAnnotation === id);
        return [{ id, x: Math.min(left - 60, (rect.right - outer.left) / scaleX), y: Math.max(top, Math.min(bottom - 36, (rect.top + rect.height / 2 - outer.top) / scaleY)), height: card?.offsetHeight || 156 }];
      }) : [];
      const next: MarginLayout = { cards: layoutReadingMarginCards(anchors, top, bottom - 36), left, top, bottom, width, availableWidth: scroller.clientWidth, pageEdge: left - 56, scale: scaleX, unmatched,
        unavailable: translatedOnly ? "切换至原文可查看连线批注" : !available ? "加宽阅读区可查看页边连线" : "" };
      setLayout((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      const currentCards = new Set(railRef.current?.querySelectorAll("[data-margin-annotation]") ?? []);
      // Cards leave the viewport while scrolling; do not retain their detached DOM.
      observedCards.forEach((card) => { if (!currentCards.has(card)) resize?.unobserve(card); });
      currentCards.forEach((card) => { if (!observedCards.has(card)) resize?.observe(card); });
      observedCards = currentCards;
    };
    const observer = new MutationObserver((records) => {
      if (records.every((record) => railRef.current?.contains(record.target))) { schedule(); return; }
      dirty = true; schedule();
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    root.addEventListener("scroll", schedule, { capture: true, passive: true });
    root.addEventListener("load", schedule, true);
    window.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    measure();
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); resize?.disconnect();
      root.removeEventListener("scroll", schedule, true); root.removeEventListener("load", schedule, true);
      window.removeEventListener("resize", schedule); document.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [contentRef, annotations, preferredWidth]);

  return <aside className="reading-margin-layer" aria-label="阅读页边批注" ref={railRef}>
    <svg className="reading-margin-connectors" aria-hidden="true">
      {routeReadingMarginConnectors(layout.cards, layout.pageEdge, layout.left).map((route) => <path key={route.id} data-annotation-connector={route.id} data-active={selectedId === route.id} d={route.path} />)}
    </svg>
    {!layout.unavailable && layout.width > 0 ? <div role="separator" tabIndex={0} aria-label="调整页边批注宽度" aria-orientation="vertical"
      aria-valuemin={readingMarginWidthLimits.min} aria-valuemax={clampReadingMarginWidth(readingMarginWidthLimits.max, layout.availableWidth)} aria-valuenow={layout.width}
      className="reading-margin-resizer" title="拖动调整页边批注宽度；方向键微调，双击恢复默认"
      style={{ left: layout.left - 12, top: layout.top, height: Math.max(0, layout.bottom - layout.top) }}
      onDoubleClick={() => onWidthChange(readingMarginWidthLimits.default)}
      onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); drag.current = { x: event.clientX, width: layout.width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (drag.current) onWidthChange(clampReadingMarginWidth(drag.current.width + (drag.current.x - event.clientX) / layout.scale, layout.availableWidth)); }}
      onPointerUp={(event) => { drag.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { if (drag.current) onWidthChange(drag.current.width); drag.current = undefined; }}
      onLostPointerCapture={() => { drag.current = undefined; }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const width = event.key === "Home" ? readingMarginWidthLimits.min : event.key === "End" ? readingMarginWidthLimits.max : layout.width + (event.key === "ArrowLeft" ? 20 : -20);
        onWidthChange(clampReadingMarginWidth(width, layout.availableWidth));
      }} /> : null}
    {layout.cards.map((card) => {
      const annotation = annotations.find((item) => item.id === card.id);
      if (!annotation) return null;
      return <article className="reading-margin-card" key={card.id} data-margin-annotation={card.id} data-active={selectedId === card.id}
        aria-label={`第 ${annotation.page} 页页边批注：${annotation.excerpt}`}
        style={{ top: card.top, left: layout.left, width: layout.width }} onFocus={() => onSelect(card.id)} onClick={() => onSelect(card.id)}>
        <header><button type="button" className="reading-margin-source" title={annotation.excerpt} onClick={() => onSelect(card.id)}>第 {annotation.page} 页 · {annotation.excerpt}</button>
          <Tooltip content="编辑批注" relationship="description"><Button aria-label="编辑页边批注" appearance="subtle" size="small" icon={<EditRegular />} disabled={disabled} onClick={() => onEdit(annotation)} /></Tooltip>
          <Tooltip content="查看 PDF 原页" relationship="description"><Button aria-label="查看 PDF 原页" appearance="subtle" size="small" icon={<DocumentPdfRegular />} onClick={() => onOpenPdf(card.id)} /></Tooltip>
        </header>
        <div className="reading-margin-note"><PdfAnnotationMarkdown value={annotation.quickAsk ? `${annotation.quickAsk.question}\n\n${annotation.quickAsk.answer}` : annotation.note || annotation.review?.text || ""}
          images={annotation.images} emptyLabel="仅标记原文；点击编辑补充想法" /></div>
      </article>;
    })}
    <div className={`reading-margin-summary${layout.unavailable ? " is-unavailable" : ""}`}
      style={layout.unavailable ? undefined : { top: Math.max(layout.top, layout.bottom - 30), left: layout.left, width: layout.width }}>
      <Button size="small" appearance="subtle" onClick={onShowList}
        title={layout.unmatched ? `${layout.unmatched} 条批注未能精确匹配原文，可在列表中查看并定位 PDF。` : "查看、编辑全部批注"}>
        {layout.unavailable || (annotations.length ? `全部批注 ${annotations.length}${layout.unmatched ? ` · ${layout.unmatched} 条待定位` : ""}` : "暂无批注")}
      </Button>
    </div>
  </aside>;
}
