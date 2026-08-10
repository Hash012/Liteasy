import { describe, expect, test } from "vitest";

import {
  buildThinReadingAnchorReferenceIndex,
  loadThinReadingAnchorReferenceIndex,
  reconstructPageTextsFromChunks
} from "../app/features/thin-reading/thinReadingAnchorReferences";
import type { ThinReadingAnchor } from "../app/features/thin-reading/thinReading.types";

const anchor: ThinReadingAnchor = {
  end: 16,
  evidenceIds: ["evidence-1"],
  externalSourceIds: [],
  id: "anchor-1",
  importance: 0.9,
  kind: "method",
  searchQuery: "late interaction retrieval",
  start: 0,
  summarySentenceId: "sentence-1",
  text: "Late interaction"
};

describe("thinReadingAnchorReferences", () => {
  test("uses only bibliography entries cited inside the anchor's supporting evidence", () => {
    const body = "Late interaction follows the token-level scoring design [1]. Unrelated setup cites [2].";
    const index = buildThinReadingAnchorReferenceIndex({
      anchors: [anchor],
      evidenceSpans: [{
        confidence: 0.9,
        id: "evidence-1",
        page: 1,
        pageTextEnd: body.indexOf("Unrelated"),
        pageTextStart: 0,
        paperId: "paper-1",
        quote: body.slice(0, body.indexOf("Unrelated"))
      }],
      pageTexts: {
        1: body,
        2: "References\n[1] Khattab O, Zaharia M. ColBERT: Efficient and Effective Passage Search.\n[2] Example B. Unrelated Setup."
      },
      paperId: "paper-1"
    });

    expect(index.get("anchor-1")).toEqual([{
      number: 1,
      text: "Khattab O, Zaharia M. ColBERT: Efficient and Effective Passage Search."
    }]);
  });

  test("reconstructs overlapped normalized page text from imported chunks", () => {
    const pages = reconstructPageTextsFromChunks([
      {
        page: 1,
        pageTextEnd: 11,
        pageTextStart: 0,
        paperId: "paper-1",
        paperTitle: "Paper",
        snippet: "hello world",
        summary: "hello world",
        tags: []
      },
      {
        page: 1,
        pageTextEnd: 17,
        pageTextStart: 6,
        paperId: "paper-1",
        paperTitle: "Paper",
        snippet: "world again",
        summary: "world again",
        tags: []
      }
    ]);

    expect(pages[1]).toBe("hello world again");
  });

  test("falls back to the imported index before issuing an anchor search", async () => {
    const body = "Late interaction follows the token-level scoring design [1].";
    const references = "References\n[1] Khattab O, Zaharia M. ColBERT: Efficient and Effective Passage Search.";
    const index = await loadThinReadingAnchorReferenceIndex({
      anchors: [anchor],
      evidenceSpans: [{
        confidence: 0.9,
        id: "evidence-1",
        page: 1,
        pageTextEnd: body.length,
        pageTextStart: 0,
        paperId: "paper-1",
        quote: body
      }],
      importedChunks: [
        {
          page: 1,
          pageTextEnd: body.length,
          pageTextStart: 0,
          paperId: "paper-1",
          paperTitle: "Paper",
          snippet: body,
          summary: body,
          tags: []
        },
        {
          page: 2,
          pageTextEnd: references.length,
          pageTextStart: 0,
          paperId: "paper-1",
          paperTitle: "Paper",
          snippet: references,
          summary: references,
          tags: []
        }
      ],
      paperId: "paper-1"
    });

    expect(index.get("anchor-1")?.[0]?.text).toContain(
      "ColBERT: Efficient and Effective Passage Search"
    );
  });
});
