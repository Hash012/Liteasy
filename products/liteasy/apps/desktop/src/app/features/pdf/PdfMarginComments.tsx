import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { EditRegular } from "@fluentui/react-icons";
import { PdfAnnotationMarkdown } from "./PdfAnnotationMarkdown";
import type { PdfAnnotationRect, PdfAnnotationV2 } from "./pdfAnnotationStorage";

type CardMeasurement = { height: number; anchorOffset: number };
const cardGap = 8;
const pageBorder = 1;
const railGap = 8;

function marginAnchorY(rect: PdfAnnotationRect, pageHeight: number, kind?: PdfAnnotationV2["kind"], border = 0) {
  // Underlines use a 2px bottom border. Connect to that stroke, not the middle of the text.
  return border + pageHeight * (rect.top + rect.height * (kind === "underline" ? 1 : 0.5)) / 100 - (kind === "underline" ? 1 : 0);
}

export function layoutPdfMarginComments(
  annotations: readonly PdfAnnotationV2[],
  pageHeight: number,
  measurements: ReadonlyMap<string, CardMeasurement> = new Map(),
) {
  let nextTop = 0;
  return annotations
    .filter(annotation => (annotation.kind === "highlight" || annotation.kind === "underline") &&
      Boolean(annotation.note?.trim()) && annotation.rects.length > 0)
    .map(annotation => {
      const first = annotation.rects.reduce((a, b) => a.top < b.top || (a.top === b.top && a.left < b.left) ? a : b);
      // Use the end of the first selected line for both placement and the connector.
      // The globally rightmost rectangle can belong to a different line.
      const anchorRect = annotation.rects.filter(rect => Math.abs(rect.top - first.top) <= Math.min(rect.height, first.height) / 2)
        .reduce((a, b) => a.left + a.width > b.left + b.width ? a : b, first);
      return { annotation, anchorRect };
    })
    .sort((a, b) => a.anchorRect.top - b.anchorRect.top || a.anchorRect.left - b.anchorRect.left || a.annotation.id.localeCompare(b.annotation.id))
    .map(item => {
      const { height, anchorOffset } = measurements.get(item.annotation.id) ?? { height: 0, anchorOffset: 18 };
      const anchorY = marginAnchorY(item.anchorRect, pageHeight, item.annotation.kind, pageBorder);
      const top = Math.max(0, anchorY - anchorOffset, nextTop);
      nextTop = top + height + cardGap;
      return { ...item, top, height, anchorOffset };
    });
}

export function buildPdfMarginConnectorGeometry(input: {
  anchorRect: PdfAnnotationRect;
  kind?: PdfAnnotationV2["kind"];
  pageHeight: number;
  pageWidth: number;
  pageBorder?: number;
  commentTop?: number;
  commentAnchorOffset?: number;
}) {
  const border = input.pageBorder ?? 0;
  const startX = border + input.pageWidth * Math.min(100, input.anchorRect.left + input.anchorRect.width) / 100;
  const startY = marginAnchorY(input.anchorRect, input.pageHeight, input.kind, border);
  const endX = input.pageWidth + border * 2 + railGap;
  const endY = input.commentTop === undefined ? startY : input.commentTop + (input.commentAnchorOffset ?? 18);
  // Any vertical displacement stays in the gutter, outside the PDF text.
  return { left: startX, top: startY, length: Math.max(0, endX - startX),
    path: `M ${startX} ${startY} H ${endX - railGap / 2} V ${endY} H ${endX}` };
}

export function PdfMarginComments({ annotations, pageNumber, pageWidth, pageHeight, connectorsVisible, onEdit }: {
  annotations: readonly PdfAnnotationV2[];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  connectorsVisible: boolean;
  onEdit(annotation: PdfAnnotationV2, anchor: HTMLElement): void;
}) {
  const elements = useRef(new Map<string, HTMLElement>());
  const [measurements, setMeasurements] = useState(new Map<string, CardMeasurement>());
  const comments = useMemo(() => layoutPdfMarginComments(annotations, pageHeight, measurements), [annotations, pageHeight, measurements]);
  useLayoutEffect(() => {
    const measure = () => {
      const next = new Map<string, CardMeasurement>();
      for (const [id, element] of elements.current) {
        if (!element.offsetHeight) continue;
        const header = element.querySelector("header");
        next.set(id, { height: element.offsetHeight, anchorOffset: header ? header.offsetTop + header.offsetHeight / 2 : 18 });
      }
      setMeasurements(previous => next.size === previous.size && [...next].every(([id, value]) =>
        previous.get(id)?.height === value.height && previous.get(id)?.anchorOffset === value.anchorOffset) ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    for (const element of elements.current.values()) {
      observer?.observe(element);
      const header = element.querySelector("header");
      if (header) observer?.observe(header);
    }
    return () => observer?.disconnect();
  }, [comments]);
  if (!comments.length) return null;
  const railLeft = pageWidth + pageBorder * 2 + railGap;
  // Dense or long notes can extend the row instead of being stacked at 86% of the page.
  const height = Math.max(pageHeight + pageBorder * 2, ...comments.map(comment => comment.top + comment.height));
  return <aside aria-label={`第 ${pageNumber} 页页外批注栏`} className="pdf-margin-comment-rail" style={{ height }}>
    {connectorsVisible ? <svg aria-hidden="true" className="pdf-margin-comment-connectors"
      width={railLeft} height={height} style={{ left: -railLeft }}>
      {comments.map(({ annotation, anchorRect, top, anchorOffset }) => {
        const connector = buildPdfMarginConnectorGeometry({ anchorRect, kind: annotation.kind, pageHeight, pageWidth, pageBorder, commentTop: top, commentAnchorOffset: anchorOffset });
        return <g key={annotation.id} data-annotation-id={annotation.id}>
          <path className="pdf-margin-comment-connector" d={connector.path} />
          <circle className="pdf-margin-comment-origin" cx={connector.left} cy={connector.top} r={2.5} />
        </g>;
      })}
    </svg> : null}
    {comments.map(({ annotation, top }) => {
      const label = annotation.kind === "highlight" ? "高亮" : "划线";
      return <section key={annotation.id} data-annotation-id={annotation.id}
        ref={element => { if (element) elements.current.set(annotation.id, element); else elements.current.delete(annotation.id); }}
        aria-label={`第 ${annotation.page} 页${label}批注：${annotation.note}`} className="pdf-margin-comment"
        onPointerDown={event => event.stopPropagation()} style={{ top }}>
        <header><span>{label}</span>
          <Tooltip content="编辑批注" relationship="description"><Button aria-label={`编辑页边批注：${annotation.excerpt}`}
            appearance="subtle" icon={<EditRegular />} size="small" onClick={event => onEdit(annotation, event.currentTarget)} /></Tooltip>
        </header>
        <PdfAnnotationMarkdown value={annotation.note ?? ""} />
      </section>;
    })}
  </aside>;
}
