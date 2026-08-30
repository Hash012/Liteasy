import type { PdfAnnotation } from "./pdfAnnotationStorage";

type AnnotationPosition = {
  bottom: number;
  center: number;
  left: number;
  top: number;
  width: number;
};

function annotationPosition(annotation: PdfAnnotation): AnnotationPosition {
  if (annotation.rects.length === 0) {
    return { bottom: 100, center: 50, left: 0, top: 100, width: 100 };
  }
  const left = Math.min(...annotation.rects.map((rect) => rect.left));
  const right = Math.max(...annotation.rects.map((rect) => rect.left + rect.width));
  const top = Math.min(...annotation.rects.map((rect) => rect.top));
  const bottom = Math.max(...annotation.rects.map((rect) => rect.top + rect.height));
  return {
    bottom,
    center: (left + right) / 2,
    left,
    top,
    width: right - left
  };
}

/**
 * Sorts annotations by the PDF's logical text offset when available. Older annotations fall back
 * to a two-column-aware geometry order instead of their creation timestamp.
 */
export function comparePdfAnnotationsByReadingOrder(left: PdfAnnotation, right: PdfAnnotation) {
  if (left.page !== right.page) return left.page - right.page;

  if (
    typeof left.normalizedStart === "number" &&
    typeof right.normalizedStart === "number" &&
    left.normalizedStart !== right.normalizedStart
  ) {
    return left.normalizedStart - right.normalizedStart;
  }

  const leftPosition = annotationPosition(left);
  const rightPosition = annotationPosition(right);
  const separatedColumns =
    leftPosition.width < 48 &&
    rightPosition.width < 48 &&
    Math.abs(leftPosition.center - rightPosition.center) >= 24;

  if (separatedColumns && Math.abs(leftPosition.left - rightPosition.left) > 1) {
    return leftPosition.left - rightPosition.left;
  }
  if (Math.abs(leftPosition.top - rightPosition.top) > 0.2) {
    return leftPosition.top - rightPosition.top;
  }
  if (Math.abs(leftPosition.left - rightPosition.left) > 0.2) {
    return leftPosition.left - rightPosition.left;
  }
  if (Math.abs(leftPosition.bottom - rightPosition.bottom) > 0.2) {
    return leftPosition.bottom - rightPosition.bottom;
  }
  return left.id.localeCompare(right.id);
}

export function sortPdfAnnotationsByReadingOrder<T extends PdfAnnotation>(annotations: T[]) {
  return [...annotations].sort(comparePdfAnnotationsByReadingOrder) as T[];
}
