export type PdfReaderSearchMatch = {
  length: number;
  page: number;
  start: number;
};

export type PdfReaderSearchOptions = {
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

function isWordCharacter(value: string | undefined) {
  return Boolean(value && /[\p{L}\p{N}_]/u.test(value));
}

function isWholeWord(text: string, start: number, length: number) {
  return !isWordCharacter(text[start - 1]) && !isWordCharacter(text[start + length]);
}

export function findPdfReaderSearchMatches(
  pageTexts: Record<number, string>,
  query: string,
  options: PdfReaderSearchOptions = {}
): PdfReaderSearchMatch[] {
  const matchCase = options.matchCase ?? false;
  const normalizedQuery = normalizeSearchText(query, matchCase);
  if (!normalizedQuery) return [];

  const matches: PdfReaderSearchMatch[] = [];
  const pages = Object.keys(pageTexts)
    .map(Number)
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((left, right) => left - right);

  for (const page of pages) {
    const text = normalizeSearchText(pageTexts[page] ?? "", matchCase);
    let start = text.indexOf(normalizedQuery);
    while (start >= 0) {
      if (!options.wholeWords || isWholeWord(text, start, normalizedQuery.length)) {
        matches.push({ length: normalizedQuery.length, page, start });
      }
      start = text.indexOf(normalizedQuery, start + Math.max(1, normalizedQuery.length));
    }
  }

  return matches;
}
