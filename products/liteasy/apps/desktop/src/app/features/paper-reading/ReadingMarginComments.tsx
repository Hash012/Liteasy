import { useEffect, useRef, useState, type RefObject } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { DocumentPdfRegular, EditRegular } from "@fluentui/react-icons";
import type { PdfAnnotationV2 } from "../pdf/pdfAnnotationStorage";
import { PdfAnnotationMarkdown } from "../pdf/PdfAnnotationMarkdown";
import { indexReadingHighlights, readingHighlightRange } from "./readingHighlightRanges";
import { layoutReadingMarginCards } from "./readingMarginLayout";
import "./readingMarginComments.css";

type MarginLayout = {
  cards: ReturnType<typeof layoutReadingMarginCards>;
  left: number;
  top: number;
  bottom: number;
  width: number;
  unavailable: string;
  unmatched: number;
};
const emptyLayout: MarginLayout = { cards: [], left: 0, top: 0, bottom: 0, width: 0, unavailable: "", unmatched: 0 };

export function ReadingMarginComments({ contentRef, annotations, selectedId, disabled, onSelect, onEdit, onOpenPdf, onShowList }: {
  contentRef: RefObject<HTMLDivElement>;
  annotations: readonly PdfAnnotationV2[];
  selectedId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onEdit: (annotation: PdfAnnotationV2) => void;
  onOpenPdf: (id: string) => void;
  onShowList: () => void;
}) {
  const [layout, setLayout] = useState(emptyLayout);
  const railRef = useRef<HTMLElement>(null);
  useEffect(() => {
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
      const available = !translatedOnly && scroller.clientWidth >= 600;
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
      const top = Math.max(8, bounds.top - outer.top + 8);
      const bottom = Math.min(outer.height - 8, bounds.bottom - outer.top - 8);
      const width = 220;
      const left = bounds.left - outer.left + scroller.clientWidth - width - 20;
      const anchors = available ? ranges.flatMap(({ id, range }) => {
        const rect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0 && rect.bottom > outer.top + top && rect.top < outer.top + bottom - 36);
        if (!rect) return [];
        const card = Array.from(railRef.current?.querySelectorAll<HTMLElement>("[data-margin-annotation]") ?? []).find((item) => item.dataset.marginAnnotation === id);
        return [{ id, x: Math.min(left - 12, rect.right - outer.left), y: Math.max(top, Math.min(bottom - 36, rect.top + rect.height / 2 - outer.top)), height: card?.offsetHeight || 156 }];
      }) : [];
      const next: MarginLayout = { cards: layoutReadingMarginCards(anchors, top, bottom - 36), left, top, bottom, width, unmatched,
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
    schedule();
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); resize?.disconnect();
      root.removeEventListener("scroll", schedule, true); root.removeEventListener("load", schedule, true);
      window.removeEventListener("resize", schedule); document.fonts?.removeEventListener("loadingdone", schedule);
      delete root.dataset.readingMargins;
    };
  }, [contentRef, annotations]);

  return <aside className="reading-margin-layer" aria-label="阅读页边批注" ref={railRef}>
    <svg className="reading-margin-connectors" aria-hidden="true">
      {layout.cards.map((card) => <path key={card.id} data-annotation-connector={card.id} data-active={selectedId === card.id}
        d={`M ${card.x} ${card.y} C ${card.x + 18} ${card.y}, ${layout.left - 18} ${card.top + 20}, ${layout.left} ${card.top + 20}`} />)}
    </svg>
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
