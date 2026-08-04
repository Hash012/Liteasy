/**
 * The extracted page text of a paper, kept in the library rather than the cache.
 *
 * Anchors and highlights are positioned against these text offsets, and OCR is not
 * reproducible — re-extracting a scanned paper can yield different text. So throwing this
 * away and re-deriving it would silently drift every mark the user has made, which feels
 * identical to losing them.
 */
export type PaperFulltextPage = {
  /** OCR positions must never be confused with a selectable PDF text layer. */
  textExtraction?: "embedded" | "ocr";
  page: number;
  text: string;
};

export type PaperFulltextSnapshot = {
  /** Parser provenance affects citation/position confidence and must survive cache clearing. */
  parser: "local_pdfjs";
  extractedAt: string;
  pages: PaperFulltextPage[];
  version: 2;
};

export type PaperPageTextRecord = Record<number, string>;

function isPage(value: unknown): value is PaperFulltextPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<PaperFulltextPage>;
  return typeof candidate.page === "number" && Number.isInteger(candidate.page) &&
    candidate.page > 0 && typeof candidate.text === "string" &&
    (candidate.textExtraction === undefined || candidate.textExtraction === "embedded" ||
      candidate.textExtraction === "ocr");
}

export function normalizePaperFulltext(value: unknown): PaperFulltextSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<PaperFulltextSnapshot>;
  if (!Array.isArray(candidate.pages)) {
    return undefined;
  }
  const pages = candidate.pages.filter(isPage).map((page) => ({
    ...page,
    // Version 1 snapshots only contained selectable text-layer output.
    textExtraction: page.textExtraction ?? "embedded" as const
  }));
  return {
    parser: "local_pdfjs",
    extractedAt: typeof candidate.extractedAt === "string" ? candidate.extractedAt : "",
    pages: sortPages(pages),
    version: 2
  };
}

function sortPages(pages: readonly PaperFulltextPage[]) {
  return [...pages].sort((left, right) => left.page - right.page);
}

export function paperFulltextPagesToRecord(
  pages: readonly PaperFulltextPage[]
): PaperPageTextRecord {
  const record: PaperPageTextRecord = {};
  for (const page of pages) {
    record[page.page] = page.text;
  }
  return record;
}

export function paperFulltextExtractionsToRecord(
  pages: readonly PaperFulltextPage[]
): Record<number, "embedded" | "ocr"> {
  return Object.fromEntries(
    pages.map((page) => [page.page, page.textExtraction ?? "embedded"])
  );
}

export function paperPageTextRecordToPages(record: PaperPageTextRecord): PaperFulltextPage[] {
  return sortPages(
    Object.entries(record).map(([page, text]) => ({ page: Number(page), text }))
  );
}

/**
 * Pages arrive as the reader renders them, so what is in memory is often a subset of what
 * has already been stored. Merging rather than replacing keeps a partial read from
 * shrinking a complete record.
 */
export function mergePaperPageTexts(
  stored: PaperPageTextRecord,
  incoming: PaperPageTextRecord
): PaperPageTextRecord {
  const merged = { ...stored };
  for (const [page, text] of Object.entries(incoming)) {
    const pageNumber = Number(page);
    // A scanned page's live PDF text layer is empty. Stored OCR is the authoritative text and
    // must not be erased merely because the page was rendered again.
    if (text.trim() || !merged[pageNumber]?.trim()) {
      merged[pageNumber] = text;
    }
  }
  return merged;
}

/**
 * Which rendered pages carry no text at all, and whether that is true of the whole document.
 *
 * Only rendered pages count. A page nobody has scrolled to yet is *unknown*, not empty, and
 * treating absence as emptiness would accuse an ordinary document of being a scan the moment it
 * opened. Callers use this to say why a page has no anchors instead of showing an empty layer.
 */
export function findPagesWithoutTextLayer(pageTexts: PaperPageTextRecord) {
  const entries = Object.entries(pageTexts);
  const pages = entries
    .filter(([, text]) => text.trim().length === 0)
    .map(([page]) => Number(page))
    .sort((left, right) => left - right);
  return {
    documentHasNoTextLayer: entries.length > 0 && pages.length === entries.length,
    pages
  };
}

export function samePaperPageTexts(left: PaperPageTextRecord, right: PaperPageTextRecord) {
  const leftPages = Object.keys(left);
  if (leftPages.length !== Object.keys(right).length) {
    return false;
  }
  return leftPages.every((page) => left[Number(page)] === right[Number(page)]);
}

export function buildPaperFulltextSnapshot(input: {
  extractedAt: string;
  pageTextExtractions?: Readonly<Record<number, "embedded" | "ocr">>;
  pageTexts: PaperPageTextRecord;
}): PaperFulltextSnapshot {
  return {
    parser: "local_pdfjs",
    extractedAt: input.extractedAt,
    pages: paperPageTextRecordToPages(input.pageTexts).map((page) => ({
      ...page,
      textExtraction: input.pageTextExtractions?.[page.page] ?? "embedded"
    })),
    version: 2
  };
}
