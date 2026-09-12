import { expect, test, vi } from "vitest";

import { sortPdfAnnotationsByReadingOrder } from "../app/features/pdf/pdfAnnotationReadingOrder";
import {
  buildPageCharModelFromTextLayer,
  buildPdfCharLines,
  buildPdfSelectionRange,
  hitTestPdfInsertion,
  hitTestPdfInsertionOffset,
  type PageCharModel,
  type StructuredPdfChar
} from "../app/features/pdf/pdfSelectionEngine";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";

function character(
  c: string,
  left: number,
  top: number,
  options: Partial<StructuredPdfChar> = {}
): StructuredPdfChar {
  const rect = { bottom: top + 2, left, right: left + 1, top };
  return {
    c,
    inlineRect: rect,
    pageIndex: 1,
    rect,
    ...options
  };
}

function model(chars: StructuredPdfChar[]): PageCharModel {
  return {
    chars,
    lines: buildPdfCharLines(chars),
    pageIndex: 1,
    viewBox: [0, 0, 100, 100]
  };
}

test("keeps pointer selection inside the exact anchor and head character boundaries", () => {
  const page = model([
    character("A", 10, 10),
    character("B", 11, 10),
    character("C", 12, 10, { lineBreakAfter: true })
  ]);

  const anchorOffset = hitTestPdfInsertionOffset(page, { x: 10.1, y: 11 });
  const headOffset = hitTestPdfInsertionOffset(page, { x: 12.9, y: 11 }, anchorOffset);
  const selection = buildPdfSelectionRange(page, { anchorOffset, headOffset, pageIndex: 1 });

  expect({ anchorOffset, headOffset }).toEqual({ anchorOffset: 0, headOffset: 3 });
  expect(selection.text).toBe("ABC");
  expect(selection.rects).toEqual([{ height: 2, left: 10, top: 10, width: 3 }]);
});

test("does not expand a word ending before the drag crosses its midpoint", () => {
  const page = model([
    character("A", 10, 10),
    character("B", 11, 10),
    character("C", 12, 10, { wordBreakAfter: true }),
    character("D", 14, 10, { lineBreakAfter: true })
  ]);

  const trailingHit = hitTestPdfInsertion(page, { x: 12.25, y: 11 }, {
    previousCharacterIndex: 1,
    selectionAnchorOffset: 0
  });
  const nextWordEdge = hitTestPdfInsertion(page, { x: 14.05, y: 11 }, {
    previousCharacterIndex: trailingHit.characterIndex,
    selectionAnchorOffset: 0
  });

  expect(trailingHit.offset).toBe(2);
  expect(nextWordEdge.offset).toBe(3);
  expect(buildPdfSelectionRange(page, {
    anchorOffset: 0,
    headOffset: nextWordEdge.offset,
    pageIndex: 1
  }).text).toBe("ABC");
});

test("keeps the midpoint threshold when a reverse drag touches a preceding glyph", () => {
  const page = model([
    character("A", 10, 10),
    character("B", 11, 10),
    character("C", 12, 10, { lineBreakAfter: true })
  ]);

  expect(hitTestPdfInsertion(page, { x: 11.75, y: 11 }, {
    previousCharacterIndex: 2,
    selectionAnchorOffset: 3
  }).offset).toBe(2);
  expect(hitTestPdfInsertion(page, { x: 11.45, y: 11 }, {
    previousCharacterIndex: 2,
    selectionAnchorOffset: 3
  }).offset).toBe(1);
});

test("chooses the closest glyph center when adjacent character boxes overlap", () => {
  const page = model([
    character("(", 10, 10, {
      rect: { bottom: 12, left: 10, right: 11.7, top: 10 }
    }),
    character("A", 11, 10, { lineBreakAfter: true })
  ]);

  const hit = hitTestPdfInsertion(page, { x: 11.45, y: 11 });

  expect(hit.characterIndex).toBe(1);
  expect(hit.offset).toBe(1);
});

test("preserves reverse drag direction while producing the same selected text and geometry", () => {
  const page = model([
    character("A", 10, 10),
    character("B", 11, 10),
    character("C", 12, 10, { lineBreakAfter: true })
  ]);
  const selection = buildPdfSelectionRange(page, {
    anchorOffset: 3,
    headOffset: 1,
    pageIndex: 1
  });

  expect(selection.anchorOffset).toBe(3);
  expect(selection.headOffset).toBe(1);
  expect(selection.text).toBe("BC");
  expect(selection.rects).toEqual([{ height: 2, left: 11, top: 10, width: 2 }]);
});

test("merges glyphs by visual line without creating one tall annotation rectangle", () => {
  const page = model([
    character("A", 10, 10),
    character("B", 11, 10, { lineBreakAfter: true, spaceAfter: true }),
    character("C", 10, 14),
    character("D", 11, 14, { lineBreakAfter: true })
  ]);
  const selection = buildPdfSelectionRange(page, {
    anchorOffset: 0,
    headOffset: 4,
    pageIndex: 1
  });

  expect(selection.text).toBe("AB CD");
  expect(selection.rects).toEqual([
    { height: 2, left: 10, top: 10, width: 2 },
    { height: 2, left: 10, top: 14, width: 2 }
  ]);
});

