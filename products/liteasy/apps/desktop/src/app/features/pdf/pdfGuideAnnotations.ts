import type { PdfAnnotationV2 } from "./pdfAnnotationStorage";

export function isUntouchedGuide(mark: PdfAnnotationV2) {
  return Boolean(mark.aiGuide) && mark.revision === 1 && mark.publication.state === "not_published";
}

export function mergePdfGuides(current: PdfAnnotationV2[], additions: PdfAnnotationV2[], replacePages: number[]) {
  const retained = current.filter((mark) => !isUntouchedGuide(mark) || !replacePages.includes(mark.page));
  return [...retained, ...additions.filter((mark) => !retained.some((saved) => saved.aiGuide && saved.page === mark.page && saved.excerpt === mark.excerpt))];
}
