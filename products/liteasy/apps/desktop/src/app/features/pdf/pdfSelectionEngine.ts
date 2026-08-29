export type PdfSelectionPoint = readonly [number, number];
export type PdfSelectionRect = readonly [number, number, number, number];

export type StructuredPdfChar = {
  c: string;
  direction?: "ltr" | "rtl";
  ignorable?: boolean;
  inlineRect: PdfSelectionRect;
  lineBreakAfter?: boolean;
  pageIndex: number;
  paragraphBreakAfter?: boolean;
  rect: PdfSelectionRect;
  rotation?: number;
  spaceAfter?: boolean;
  u?: string;
  wordBreakAfter?: boolean;
};

export type PdfPageCharModel = {
  chars: StructuredPdfChar[];
  pageIndex: number;
  viewBox: PdfSelectionRect;
};

export type LogicalPdfSelection = {
  anchorOffset: number;
  headOffset: number;
  pageIndex: number;
};

export type ResolvedPdfSelection = LogicalPdfSelection & {
  rects: PdfSelectionRect[];
  text: string;
};

type LineSpan = {
  bottom: number;
  endExclusive: number;
  left: number;
  right: number;
  start: number;
  top: number;
};

function pointRectDistance(point: PdfSelectionPoint, rect: PdfSelectionRect) {
  const [x, y] = point;
  const dx = x < rect[0] ? rect[0] - x : x > rect[2] ? x - rect[2] : 0;
  const dy = y < rect[1] ? rect[1] - y : y > rect[3] ? y - rect[3] : 0;
  return Math.hypot(dx, dy);
}

function unionRect(left: PdfSelectionRect, right: PdfSelectionRect): PdfSelectionRect {
  return [
    Math.min(left[0], right[0]),
    Math.min(left[1], right[1]),
    Math.max(left[2], right[2]),
    Math.max(left[3], right[3])
  ];
}

function roundRect(rect: PdfSelectionRect): PdfSelectionRect {
  return rect.map((value) => Number(value.toFixed(6))) as unknown as PdfSelectionRect;
}

function buildLineSpans(chars: StructuredPdfChar[]): LineSpan[] {
  const lines: LineSpan[] = [];
  let start = 0;
  let bounds: PdfSelectionRect | null = null;

  for (let index = 0; index < chars.length; index += 1) {
    bounds = bounds ? unionRect(bounds, chars[index].inlineRect) : chars[index].inlineRect;
    if (chars[index].lineBreakAfter || index === chars.length - 1) {
      lines.push({
        bottom: bounds[3],
        endExclusive: index + 1,
        left: bounds[0],
        right: bounds[2],
        start,
        top: bounds[1]
      });
      start = index + 1;
      bounds = null;
    }
  }

  return lines;
}

function lineForOffset(lines: LineSpan[], offset: number) {
  if (lines.length === 0) return -1;
  // An insertion boundary shared by adjacent lines belongs to the line it just completed.
  // This keeps a head parked at line-end from oscillating to the next line on a 1px move.
  const containing = lines.findIndex((line) => offset > line.start && offset <= line.endExclusive);
  if (containing >= 0) return containing;
  if (offset <= 0) return 0;
  return lines.length - 1;
}

function closestLine(lines: LineSpan[], point: PdfSelectionPoint) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const distance = pointRectDistance(point, [line.left, line.top, line.right, line.bottom]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return { distance: bestDistance, index: bestIndex };
}

