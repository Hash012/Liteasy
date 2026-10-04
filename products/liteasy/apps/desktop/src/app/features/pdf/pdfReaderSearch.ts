import { compileSearchQuery, type SearchMetadata } from "../search/searchQuery";
export type PdfReaderSearchMatch = {
  quote?: string;
  length: number;
  page: number;
  start: number;
};

export type PdfReaderSearchOptions = {
  metadata?: SearchMetadata;
  matchCase?: boolean;
  wholeWords?: boolean;
};

function normalizeSearchText(value: string, matchCase: boolean) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return matchCase ? normalized : normalized.toLowerCase();
}

export function findPdfReaderSearchMatches(
  pageTexts: Record<number, string>,
  query: string,
  options: PdfReaderSearchOptions = {}
): PdfReaderSearchMatch[] {
  const compiled = compileSearchQuery(compileSearchQuery(query).advanced ? query : normalizeSearchText(query, true), { ...options, phrase: true });
  if (!compiled.hasText || !compiled.metadata(options.metadata ?? { format: "pdf" })) return [];

  const matches: PdfReaderSearchMatch[] = [];
  const pages = Object.keys(pageTexts)
    .map(Number)
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((left, right) => left - right);

  for (const page of pages) {
    const text = normalizeSearchText(pageTexts[page] ?? "", true);
    if (!compiled.textMatches(text)) continue;
    for (const range of compiled.ranges(text, 10000)) {
      matches.push({ length: range.end - range.start, page, start: range.start,
        quote: text.slice(range.start, range.end) });
    }
  }

  return matches;
}