test("uses the nearest visual line before glyph distance on a two-column page", () => {
  const page = model([
    character("L", 10, 10, { lineBreakAfter: true }),
    character("R", 70, 10, { lineBreakAfter: true })
  ]);

  expect(hitTestPdfInsertionOffset(page, { x: 70.9, y: 11 })).toBe(2);
  expect(hitTestPdfInsertionOffset(page, { x: 10.1, y: 11 })).toBe(0);
});

test("keeps the hit-character affinity at an ambiguous boundary between columns", () => {
  const page = model([
    character("L", 42, 20),
    character("E", 43, 20),
    character("F", 44, 20, { lineBreakAfter: true, sourceIndex: 10 }),
    character("c", 50, 20, { lineBreakAfter: true, sourceIndex: 20 })
  ]);
  const anchor = hitTestPdfInsertion(page, { x: 50.1, y: 21 }, { sourceIndex: 20 });
  const inColumnGap = hitTestPdfInsertion(page, { x: 47.2, y: 21 }, {
    previousCharacterIndex: anchor.characterIndex
  });

  expect(anchor).toEqual({ characterIndex: 3, offset: 3 });
  expect(inColumnGap.characterIndex).toBe(3);
  expect(inColumnGap.offset).toBe(3);
});

test("logical offsets stay invariant when page CSS geometry is scaled", () => {
  const small = model([
    character("A", 10, 10),
    character("B", 11, 10, { lineBreakAfter: true })
  ]);
  const large = model(small.chars.map((item) => ({
    ...item,
    inlineRect: { ...item.inlineRect },
    rect: { ...item.rect }
  })));

  expect(hitTestPdfInsertionOffset(small, { x: 11.8, y: 11 })).toBe(2);
  expect(hitTestPdfInsertionOffset(large, { x: 11.8, y: 11 })).toBe(2);
});