/** Returns a stable insertion boundary in [0, chars.length]. */
export function hitTestPdfCharOffset(input: {
  chars: StructuredPdfChar[];
  hysteresis?: number;
  point: PdfSelectionPoint;
  previousOffset?: number;
}) {
  const { chars, point } = input;
  if (chars.length === 0) return 0;

  const lines = buildLineSpans(chars);
  const closest = closestLine(lines, point);
  let lineIndex = closest.index;
  if (input.previousOffset !== undefined && input.hysteresis) {
    const previousLineIndex = lineForOffset(lines, input.previousOffset);
    if (previousLineIndex >= 0 && previousLineIndex !== lineIndex) {
      const previousLine = lines[previousLineIndex];
      const previousDistance = pointRectDistance(point, [
        previousLine.left,
        previousLine.top,
        previousLine.right,
        previousLine.bottom
      ]);
      if (previousDistance <= closest.distance + input.hysteresis) {
        lineIndex = previousLineIndex;
      }
    }
  }

  const line = lines[lineIndex];
  let bestIndex = line.start;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = line.start; index < line.endExclusive; index += 1) {
    const distance = pointRectDistance(point, chars[index].rect);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  const char = chars[bestIndex];
  const [x, y] = point;
  const [left, top, right, bottom] = char.rect;
  const rotation = ((char.rotation ?? 0) % 360 + 360) % 360;
  const after = rotation === 90
    ? y > (top + bottom) / 2
    : rotation === 180
      ? x < (left + right) / 2
      : rotation === 270
        ? y < (top + bottom) / 2
        : char.direction === "rtl"
          ? x < (left + right) / 2
          : x > (left + right) / 2;
  return Math.min(chars.length, bestIndex + (after ? 1 : 0));
}

export function buildPdfSelectionRects(chars: StructuredPdfChar[]) {
  const rects: PdfSelectionRect[] = [];
  let current: PdfSelectionRect | null = null;
  for (const char of chars) {
    current = current ? unionRect(current, char.inlineRect) : char.inlineRect;
    if (char.lineBreakAfter) {
      rects.push(roundRect(current));
      current = null;
    }
  }
  if (current) rects.push(roundRect(current));
  return rects;
}

export function buildPdfSelectionText(chars: StructuredPdfChar[]) {
  const output: string[] = [];
  for (const char of chars) {
    if (!char.ignorable) output.push(char.u ?? char.c);
    if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) output.push(" ");
  }
  return output.join("").replace(/\s+/g, " ").trim();
}

export function resolveLogicalPdfSelection(
  model: PdfPageCharModel,
  logical: LogicalPdfSelection
): ResolvedPdfSelection | null {
  if (logical.pageIndex !== model.pageIndex) return null;
  const from = Math.max(0, Math.min(logical.anchorOffset, logical.headOffset));
  const to = Math.min(model.chars.length, Math.max(logical.anchorOffset, logical.headOffset));
  if (from === to) return null;
  const selected = model.chars.slice(from, to);
  const text = buildPdfSelectionText(selected);
  const rects = buildPdfSelectionRects(selected);
  return text && rects.length > 0 ? { ...logical, rects, text } : null;
}

export function expandPdfOffsetToWord(chars: StructuredPdfChar[], offset: number) {
  if (chars.length === 0) return { end: 0, start: 0 };
  const index = Math.max(0, Math.min(chars.length - 1, offset === chars.length ? offset - 1 : offset));
  let start = index;
  let end = index + 1;
  while (start > 0 && !chars[start - 1].wordBreakAfter && !chars[start - 1].lineBreakAfter) start -= 1;
  while (end < chars.length && !chars[end - 1].wordBreakAfter && !chars[end - 1].lineBreakAfter) end += 1;
  return { end, start };
}

function graphemeSegments(value: string) {
  const output: Array<{ end: number; start: number; value: string }> = [];
  let start = 0;
  for (const valuePart of Array.from(value)) {
    const previous = output[output.length - 1];
    if (previous && (
      /^[\p{M}\uFE00-\uFE0F]$/u.test(valuePart) ||
      valuePart === "\u200d" ||
      previous.value.endsWith("\u200d")
    )) {
      previous.end += valuePart.length;
      previous.value += valuePart;
    } else {
      output.push({ end: start + valuePart.length, start, value: valuePart });
    }
    start += valuePart.length;
  }
  return output;
}

