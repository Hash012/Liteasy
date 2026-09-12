import { expect, test } from "vitest";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildPdfGlyphGeometry, createPdfGlyphMatcher } from "../app/features/pdf/pdfGlyphGeometry";

const font = { ascent: 0.8, descent: -0.2, fontMatrix: [0.001, 0, 0, 0.001, 0, 0] };
const glyph = (unicode: string, width = 500) => ({ unicode, width });
const viewport = { width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100] };

function geometry(ops: [number, unknown[]][]) {
  return buildPdfGlyphGeometry({
    getFont: () => font,
    operators: { fnArray: ops.map(([op]) => op), argsArray: ops.map(([, args]) => args) },
    viewport
  });
}

test("uses PDF glyph widths, Tc, Tw, TJ and horizontal scale instead of substitute-font widths", () => {
  const result = geometry([
    [OPS.beginText, []], [OPS.setFont, ["f", 10]], [OPS.setTextMatrix, [[1, 0, 0, 1, 10, 80]]],
    [OPS.setCharSpacing, [1]], [OPS.setWordSpacing, [2]], [OPS.setHScale, [50]],
    [OPS.showText, [[glyph("W", 900), -200, glyph("i", 200), { ...glyph(" ", 250), isSpace: true }, glyph("x")]]]
  ]);
  expect(result.map((item) => [item.text, Number(item.rect.left.toFixed(6)), Number(item.rect.right.toFixed(6))])).toEqual([
    ["W", 10, 14.5], ["i", 16, 17], [" ", 17.5, 18.75], ["x", 20.25, 22.75]
  ]);
  expect(result[0].rect.top).toBeCloseTo(12);
  expect(result[0].rect.bottom).toBeCloseTo(22);
});

test("restores text state after transformed forms and tracks line movement and text rise", () => {
  const result = geometry([
    [OPS.beginText, []], [OPS.setFont, ["f", 10]], [OPS.setTextMatrix, [[1, 0, 0, 1, 10, 80]]],
    [OPS.showText, [[glyph("A")]]],
    [OPS.paintFormXObjectBegin, [[2, 0, 0, 2, 20, 0], null]],
    [OPS.setTextMatrix, [[1, 0, 0, 1, 0, 20]]], [OPS.showText, [[glyph("B")]]],
    [OPS.paintFormXObjectEnd, []], [OPS.showText, [[glyph("C")]]],
    [OPS.setLeading, [12]], [OPS.nextLine, []], [OPS.setTextRise, [2]], [OPS.showText, [[glyph("D")]]]
  ]);
  expect(result.map((item) => [item.text, item.rect.left, item.rect.top])).toEqual([
    ["A", 10, 12], ["B", 20, 44], ["C", 15, 12], ["D", 10, 22]
  ]);
});

test("projects rotated PDF text and page rotation into the same normalized coordinate system", () => {
  const result = geometry([
    [OPS.beginText, []], [OPS.setFont, ["f", 10]], [OPS.setTextMatrix, [[0, 1, -1, 0, 40, 20]]],
    [OPS.showText, [[glyph("A"), glyph("B")]]]
  ]);
  expect(result.map((item) => item.rect)).toEqual([
    { left: 32, right: 42, top: 75, bottom: 80 },
    { left: 32, right: 42, top: 70, bottom: 75 }
  ]);
});

test("leaves unsupported font geometry to the text-layer fallback", () => {
  for (const unsupported of [{ vertical: true }, { isType3Font: true }]) {
    expect(buildPdfGlyphGeometry({
      getFont: () => ({ ...font, ...unsupported }),
      operators: { fnArray: [OPS.setFont, OPS.showText], argsArray: [["f", 10], [[glyph("A")]]] },
      viewport
    })).toEqual([]);
  }
});

test("matches a whole span spatially so repeated text in another column cannot change its endpoints", () => {
  const rect = (left: number) => ({ left, right: left + 1, top: 10, bottom: 12 });
  const match = createPdfGlyphMatcher([
    { text: "A", rect: rect(10) }, { text: "B", rect: rect(11) },
    { text: "A", rect: rect(60) }, { text: "B", rect: rect(61) }
  ]);
  expect(match([{ c: "A", rect: rect(60.1) }, { c: "B", rect: rect(61.2) }])).toEqual([rect(60), rect(61)]);
  expect(match([{ c: "A", rect: rect(60) }, { c: "C", rect: rect(61) }])).toBeNull();
  expect(match([{ c: "A", rect: rect(30) }, { c: "B", rect: rect(31) }])).toBeNull();
});

test("maps ligature Unicode expansion to one physical glyph without losing the following boundary", () => {
  const rect = { left: 10, right: 12, top: 10, bottom: 12 };
  const next = { ...rect, left: 12, right: 13 };
  const match = createPdfGlyphMatcher([{ text: "ﬁ", rect }, { text: "t", rect: next }]);
  expect(match([{ c: "f", rect }, { c: "i", rect }, { c: "t", rect: next }])).toEqual([rect, rect, next]);
});
