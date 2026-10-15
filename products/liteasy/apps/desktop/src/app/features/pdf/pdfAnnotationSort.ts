import type { PdfAnnotation } from "./pdfAnnotationStorage";
import { comparePdfAnnotationsByReadingOrder } from "./pdfAnnotationReadingOrder";

export type PdfAnnotationSort = "reading" | "created" | "modified";
export const pdfAnnotationSortLabels: Record<PdfAnnotationSort, string> = {
  reading: "原文顺序", created: "最近创建", modified: "最近修改"
};

export function comparePdfAnnotations(left: PdfAnnotation, right: PdfAnnotation, order: PdfAnnotationSort) {
  if (order !== "reading") {
    const field = order === "created" ? "createdAt" : "updatedAt";
    const leftTime = Date.parse(left[field]);
    const rightTime = Date.parse(right[field]);
    const difference = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    if (difference) return difference;
  }
  return comparePdfAnnotationsByReadingOrder(left, right);
}