test("keeps ligatures and combining accents as stable grapheme characters", () => {
  const pageElement = document.createElement("article");
  const textLayer = document.createElement("div");
  const span = document.createElement("span");
  span.textContent = "ﬁ e\u0301";
  textLayer.append(span);
  pageElement.append(textLayer);
  document.body.append(pageElement);
  const pageRect = {
    bottom: 100,
    height: 100,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect;
  vi.spyOn(pageElement, "getBoundingClientRect").mockReturnValue(pageRect);
  vi.spyOn(textLayer, "getBoundingClientRect").mockReturnValue(pageRect);
  vi.spyOn(span, "getBoundingClientRect").mockReturnValue(pageRect);
  const createRange = vi.spyOn(document, "createRange").mockImplementation(() => ({
    getBoundingClientRect: () => ({ ...pageRect, bottom: 0, height: 0, right: 0, width: 0 }),
    getClientRects: () => [],
    setEnd: () => undefined,
    setStart: () => undefined
  }) as unknown as Range);

  const page = buildPageCharModelFromTextLayer({ pageElement, pageIndex: 1, textLayer });

  expect(page.chars.map((item) => item.c)).toEqual(["ﬁ", " ", "e\u0301"]);
  createRange.mockRestore();
  pageElement.remove();
});

test("collapses geometry-identical text-layer glyph copies", () => {
  const pageElement = document.createElement("article");
  const textLayer = document.createElement("div");
  const first = document.createElement("span");
  const duplicate = document.createElement("span");
  first.textContent = "A";
  duplicate.textContent = "A";
  textLayer.append(first, duplicate);
  pageElement.append(textLayer);
  document.body.append(pageElement);
  const pageRect = {
    bottom: 100,
    height: 100,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect;
  vi.spyOn(pageElement, "getBoundingClientRect").mockReturnValue(pageRect);
  vi.spyOn(textLayer, "getBoundingClientRect").mockReturnValue(pageRect);
  vi.spyOn(first, "getBoundingClientRect").mockReturnValue(pageRect);
  vi.spyOn(duplicate, "getBoundingClientRect").mockReturnValue(pageRect);
  const createRange = vi.spyOn(document, "createRange").mockImplementation(() => ({
    getBoundingClientRect: () => ({ ...pageRect, bottom: 0, height: 0, right: 0, width: 0 }),
    getClientRects: () => [],
    setEnd: () => undefined,
    setStart: () => undefined
  }) as unknown as Range);

  const page = buildPageCharModelFromTextLayer({ pageElement, pageIndex: 1, textLayer });

  expect(page.chars).toHaveLength(1);
  expect(first).toHaveAttribute("data-pdf-source-index", "0");
  expect(duplicate).toHaveAttribute("data-pdf-source-index", "1");
  createRange.mockRestore();
  pageElement.remove();
});

test("uses the character rotation when choosing the before or after insertion boundary", () => {
  const page = model([
    character("V", 10, 10, { lineBreakAfter: true, rotation: 90 })
  ]);

  expect(hitTestPdfInsertionOffset(page, { x: 10.5, y: 10.1 })).toBe(0);
  expect(hitTestPdfInsertionOffset(page, { x: 10.5, y: 11.9 })).toBe(1);
});

test("replaces substitute-font advances and keeps ligature text with its single painted glyph", () => {
  const pageElement = document.createElement("article");
  const textLayer = document.createElement("div");
  const span = document.createElement("span");
  span.textContent = "WWi";
  textLayer.append(span);
  pageElement.append(textLayer);
  document.body.append(pageElement);
  const pageRect = new DOMRect(0, 0, 100, 100);
  vi.spyOn(textLayer, "getBoundingClientRect").mockReturnValue(pageRect);
  const createRange = vi.spyOn(document, "createRange").mockImplementation(() => {
    let start = 0;
    let end = 0;
    return {
      setStart: (_node: Node, offset: number) => { start = offset; },
      setEnd: (_node: Node, offset: number) => { end = offset; },
      getClientRects: () => [new DOMRect(10 + start * 7 / 3, 10, (end - start) * 7 / 3, 2)]
    } as unknown as Range;
  });
  try {
    const rect = (left: number, right: number) => ({ left, right, top: 10, bottom: 12 });
    const fallback = buildPageCharModelFromTextLayer({ pageElement, pageIndex: 1, textLayer });
    const native = buildPageCharModelFromTextLayer({
      pageElement, pageIndex: 1, textLayer,
      glyphs: [{ text: "W", rect: rect(10, 13) }, { text: "W", rect: rect(13, 16) }, { text: "i", rect: rect(16, 17) }]
    });
    // At x=14 the substitute font has already crossed the second W's midpoint. The PDF has not.
    expect(hitTestPdfInsertionOffset(fallback, { x: 14, y: 11 })).toBe(2);
    expect(hitTestPdfInsertionOffset(native, { x: 14, y: 11 })).toBe(1);
    expect(buildPdfSelectionRange(native, { anchorOffset: 0, headOffset: 1, pageIndex: 1 })).toMatchObject({
      text: "W", rects: [{ left: 10, top: 10, width: 3, height: 2 }]
    });

    span.textContent = "fit";
    const ligature = buildPageCharModelFromTextLayer({
      pageElement, pageIndex: 1, textLayer,
      glyphs: [{ text: "ﬁ", rect: rect(10, 15) }, { text: "t", rect: rect(15, 17) }]
    });
    expect(ligature.chars.map((char) => char.c)).toEqual(["fi", "t"]);
    expect(buildPdfSelectionRange(ligature, { anchorOffset: 0, headOffset: 1, pageIndex: 1 })).toMatchObject({
      text: "fi", rects: [{ left: 10, top: 10, width: 5, height: 2 }]
    });
  } finally {
    createRange.mockRestore();
    pageElement.remove();
  }
});

function annotation(input: {
  createdAt: string;
  id: string;
  left: number;
  normalizedStart?: number;
  page?: number;
  top: number;
}): PdfAnnotationV2 {
  return {
    createdAt: input.createdAt,
    excerpt: input.id,
    id: input.id,
    kind: "highlight",
    normalizedStart: input.normalizedStart,
    page: input.page ?? 1,
    paperIdentity: resolvePaperIdentity({ id: "paper", title: "Paper" }),
    publication: { desiredVisibility: "private", state: "not_published" },
    rects: [{ height: 2, left: input.left, top: input.top, width: 20 }],
    revision: 1,
    text: "高亮",
    updatedAt: input.createdAt
  };
}

test("orders annotation entries by paper reading position instead of creation time", () => {
  const laterCreatedEarlierText = annotation({
    createdAt: "2026-08-30T12:00:00.000Z",
    id: "earlier-text",
    left: 60,
    normalizedStart: 10,
    top: 20
  });
  const earlierCreatedLaterText = annotation({
    createdAt: "2026-08-30T10:00:00.000Z",
    id: "later-text",
    left: 10,
    normalizedStart: 90,
    top: 70
  });

  expect(sortPdfAnnotationsByReadingOrder([
    earlierCreatedLaterText,
    laterCreatedEarlierText
  ]).map((item) => item.id)).toEqual(["earlier-text", "later-text"]);
});

test("keeps legacy two-column annotations in left-column-then-right-column order", () => {
  const rightColumnTop = annotation({
    createdAt: "2026-08-30T10:00:00.000Z",
    id: "right-column",
    left: 62,
    top: 10
  });
  const leftColumnBottom = annotation({
    createdAt: "2026-08-30T12:00:00.000Z",
    id: "left-column",
    left: 10,
    top: 75
  });

  expect(sortPdfAnnotationsByReadingOrder([
    rightColumnTop,
    leftColumnBottom
  ]).map((item) => item.id)).toEqual(["left-column", "right-column"]);
});
