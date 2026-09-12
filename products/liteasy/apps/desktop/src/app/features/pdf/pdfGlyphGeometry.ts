import { OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PdfCharRect } from "./pdfSelectionEngine";

type FontMetrics = {
  ascent?: number;
  descent?: number;
  fontMatrix?: number[];
  isType3Font?: boolean;
  vertical?: boolean;
};

export type PdfGlyphGeometry = {
  text: string;
  rect: PdfCharRect;
};

type TextState = {
  transform: number[];
  matrix: number[];
  font: FontMetrics;
  size: number;
  direction: number;
  hScale: number;
  charSpacing: number;
  wordSpacing: number;
  leading: number;
  rise: number;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
};

const identity = () => [1, 0, 0, 1, 0, 0];

/**
 * Read text advances from the same decoded operators that PDF.js paints. TextLayer uses a
 * substitute font stretched to the width of an entire text item; measuring its DOM characters
 * therefore cannot reproduce the positions of the actual PDF glyphs (especially near word ends).
 * Geometry is optional: unsupported vertical/Type3 fonts keep the DOM measurement fallback.
 */
export function buildPdfGlyphGeometry(input: {
  operators: { fnArray: number[]; argsArray: unknown[][] };
  getFont: (name: string) => FontMetrics;
  viewport: { transform: number[]; width: number; height: number };
}): PdfGlyphGeometry[] {
  const glyphs: PdfGlyphGeometry[] = [];
  let state: TextState = {
    transform: identity(), matrix: identity(), font: {}, size: 0, direction: 1,
    hScale: 1, charSpacing: 0, wordSpacing: 0, leading: 0, rise: 0,
    x: 0, y: 0, lineX: 0, lineY: 0
  };
  const stack: TextState[] = [];
  const save = () => stack.push({ ...state });
  const restore = () => { state = stack.pop() ?? state; };
  const move = (x: number, y: number) => {
    state.x = state.lineX += x;
    state.y = state.lineY += y;
  };
  const font = (name: string, size: number) => {
    state.font = input.getFont(name);
    state.size = Math.abs(size);
    state.direction = size < 0 ? -1 : 1;
  };

  function show(items: unknown[]) {
    if (!Array.isArray(items)) return;
    const { size, direction, hScale } = state;
    const vertical = state.font.vertical;
    const supported = !vertical && !state.font.isType3Font && size > 0;
    const matrix = Util.transform(input.viewport.transform,
      Util.transform(state.transform, state.matrix));
    let advance = 0;
    for (const item of items) {
      if (typeof item === "number") {
        advance += (vertical ? 1 : -1) * item * size / 1000;
        continue;
      }
      const glyph = item as { unicode?: string; width?: number; isSpace?: boolean };
      if (!glyph || !Number.isFinite(glyph.width)) continue;
      const width = glyph.width! * size * (state.font.fontMatrix?.[0] ?? 0.001);
      if (supported && glyph.unicode && width > 0) {
        const left = state.x + advance * hScale * direction;
        const right = left + width * hScale * direction;
        const baseline = state.y + state.rise;
        const ascent = Number.isFinite(state.font.ascent) ? state.font.ascent! : 0.8;
        const descent = Number.isFinite(state.font.descent) ? state.font.descent! : -0.2;
        const bottom = baseline + descent * size * direction;
        const top = baseline + ascent * size * direction;
        const points = [[left, bottom], [left, top], [right, bottom], [right, top]]
          .map((point) => { Util.applyTransform(point, matrix); return point; });
        const xs = points.map((point) => point[0] / input.viewport.width * 100);
        const ys = points.map((point) => point[1] / input.viewport.height * 100);
        const rect = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
        if (Object.values(rect).every(Number.isFinite)) glyphs.push({ text: glyph.unicode, rect });
      }
      advance += width + state.direction * (state.charSpacing + (glyph.isSpace ? state.wordSpacing : 0));
    }
    if (vertical) state.y -= advance;
    else state.x += advance * hScale * direction;
  }

  input.operators.fnArray.forEach((op, index) => {
    const args = input.operators.argsArray[index] ?? [];
    // PDF.js has already decoded TJ into showText glyphs, including numeric kerning advances.
    switch (op) {
      case OPS.save: save(); break;
      case OPS.restore: restore(); break;
      case OPS.transform: state.transform = Util.transform(state.transform, args as number[]); break;
      case OPS.paintFormXObjectBegin:
        save();
        if (args[0]) state.transform = Util.transform(state.transform, args[0] as number[]);
        break;
      case OPS.paintFormXObjectEnd: restore(); break;
      case OPS.beginGroup: {
        save();
        const matrix = (args[0] as { matrix?: number[] }).matrix;
        if (matrix) state.transform = Util.transform(state.transform, matrix);
        break;
      }
      case OPS.endGroup: restore(); break;
      case OPS.beginText:
        state.matrix = identity();
        state.x = state.y = state.lineX = state.lineY = 0;
        break;
      case OPS.setFont: font(args[0] as string, args[1] as number); break;
      case OPS.setGState:
        for (const [key, value] of args[0] as [string, unknown][]) {
          if (key === "Font") font(...value as [string, number]);
        }
        break;
      case OPS.setCharSpacing: state.charSpacing = args[0] as number; break;
      case OPS.setWordSpacing: state.wordSpacing = args[0] as number; break;
      case OPS.setHScale: state.hScale = (args[0] as number) / 100; break;
      case OPS.setLeading: state.leading = -(args[0] as number); break;
      case OPS.setTextRise: state.rise = args[0] as number; break;
      case OPS.setTextMatrix:
        state.matrix = args[0] as number[];
        state.x = state.y = state.lineX = state.lineY = 0;
        break;
      case OPS.moveText: move(args[0] as number, args[1] as number); break;
      case OPS.setLeadingMoveText:
        state.leading = args[1] as number;
        move(args[0] as number, args[1] as number);
        break;
      case OPS.nextLine: move(0, state.leading); break;
      case OPS.showText: show(args[0] as unknown[]); break;
    }
  });
  return glyphs;
}

