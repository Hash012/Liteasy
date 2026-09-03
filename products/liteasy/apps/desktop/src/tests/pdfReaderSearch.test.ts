import { describe, expect, test } from "vitest";

import { findPdfReaderSearchMatches } from "../app/features/pdf/pdfReaderSearch";

describe("PDF reader search", () => {
  test("returns ordered matches across pages with Unicode-normalized text", () => {
    const matches = findPdfReaderSearchMatches({
      2: "第二页也讨论 Multi\u00admodal AI。",
      1: "Multimodal AI appears twice. multimodal AI is useful."
    }, "MULTIMODAL AI");

    expect(matches.map(({ page, start }) => ({ page, start }))).toEqual([
      { page: 1, start: 0 },
      { page: 1, start: 29 },
      { page: 2, start: 7 }
    ]);
  });

  test("supports case-sensitive and whole-word matching", () => {
    const pageTexts = {
      1: "Graph graph Graphical Graph"
    };

    expect(findPdfReaderSearchMatches(pageTexts, "Graph", {
      matchCase: true,
      wholeWords: true
    })).toEqual([
      { length: 5, page: 1, start: 0 },
      { length: 5, page: 1, start: 22 }
    ]);
  });

  test("does not search for an empty or whitespace-only query", () => {
    expect(findPdfReaderSearchMatches({ 1: "paper text" }, "  ")).toEqual([]);
  });
});
