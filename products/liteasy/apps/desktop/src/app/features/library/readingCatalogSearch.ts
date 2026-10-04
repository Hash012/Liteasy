import { compileSearchQuery } from "../search/searchQuery";
import { catalogSearchMetadata } from "../search/searchMetadata";
import type { ReadingCatalogEntry, ReadingCatalogFormat, ReadingCatalogStatus } from "./readingCatalog.types";
import { assetTypeLabels, inferAssetType } from "./libraryAssetMetadata";

export type ReadingCatalogSort = "added" | "title" | "author" | "year-desc" | "year-asc";

export type ReadingCatalogFilters = {
  query: string;
  format: ReadingCatalogFormat | "all";
  status: ReadingCatalogStatus | "all";
  collection: string;
  year: string;
  sort: ReadingCatalogSort;
  assetType?: string;
  author?: string;
  subject?: string;
  tags?: string[];
  excludeTags?: string[];
  scope?: "metadata" | "name";
};

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** Build once per catalog revision, rather than re-normalizing every field on each keystroke. */
export function indexReadingCatalog(entries: readonly ReadingCatalogEntry[]) {
  return entries.map((entry) => ({
    entry,
    metadata: catalogSearchMetadata(entry),
    nameSearch: [entry.title, entry.fileName].filter(Boolean).join(" "),
    search: [
      entry.title, ...(entry.authors ?? []), entry.publication, entry.doi,
      entry.identifier, entry.language, entry.publishedAt,
      entry.abstract, ...(entry.tags ?? []), entry.collection, entry.year,
      entry.format, entry.fileName, entry.physicalPath, entry.liteasyPath,
      entry.assetType, assetTypeLabels[entry.assetType || inferAssetType(entry.format)], ...(entry.subjects ?? [])
    ].filter((value) => value !== undefined).join(" "),
    added: Math.max(0, Date.parse(entry.addedAt ?? "") || 0)
  }));
}

export function queryReadingCatalog(index: ReturnType<typeof indexReadingCatalog>, filters: ReadingCatalogFilters) {
  const compiled = compileSearchQuery(filters.query);
  const rows = index.filter(({ entry, search, nameSearch, metadata }) => (
    (filters.format === "all" || entry.format === filters.format)
    && (filters.status === "all" || (entry.readingStatus ?? "unread") === filters.status)
    && (!filters.collection || entry.collection === filters.collection)
    && (!filters.year || String(entry.year ?? "unknown") === filters.year)
    && (!filters.assetType || (entry.assetType || inferAssetType(entry.format)) === filters.assetType)
    && (!filters.author || (entry.authors ?? []).some((author) => normalize(author).includes(normalize(filters.author!))))
    && (!filters.subject || (entry.subjects ?? []).some((subject) => normalize(subject).includes(normalize(filters.subject!))))
    && (filters.tags ?? []).every((tag) => (entry.tags ?? []).some((value) => normalize(value) === normalize(tag)))
    && !(filters.excludeTags ?? []).some((tag) => (entry.tags ?? []).some((value) => normalize(value) === normalize(tag)))
    && compiled.matches(filters.scope === "name" ? nameSearch : search, metadata)
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
