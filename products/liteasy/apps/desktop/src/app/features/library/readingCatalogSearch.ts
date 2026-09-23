import type { ReadingCatalogEntry, ReadingCatalogFormat, ReadingCatalogStatus } from "./readingCatalog.types";

export type ReadingCatalogSort = "added" | "title" | "author" | "year-desc" | "year-asc";

export type ReadingCatalogFilters = {
  query: string;
  format: ReadingCatalogFormat | "all";
  status: ReadingCatalogStatus | "all";
  collection: string;
  year: string;
  sort: ReadingCatalogSort;
};

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** Build once per catalog revision, rather than re-normalizing every field on each keystroke. */
export function indexReadingCatalog(entries: readonly ReadingCatalogEntry[]) {
  return entries.map((entry) => ({
    entry,
    search: normalize([
      entry.title, ...(entry.authors ?? []), entry.publication, entry.doi,
      entry.identifier, entry.language, entry.publishedAt,
      entry.abstract, ...(entry.tags ?? []), entry.collection, entry.year,
      entry.format, entry.fileName, entry.physicalPath, entry.liteasyPath
    ].filter((value) => value !== undefined).join(" ")),
    added: Math.max(0, Date.parse(entry.addedAt ?? "") || 0)
  }));
}

export function queryReadingCatalog(index: ReturnType<typeof indexReadingCatalog>, filters: ReadingCatalogFilters) {
  // Quoted phrases and whitespace-separated words can be freely combined.
  const terms = Array.from(normalize(filters.query).matchAll(/"([^"]+)"|(\S+)/g), (match) => match[1] ?? match[2]);
  const rows = index.filter(({ entry, search }) => (
    (filters.format === "all" || entry.format === filters.format)
    && (filters.status === "all" || (entry.readingStatus ?? "unread") === filters.status)
    && (!filters.collection || entry.collection === filters.collection)
    && (!filters.year || String(entry.year ?? "unknown") === filters.year)
    && terms.every((term) => search.includes(term))
  ));
  rows.sort((left, right) => {
    let order = 0;
    if (filters.sort === "added") order = right.added - left.added;
    if (filters.sort === "author") order = collator.compare(left.entry.authors?.join(" ") ?? "\uffff", right.entry.authors?.join(" ") ?? "\uffff");
    if (filters.sort === "year-desc" || filters.sort === "year-asc") {
      // Unknown years always follow known publication years, in either direction.
      const leftYear = left.entry.year;
      const rightYear = right.entry.year;
      if (leftYear === undefined && rightYear !== undefined) return 1;
      if (leftYear !== undefined && rightYear === undefined) return -1;
      order = ((leftYear ?? 0) - (rightYear ?? 0)) * (filters.sort === "year-desc" ? -1 : 1);
    }
    return order || collator.compare(left.entry.title, right.entry.title) || collator.compare(left.entry.id, right.entry.id);
  });
  return rows.map(({ entry }) => entry);
}

export function readingCatalogCitation(entry: ReadingCatalogEntry) {
  return [
    entry.authors?.join(", "), entry.year ? `(${entry.year})` : undefined,
    entry.title, entry.publication, entry.doi ? `https://doi.org/${entry.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}` : undefined
  ].filter(Boolean).join(". ");
}

export function formatCatalogFileSize(bytes: number | undefined) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "未提供";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
