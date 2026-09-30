export type PdfInkPoint = { x: number; y: number };
export type PdfInkStroke = { points: PdfInkPoint[]; color: string; width: number };
export type PdfInkMode = "draw" | "erase" | null;

export const pdfInkGroupingWindowMs = 10_000;
export const pdfInkGroupingDistance = 2;

export function isPdfInkStrokeGroup(value: unknown): value is PdfInkStroke[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 256 &&
    value.every(isPdfInkStroke) &&
    value.reduce((count, stroke) => count + stroke.points.length, 0) <= 48_000;
}

export function pdfInkStrokes(annotation: { ink?: PdfInkStroke; inkStrokes?: PdfInkStroke[] }): PdfInkStroke[] {
  return annotation.inkStrokes?.length ? annotation.inkStrokes : annotation.ink ? [annotation.ink] : [];
}

export function pdfInkGroupBounds(strokes: PdfInkStroke[]) {
  const rects = strokes.map(pdfInkBounds);
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  return {
    left,
    top,
    width: Math.max(...rects.map((rect) => rect.left + rect.width)) - left,
    height: Math.max(...rects.map((rect) => rect.top + rect.height)) - top
  };
}

export function canGroupPdfInkStroke(
  annotation: {
    kind: string; page: number; createdAt: string; inkLastStrokeAt?: string;
    ink?: PdfInkStroke; inkStrokes?: PdfInkStroke[];
    publication?: { desiredVisibility: string; state: string };
  },
  page: number,
  stroke: PdfInkStroke,
  now: number
) {
  if (annotation.kind !== "ink" || annotation.page !== page ||
    annotation.publication?.desiredVisibility === "public" ||
    (annotation.publication && annotation.publication.state !== "not_published")) return false;
  const elapsed = now - Date.parse(annotation.inkLastStrokeAt ?? annotation.createdAt);
  const strokes = pdfInkStrokes(annotation);
  if (elapsed < 0 || elapsed > pdfInkGroupingWindowMs || !strokes.length ||
    !isPdfInkStrokeGroup([...strokes, stroke])) return false;
  const previous = pdfInkBounds(strokes.at(-1)!);
  const next = pdfInkBounds(stroke);
  const dx = Math.max(0, previous.left - next.left - next.width, next.left - previous.left - previous.width);
  const dy = Math.max(0, previous.top - next.top - next.height, next.top - previous.top - previous.height);
  return Math.hypot(dx, dy) <= pdfInkGroupingDistance;
}

export function isPdfInkStroke(value: unknown): value is PdfInkStroke {
  if (!value || typeof value !== "object") return false;
  const stroke = value as PdfInkStroke;
  return /^#[0-9a-f]{6}$/i.test(stroke.color) && Number.isFinite(stroke.width) && stroke.width > 0 && stroke.width <= 3 &&
    Array.isArray(stroke.points) && stroke.points.length > 0 && stroke.points.length <= 12000 &&
    stroke.points.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100);
}

export function pdfInkBounds(stroke: PdfInkStroke) {
  const left = Math.max(0, Math.min(...stroke.points.map((point) => point.x)) - stroke.width);
  const top = Math.max(0, Math.min(...stroke.points.map((point) => point.y)) - stroke.width);
  return { left, top,
    width: Math.min(100 - left, Math.max(...stroke.points.map((point) => point.x)) + stroke.width - left),
    height: Math.min(100 - top, Math.max(...stroke.points.map((point) => point.y)) + stroke.width - top)
  };
}
