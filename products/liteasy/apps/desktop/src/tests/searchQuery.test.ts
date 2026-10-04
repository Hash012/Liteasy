import { describe, expect, test } from "vitest";
import { compileSearchQuery, updateSearchFacet } from "../app/features/search/searchQuery";
import { highlightSearchText } from "../app/features/search/searchDomHighlight";
import { queryReadingCatalog, indexReadingCatalog } from "../app/features/library/readingCatalogSearch";
import { findPdfReaderSearchMatches } from "../app/features/pdf/pdfReaderSearch";
import { buildAiPaperFolders } from "../app/features/ai-workbench/aiPaperSelection";

describe("shared asset search", () => {
  test("combines required tags, alternative formats/types and exclusions before matching text", () => {
    const query = compileSearchQuery('memory tag:"精读" tag:"2024" -tag:翻译 format:pdf format:md -format:txt type:book type:note -type:report');
    expect(query.matches("Episodic MEMORY", { tags: ["精读", "2024"], format: "markdown", assetType: "note" })).toBe(true);
    expect(query.matches("memory", { tags: ["精读"], format: "pdf", assetType: "book" })).toBe(false);
    expect(query.matches("memory", { tags: ["精读", "2024", "翻译"], format: "pdf", assetType: "book" })).toBe(false);
    expect(query.matches("memory", { tags: ["精读", "2024"], format: "txt", assetType: "book" })).toBe(false);
    expect(query.matches("unrelated", { tags: ["精读", "2024"], format: "pdf", assetType: "book" })).toBe(false);
    expect(compileSearchQuery('-tag:翻译').matches("anything", {})).toBe(true);
  });
  test("regex uses real UTF-16 offsets and does not freeze on nested quantifiers", () => {
    const text = "😀文 Memory memory";
    expect(compileSearchQuery('/文|memory/i').ranges(text).map((range) => text.slice(range.start, range.end))).toEqual(["文", "Memory", "memory"]);
    expect(compileSearchQuery('re:"(a+)+$"').textMatches("a".repeat(20000) + "!")).toBe(false);
    expect(compileSearchQuery('/^$/').ranges("text")).toEqual([]);
    expect(compileSearchQuery('/z*/').ranges("x".repeat(500) + "zz")).toEqual([{ start: 500, end: 502 }]);
    expect(compileSearchQuery('"   "').hasText).toBe(false);
    for (const query of ['re:"["', '/(a)\\1/', '/(?=x)/', 'tag:', '"unfinished']) {
      expect(compileSearchQuery(query).error).not.toBe(""); expect(compileSearchQuery(query).matches("anything")).toBe(false);
    }
  });
  test("case/width folding highlights original glyphs and facet editing preserves regex", () => {
    const text = "前缀 ＡＩ\n  记忆 suffix";
    const range = compileSearchQuery('"ai 记忆"').ranges(text)[0];
    expect(text.slice(range.start, range.end)).toBe("ＡＩ\n  记忆");
    const query = updateSearchFacet('/memory|记忆/i tag:精读', "tag", "AI 生成", true, true);
    expect(compileSearchQuery(query).matches("记忆", { tags: ["精读"] })).toBe(true);
    expect(compileSearchQuery(query).matches("记忆", { tags: ["精读", "AI 生成"] })).toBe(false);
    expect(updateSearchFacet(query, "tag", "AI 生成", false, false)).toBe('/memory|记忆/i tag:精读');
  });
  test("catalog name-only queries exclude abstract-only matches and support negative tags", () => {
    const index = indexReadingCatalog([
      { id: "1", title: "Cicada", abstract: "transaction memory", format: "pdf", tags: ["精读"], assetType: "conference-paper" },
      { id: "2", title: "Memory notes", format: "markdown", tags: ["翻译"] },
      { id: "3", title: "Memory book", format: "epub", tags: ["精读"], assetType: "book" },
    ]);
    const filters = { query: '/memory/i -tag:翻译', format: "all" as const, status: "all" as const, collection: "", year: "", sort: "title" as const };
    expect(queryReadingCatalog(index, filters).map((row) => row.id)).toEqual(["1", "3"]);
    expect(queryReadingCatalog(index, { ...filters, scope: "name" }).map((row) => row.id)).toEqual(["3"]);
    expect(queryReadingCatalog(index, { ...filters, query: 'tag:精读 -format:epub' }).map((row) => row.id)).toEqual(["1"]);
  });
  test("PDF regex matches carry the exact quote for text-layer highlights", () => {
    expect(findPdfReaderSearchMatches({ 2: "😀 memory 42", 1: "Memory 7" }, '/memory \\d+/i tag:精读', { metadata: { format: "pdf", tags: ["精读"] } })).toEqual([
      { page: 1, start: 0, length: 8, quote: "Memory 7" }, { page: 2, start: 3, length: 9, quote: "memory 42" },
    ]);
    expect(findPdfReaderSearchMatches({ 1: "Memory 7" }, '/memory/ -format:pdf')).toEqual([]);
  });
  test("task paper selection applies the same tag and format exclusions", () => {
    const papers = [{ id: "1", title: "Memory research" }, { id: "2", title: "Memory translation" }];
    const metadata = new Map([["1", { format: "pdf", tags: ["精读"] }], ["2", { format: "pdf", tags: ["翻译"] }]]);
    expect(buildAiPaperFolders(papers, null, '/memory/i format:pdf -tag:翻译', metadata).papers.map((paper) => paper.id)).toEqual(["1"]);
  });
  test("DOM highlights span inline formatting without modifying the document or selection", () => {
    const root = document.createElement("div"); root.innerHTML = '<p>Earlier memory; <em>episodic</em> <strong>memory</strong>.</p><button>episodic memory</button>';
    const shell = document.createElement("div"); shell.setAttribute("aria-hidden", "true"); shell.append(root); document.body.append(shell); const before = root.innerHTML;
    const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(root.querySelector("em")!); selection?.addRange(range);
    const hit = highlightSearchText(root, '"episodic memory"');
    expect(hit.ranges.map((range) => range.toString())).toEqual(["episodic memory"]);
    expect(root.innerHTML).toBe(before); expect(selection?.toString()).toBe("episodic");
    hit.clear(); selection?.removeAllRanges(); shell.remove();
  });
});