function isWordCharacter(value: string) {
  return /[\p{L}\p{M}\p{N}_'’-]/u.test(value);
}

function textElementRotation(element: HTMLElement | null) {
  if (!element) return 0;
  const customRotation = element.style.getPropertyValue("--rotate");
  const transformRotation = element.style.transform.match(/rotate\(\s*(-?[\d.]+)deg\s*\)/u)?.[1];
  const rotation = Number.parseFloat(customRotation || transformRotation || "0");
  return Number.isFinite(rotation) ? rotation : 0;
}

/**
 * Measures the rendered glyph boxes once. Pointer selection never asks the DOM to choose a range;
 * this bridge supplies exact browser-shaped glyph geometry when stock PDF.js has no char API.
 */
export function buildPdfPageCharModel(
  textLayer: HTMLElement,
  pageElement: HTMLElement,
  pageIndex: number
): PdfPageCharModel {
  const pageRect = pageElement.getBoundingClientRect();
  const originLeft = pageRect.left + pageElement.clientLeft;
  const originTop = pageRect.top + pageElement.clientTop;
  const width = pageElement.clientWidth || Math.max(1, pageRect.width - pageElement.clientLeft * 2);
  const height = pageElement.clientHeight || Math.max(1, pageRect.height - pageElement.clientTop * 2);
  const chars: StructuredPdfChar[] = [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const textNode = node as Text;
    const owner = textNode.parentElement;
    const value = textNode.nodeValue ?? "";
    if (value && !owner?.closest('[role="img"]')) {
      const direction = owner?.closest<HTMLElement>('[dir="rtl"]') ? "rtl" as const : "ltr" as const;
      const rotation = textElementRotation(owner);
      for (const segment of graphemeSegments(value)) {
        if (/^\s+$/u.test(segment.value)) {
          const previous = chars[chars.length - 1];
          if (previous) {
            previous.spaceAfter = true;
            previous.wordBreakAfter = true;
          }
          continue;
        }
        const range = document.createRange();
        range.setStart(textNode, segment.start);
        range.setEnd(textNode, segment.end);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0.25 && rect.height > 0.25) {
          const normalized: PdfSelectionRect = [
            (rect.left - originLeft) / width,
            (rect.top - originTop) / height,
            (rect.right - originLeft) / width,
            (rect.bottom - originTop) / height
          ];
          chars.push({
            c: segment.value,
            direction,
            inlineRect: normalized,
            pageIndex,
            rect: normalized,
            rotation,
            u: segment.value.normalize("NFKC")
          });
        }
      }
    }
    node = walker.nextNode();
  }

  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index];
    const next = chars[index + 1];
    if (!next) {
      current.lineBreakAfter = true;
      current.wordBreakAfter = true;
      continue;
    }
    const currentHeight = current.rect[3] - current.rect[1];
    const currentWidth = current.rect[2] - current.rect[0];
    const nextHeight = next.rect[3] - next.rect[1];
    const nextWidth = next.rect[2] - next.rect[0];
    const verticalText = [90, 270].includes(((current.rotation ?? 0) % 360 + 360) % 360);
    const crossAxisDelta = verticalText
      ? Math.abs((current.rect[0] + current.rect[2]) / 2 - (next.rect[0] + next.rect[2]) / 2)
      : Math.abs((current.rect[1] + current.rect[3]) / 2 - (next.rect[1] + next.rect[3]) / 2);
    const inlineGap = verticalText
      ? next.rect[1] - current.rect[3]
      : next.rect[0] - current.rect[2];
    const crossAxisSize = verticalText
      ? Math.max(currentWidth, nextWidth)
      : Math.max(currentHeight, nextHeight);
    const lineBreak = crossAxisDelta > crossAxisSize * 0.62 || inlineGap > crossAxisSize * 6;
    if (lineBreak) {
      current.lineBreakAfter = true;
      current.wordBreakAfter = true;
      continue;
    }
    const inlineSize = Math.max(0.0001, verticalText ? currentHeight : currentWidth);
    if (inlineGap > Math.min(inlineSize, crossAxisSize) * 0.45 ||
      isWordCharacter(current.c) !== isWordCharacter(next.c)) {
      current.wordBreakAfter = true;
      if (inlineGap > Math.min(inlineSize, crossAxisSize) * 0.45) current.spaceAfter = true;
    }
  }

  return { chars, pageIndex, viewBox: [0, 0, 1, 1] };
}