const pageGeometry = new WeakMap<PDFPageProxy, Promise<PdfGlyphGeometry[]>>();

export function loadPdfGlyphGeometry(page: PDFPageProxy) {
  if (typeof page.getOperatorList !== "function") return Promise.resolve([]);
  let geometry = pageGeometry.get(page);
  if (!geometry) {
    geometry = page.getOperatorList().then((operators) => buildPdfGlyphGeometry({
      operators,
      getFont: (name) => page.commonObjs.get(name),
      viewport: page.getViewport({ scale: 1 })
    })).catch(() => []);
    pageGeometry.set(page, geometry);
  }
  return geometry;
}

function units(text: string) {
  return Array.from(text.normalize("NFKC")).filter((unit) => !/\s/u.test(unit));
}

/** Match a complete text span before accepting its glyphs, so repeated letters and ligatures
 * cannot shift the endpoint to another occurrence. Preserve PDF.js's text order and Unicode. */
export function createPdfGlyphMatcher(glyphs: PdfGlyphGeometry[]) {
  const entries = glyphs.flatMap((glyph) => {
    const textUnits = units(glyph.text);
    return textUnits.map((text, index) => ({
      text, rect: glyph.rect, first: index === 0, last: index === textUnits.length - 1
    }));
  });
  const starts = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    if (!entry.first) return;
    const offsets = starts.get(entry.text) ?? [];
    offsets.push(index);
    starts.set(entry.text, offsets);
  });
  return (characters: { c: string; rect: PdfCharRect }[]): (PdfCharRect | null)[] | null => {
    const expected = characters.flatMap((char) => units(char.c));
    if (!expected.length) return null;
    const first = characters.find((char) => units(char.c).length)!;
    const last = [...characters].reverse().find((char) => units(char.c).length)!;
    let best: number | undefined;
    let bestDistance = Infinity;
    for (const start of starts.get(expected[0]) ?? []) {
      const end = start + expected.length - 1;
      if (end >= entries.length || !entries[end].last) continue;
      const a = entries[start].rect;
      const b = entries[end].rect;
      const distance = Math.hypot(a.left - first.rect.left, a.top - first.rect.top) +
        Math.hypot(b.right - last.rect.right, b.bottom - last.rect.bottom);
      // Require spatial agreement as well as exact text. Some operators belong to hidden forms
      // or use font geometry we cannot recover; their unrelated text must never replace a span.
      const tolerance = Math.max(0.3, (first.rect.bottom - first.rect.top) * 3);
      if (distance > tolerance || distance >= bestDistance) continue;
      if (!expected.every((text, offset) => entries[start + offset].text === text)) continue;
      best = start;
      bestDistance = distance;
    }
    if (best === undefined) return null;
    let offset = best;
    return characters.map((char) => {
      const length = units(char.c).length;
      if (!length) return null;
      const matched = entries.slice(offset, offset + length);
      offset += length;
      return {
        left: Math.min(...matched.map((entry) => entry.rect.left)),
        right: Math.max(...matched.map((entry) => entry.rect.right)),
        top: Math.min(...matched.map((entry) => entry.rect.top)),
        bottom: Math.max(...matched.map((entry) => entry.rect.bottom))
      };
    });
  };
}
