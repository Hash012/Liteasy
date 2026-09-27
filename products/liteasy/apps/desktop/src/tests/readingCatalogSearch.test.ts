import { describe, expect, test } from "vitest";
import { formatCatalogFileSize, indexReadingCatalog, queryReadingCatalog, readingCatalogCitation, type ReadingCatalogFilters } from "../app/features/library/readingCatalogSearch";
import type { ReadingCatalogEntry } from "../app/features/library/readingCatalog.types";

const filters: ReadingCatalogFilters = { query: "", format: "all", status: "all", collection: "", year: "", sort: "added" };
const entries: ReadingCatalogEntry[] = [
  { id: "paper", title: "Attention Is All You Need", authors: ["Ashish Vaswani"], format: "pdf", year: 2017, doi: "10.5555/3295222.3295349", publication: "NeurIPS", abstract: "Sequence transduction with self-attention", tags: ["Transformer", "经典"], collection: "深度学习", readingStatus: "finished", addedAt: "2026-01-01", liteasyPath: "liteasy://workspace/paper/paper" },
  { id: "book", title: "自然语言处理", authors: ["张三"], format: "epub", year: 2024, tags: ["Transformer"], collection: "深度学习", readingStatus: "reading", addedAt: "2026-01-03" },
  { id: "note", title: "Reading notes", format: "markdown", physicalPath: "/library/课题/notes.md", addedAt: "2026-01-02" }
];

describe("reading catalog search", () => {
  test("searches all metadata, supports combined words and quoted phrases with normalized casing", () => {
    const index = indexReadingCatalog(entries);
    for (const query of ["Vaswani transformer", '"attention is all" 2017', "NEURIPS", "transduction", "10.5555/3295222.3295349", "liteasy://workspace/paper/paper", "经典"]) {
      expect(queryReadingCatalog(index, { ...filters, query }).map((entry) => entry.id)).toEqual(["paper"]);
    }
    expect(queryReadingCatalog(index, { ...filters, query: "课题" }).map((entry) => entry.id)).toEqual(["note"]);
    expect(queryReadingCatalog(index, { ...filters, query: "Vaswani EPUB" })).toEqual([]);
  });

  test("combines format, reading status, collection, year and query filters", () => {
    const index = indexReadingCatalog(entries);
    expect(queryReadingCatalog(index, { ...filters, query: "transformer", format: "epub", status: "reading", collection: "深度学习", year: "2024" }).map((entry) => entry.id)).toEqual(["book"]);
    expect(queryReadingCatalog(index, { ...filters, status: "unread", year: "unknown" }).map((entry) => entry.id)).toEqual(["note"]);
  });

  test("sorts publication chronology separately from import time, keeping unknown years last", () => {
    const index = indexReadingCatalog(entries);
    expect(queryReadingCatalog(index, filters).map((entry) => entry.id)).toEqual(["book", "note", "paper"]);
    expect(queryReadingCatalog(index, { ...filters, sort: "year-asc" }).map((entry) => entry.id)).toEqual(["paper", "book", "note"]);
    expect(queryReadingCatalog(index, { ...filters, sort: "year-desc" }).map((entry) => entry.id)).toEqual(["book", "paper", "note"]);
    expect(entries.map((entry) => entry.id)).toEqual(["paper", "book", "note"]);
  });

  test("handles many entries without limiting the searchable corpus", () => {
    const many = Array.from({ length: 12_000 }, (_, n) => ({ id: String(n), title: `Paper ${n}`, format: "pdf" as const, doi: `10.1234/${n}` }));
    expect(queryReadingCatalog(indexReadingCatalog(many), { ...filters, query: "10.1234/11999" }).map((entry) => entry.id)).toEqual(["11999"]);
  });

  test("finds EPUB books by ISBN and preserves publication language and date as searchable metadata", () => {
    const book: ReadingCatalogEntry = {
      id: "epub-isbn", title: "Pride and Prejudice", format: "epub", authors: ["Jane Austen"],
      identifier: "urn:isbn:9780141439518", language: "en-GB", publishedAt: "2002-12-31"
    };
    const index = indexReadingCatalog([...entries, book]);
    for (const query of ["9780141439518", "en-GB", "2002-12-31"]) {
      expect(queryReadingCatalog(index, { ...filters, query })).toEqual([book]);
    }
  });

  test("copies real citation fields without inventing unknown metadata or doubling DOI URLs", () => {
    expect(readingCatalogCitation({ ...entries[0], doi: "https://doi.org/10.1234/example" })).toBe("Ashish Vaswani. (2017). Attention Is All You Need. NeurIPS. https://doi.org/10.1234/example");
    expect(readingCatalogCitation(entries[2])).toBe("Reading notes");
    expect(formatCatalogFileSize(1536)).toBe("1.5 KB");
    expect(formatCatalogFileSize(undefined)).toBe("未提供");
  });
});
