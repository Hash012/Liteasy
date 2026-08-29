import { expect, test } from "vitest";
import {
  buildPdfSelectionRects,
  expandPdfOffsetToWord,
  hitTestPdfCharOffset,
  resolveLogicalPdfSelection,
  type PdfPageCharModel,
  type StructuredPdfChar
} from "../app/features/pdf/pdfSelectionEngine";

function char(
  c: string,
  rect: readonly [number, number, number, number],
  options: Partial<StructuredPdfChar> = {}
): StructuredPdfChar {
  return { c, inlineRect: rect, pageIndex: 0, rect, ...options };
}

const twoLines = [
  char("a", [0.1, 0.1, 0.2, 0.14]),
  char("b", [0.2, 0.1, 0.3, 0.14], { lineBreakAfter: true, wordBreakAfter: true }),
  char("c", [0.1, 0.16, 0.2, 0.2]),
  char("d", [0.2, 0.16, 0.3, 0.2], { lineBreakAfter: true, wordBreakAfter: true })
];

test("hits exact insertion boundaries without consulting DOM selection", () => {
  expect(hitTestPdfCharOffset({ chars: twoLines, point: [0.11, 0.12] })).toBe(0);
  expect(hitTestPdfCharOffset({ chars: twoLines, point: [0.19, 0.12] })).toBe(1);
  expect(hitTestPdfCharOffset({ chars: twoLines, point: [0.29, 0.12] })).toBe(2);
});

test("keeps the previous visual line within the pointer hysteresis band", () => {
  const withoutHysteresis = hitTestPdfCharOffset({ chars: twoLines, point: [0.16, 0.151] });
  const stable = hitTestPdfCharOffset({
    chars: twoLines,
    hysteresis: 0.025,
    point: [0.16, 0.151],
    previousOffset: 1
  });
  expect(withoutHysteresis).toBe(3);
  expect(stable).toBe(1);
  expect(hitTestPdfCharOffset({
    chars: twoLines,
    hysteresis: 0.025,
    point: [0.16, 0.151],
    previousOffset: 2
  })).toBe(1);
});

test("resolves forward and reverse drags to the same exact text and rects", () => {
  const model: PdfPageCharModel = { chars: twoLines, pageIndex: 0, viewBox: [0, 0, 1, 1] };
  const forward = resolveLogicalPdfSelection(model, {
    anchorOffset: 1,
    headOffset: 4,
    pageIndex: 0
  });
  const reverse = resolveLogicalPdfSelection(model, {
    anchorOffset: 4,
    headOffset: 1,
    pageIndex: 0
  });
  expect(forward?.text).toBe("b cd");
  expect(reverse?.text).toBe(forward?.text);
  expect(reverse?.rects).toEqual(forward?.rects);
  expect(forward?.rects).toHaveLength(2);
});

test("does not merge same-height text across a column break", () => {
  const columnChars = [
    char("L", [0.08, 0.1, 0.12, 0.14], { lineBreakAfter: true }),
    char("R", [0.58, 0.1, 0.62, 0.14], { lineBreakAfter: true })
  ];
  expect(buildPdfSelectionRects(columnChars)).toEqual([
    [0.08, 0.1, 0.12, 0.14],
    [0.58, 0.1, 0.62, 0.14]
  ]);
});

test("logical offsets stay identical when page pixels scale", () => {
  const normalizedPoint = [0.24, 0.12] as const;
  const at75Percent = [normalizedPoint[0] * 570 / 570, normalizedPoint[1] * 735 / 735] as const;
  const at250Percent = [normalizedPoint[0] * 1900 / 1900, normalizedPoint[1] * 2450 / 2450] as const;
  expect(hitTestPdfCharOffset({ chars: twoLines, point: at75Percent })).toBe(1);
  expect(hitTestPdfCharOffset({ chars: twoLines, point: at250Percent })).toBe(1);
});

test("uses the inline axis for rotated character boundaries", () => {
  const rotated = [char("x", [0.2, 0.2, 0.24, 0.3], { rotation: 90 })];
  expect(hitTestPdfCharOffset({ chars: rotated, point: [0.22, 0.22] })).toBe(0);
  expect(hitTestPdfCharOffset({ chars: rotated, point: [0.22, 0.29] })).toBe(1);
});

test("expands double-click selection only to structured word boundaries", () => {
  const chars = [
    char("f", [0, 0, 0.1, 0.1]),
    char("i", [0.1, 0, 0.2, 0.1], { wordBreakAfter: true }),
    char("x", [0.3, 0, 0.4, 0.1], { lineBreakAfter: true, wordBreakAfter: true })
  ];
  expect(expandPdfOffsetToWord(chars, 1)).toEqual({ end: 2, start: 0 });
  expect(expandPdfOffsetToWord(chars, 2)).toEqual({ end: 3, start: 2 });
});

test("copies compatibility text for ligatures without changing logical offsets", () => {
  const ligature = char("ﬁ", [0, 0, 0.1, 0.1], { lineBreakAfter: true, u: "fi" });
  const model: PdfPageCharModel = { chars: [ligature], pageIndex: 0, viewBox: [0, 0, 1, 1] };
  expect(resolveLogicalPdfSelection(model, {
    anchorOffset: 0,
    headOffset: 1,
    pageIndex: 0
  })?.text).toBe("fi");
});
