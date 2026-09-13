export type PdfInkPoint = { x: number; y: number };
export type PdfInkStroke = { points: PdfInkPoint[]; color: string; width: number };
export type PdfInkMode = "draw" | "erase" | null;

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
