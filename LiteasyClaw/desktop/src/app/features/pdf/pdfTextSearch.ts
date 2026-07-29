/**
 * Canonical PDF text coordinates shared by extraction and the rendered text layer.
 * Offsets in evidence spans are measured in this folded representation.
 */
export function normalizePdfTextForSearch(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function compactPdfTextForSearch(value: string) {
  return normalizePdfTextForSearch(value).replace(/[\s-]+/g, "");
}
