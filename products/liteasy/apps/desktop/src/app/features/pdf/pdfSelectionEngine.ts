import type { PdfAnnotationRect } from "./pdfAnnotationStorage";

export type PdfPoint = {
  x: number;
  y: number;
};

export type PdfCharRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type StructuredPdfChar = {
  c: string;
  ignorable?: boolean;
  inlineRect: PdfCharRect;
  lineBreakAfter?: boolean;
  pageIndex: number;
  paragraphBreakAfter?: boolean;
  rect: PdfCharRect;
  rotation?: number;
  sourceIndex?: number;
  spaceAfter?: boolean;
  u?: string;
  wordBreakAfter?: boolean;
};

export type PdfCharLine = {
  endExclusive: number;
  rect: PdfCharRect;
  start: number;
};

export type PageCharModel = {
  chars: StructuredPdfChar[];
  lines: PdfCharLine[];
  pageIndex: number;
  viewBox: readonly [number, number, number, number];
};

export type LogicalPdfSelection = {
  anchorOffset: number;
  headOffset: number;
  pageIndex: number;
};

export type PdfSelectionRange = LogicalPdfSelection & {
  endOffset: number;
  rects: PdfAnnotationRect[];
  startOffset: number;
  text: string;
};

export type PdfInsertionHit = {
  characterIndex: number;
  offset: number;
};

type MeasuredPdfChar = StructuredPdfChar & {
  sourceIndex: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function unionRect(left: PdfCharRect, right: PdfCharRect): PdfCharRect {
  return {
    bottom: Math.max(left.bottom, right.bottom),
    left: Math.min(left.left, right.left),
    right: Math.max(left.right, right.right),
    top: Math.min(left.top, right.top)
  };
}

function pointRectDistance(point: PdfPoint, rect: PdfCharRect) {
  const dx = point.x < rect.left
    ? rect.left - point.x
    : point.x > rect.right ? point.x - rect.right : 0;
  const dy = point.y < rect.top
    ? rect.top - point.y
    : point.y > rect.bottom ? point.y - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

function pointInlineCenterDistance(point: PdfPoint, character: StructuredPdfChar) {
  const rotation = ((character.rotation ?? 0) % 360 + 360) % 360;
  if ((rotation >= 45 && rotation < 135) || (rotation >= 225 && rotation < 315)) {
    return Math.abs(point.y - (character.rect.top + character.rect.bottom) / 2);
  }
  return Math.abs(point.x - (character.rect.left + character.rect.right) / 2);
}

function isBetterCharacterHit(input: {
  axisDistance: number;
  bestAxisDistance: number;
  bestDistance: number;
  distance: number;
}) {
  const epsilon = 0.0001;
  return input.distance < input.bestDistance - epsilon || (
    Math.abs(input.distance - input.bestDistance) <= epsilon &&
    input.axisDistance < input.bestAxisDistance
  );
}

function rectHeight(rect: PdfCharRect) {
  return Math.max(0, rect.bottom - rect.top);
}

function rectWidth(rect: PdfCharRect) {
  return Math.max(0, rect.right - rect.left);
}

function isSameVisualLine(left: StructuredPdfChar, right: StructuredPdfChar) {
  const leftRotation = ((left.rotation ?? 0) % 360 + 360) % 360;
  const rightRotation = ((right.rotation ?? 0) % 360 + 360) % 360;
  const bothVertical =
    ((leftRotation >= 45 && leftRotation < 135) || (leftRotation >= 225 && leftRotation < 315)) &&
    ((rightRotation >= 45 && rightRotation < 135) || (rightRotation >= 225 && rightRotation < 315));
  if (bothVertical) {
    const leftCenter = (left.rect.left + left.rect.right) / 2;
    const rightCenter = (right.rect.left + right.rect.right) / 2;
    const tolerance = Math.max(0.12, Math.max(rectWidth(left.rect), rectWidth(right.rect)) * 0.72);
    return Math.abs(leftCenter - rightCenter) <= tolerance;
  }
  const leftCenter = (left.rect.top + left.rect.bottom) / 2;
  const rightCenter = (right.rect.top + right.rect.bottom) / 2;
  const tolerance = Math.max(0.12, Math.max(rectHeight(left.rect), rectHeight(right.rect)) * 0.72);
  return Math.abs(leftCenter - rightCenter) <= tolerance;
}

export function buildPdfCharLines(chars: StructuredPdfChar[]): PdfCharLine[] {
  const lines: PdfCharLine[] = [];
  let start = 0;
  let rect: PdfCharRect | null = null;

  for (let index = 0; index < chars.length; index += 1) {
    rect = rect ? unionRect(rect, chars[index].inlineRect) : chars[index].inlineRect;
    if (chars[index].lineBreakAfter) {
      lines.push({ endExclusive: index + 1, rect, start });
      start = index + 1;
      rect = null;
    }
  }

  if (rect && start < chars.length) {
    lines.push({ endExclusive: chars.length, rect, start });
  }
  return lines;
}

/**
 * Resolves a pointer to a character insertion boundary. The nearest visual line is selected
 * before the nearest glyph, which prevents a two-column page from jumping to a nearby column.
 */
export function hitTestPdfInsertionOffset(
  model: PageCharModel,
  point: PdfPoint,
  previousOffset?: number,
  sourceIndex?: number
) {
  return hitTestPdfInsertion(model, point, {
    previousCharacterIndex: previousOffset === undefined
      ? undefined
      : clamp(previousOffset - 1, 0, Math.max(0, model.chars.length - 1)),
    sourceIndex
  }).offset;
}

export function hitTestPdfInsertion(
  model: PageCharModel,
  point: PdfPoint,
  options: {
    selectionAnchorOffset?: number;
    previousCharacterIndex?: number;
    sourceIndex?: number;
  } = {}
): PdfInsertionHit {
  if (model.chars.length === 0) return { characterIndex: 0, offset: 0 };

  // On pointerdown the browser already tells us which PDF.js text span received the event.
  // Prefer that span over a neighbouring column that happens to be only a few pixels away.
  // Pointer capture means this hint is intentionally used only for the initial endpoint.
  if (options.sourceIndex !== undefined) {
    let bestIndex = -1;
    let bestAxisDistance = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < model.chars.length; index += 1) {
      if (model.chars[index].sourceIndex !== options.sourceIndex) continue;
      const distance = pointRectDistance(point, model.chars[index].rect);
      const axisDistance = pointInlineCenterDistance(point, model.chars[index]);
      if (isBetterCharacterHit({ axisDistance, bestAxisDistance, bestDistance, distance })) {
        bestAxisDistance = axisDistance;
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      return {
        characterIndex: bestIndex,
        offset: insertionOffsetForCharacter(
          model.chars,
          bestIndex,
          point,
          options.selectionAnchorOffset
        )
      };
    }
  }

  const lines = model.lines.length > 0 ? model.lines : buildPdfCharLines(model.chars);
  let selectedLine = lines[0];
  let selectedLineDistance = pointRectDistance(point, selectedLine.rect);
  for (const line of lines.slice(1)) {
    const distance = pointRectDistance(point, line.rect);
    if (distance < selectedLineDistance) {
      selectedLine = line;
      selectedLineDistance = distance;
    }
  }

  if (options.previousCharacterIndex !== undefined) {
    const previousLine = lines.find((line) =>
      options.previousCharacterIndex! >= line.start &&
      options.previousCharacterIndex! < line.endExclusive
    );
    if (previousLine && previousLine !== selectedLine) {
      const previousDistance = pointRectDistance(point, previousLine.rect);
      const verticalOverlap = Math.max(
        0,
        Math.min(previousLine.rect.bottom, selectedLine.rect.bottom) -
          Math.max(previousLine.rect.top, selectedLine.rect.top)
      );
      const horizontalGap = Math.max(
        0,
        Math.max(previousLine.rect.left, selectedLine.rect.left) -
          Math.min(previousLine.rect.right, selectedLine.rect.right)
      );
      const neighbouringColumns = verticalOverlap >= Math.min(
        rectHeight(previousLine.rect),
        rectHeight(selectedLine.rect)
      ) * 0.5 && horizontalGap > 0;
      // A boundary before the first glyph in a column is also the numeric boundary after the
      // final glyph in the previous column. Keep the actual hit character as the affinity, and
      // require the pointer to enter the other column before switching to it.
      const hysteresis = neighbouringColumns
        ? Math.max(0.18, Math.min(3, horizontalGap * 0.65))
        : 0.18;
      if (previousDistance <= selectedLineDistance + hysteresis) {
        selectedLine = previousLine;
      }
    }
  }

  let bestIndex = selectedLine.start;
  let bestAxisDistance = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = selectedLine.start; index < selectedLine.endExclusive; index += 1) {
    const distance = pointRectDistance(point, model.chars[index].rect);
    const axisDistance = pointInlineCenterDistance(point, model.chars[index]);
    if (isBetterCharacterHit({ axisDistance, bestAxisDistance, bestDistance, distance })) {
      bestAxisDistance = axisDistance;
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return {
    characterIndex: bestIndex,
    offset: insertionOffsetForCharacter(
      model.chars,
      bestIndex,
      point,
      options.selectionAnchorOffset
    )
  };
}

function insertionOffsetForCharacter(
  chars: StructuredPdfChar[],
  index: number,
  point: PdfPoint,
  selectionAnchorOffset?: number
) {
  const character = chars[index];
  const rotation = ((character.rotation ?? 0) % 360 + 360) % 360;
  const forwardSelection = selectionAnchorOffset === undefined
    ? undefined
    : index >= selectionAnchorOffset;
  // A DOM Range glyph box often contains side bearings that extend beyond the visible ink.
  // Apply the smaller entry threshold only to an alphanumeric word ending during a forward
  // drag. Every other glyph, including punctuation and reverse-drag heads, keeps the exact
  // midpoint rule so a small overlap cannot pull in a preceding character.
  const tolerantWordEnd = forwardSelection === true &&
    character.wordBreakAfter === true &&
    /[\p{L}\p{N}]/u.test(character.c);
  const entryRatio = tolerantWordEnd ? 0.2 : 0.5;
  let after: boolean;
  if (rotation >= 45 && rotation < 135) {
    const threshold = forwardSelection === undefined
      ? (character.rect.top + character.rect.bottom) / 2
      : forwardSelection
        ? character.rect.top + rectHeight(character.rect) * entryRatio
        : character.rect.bottom - rectHeight(character.rect) * entryRatio;
    after = point.y > threshold;
  } else if (rotation >= 135 && rotation < 225) {
    const threshold = forwardSelection === undefined
      ? (character.rect.left + character.rect.right) / 2
      : forwardSelection
        ? character.rect.right - rectWidth(character.rect) * entryRatio
        : character.rect.left + rectWidth(character.rect) * entryRatio;
    after = point.x < threshold;
  } else if (rotation >= 225 && rotation < 315) {
    const threshold = forwardSelection === undefined
      ? (character.rect.top + character.rect.bottom) / 2
      : forwardSelection
        ? character.rect.bottom - rectHeight(character.rect) * entryRatio
        : character.rect.top + rectHeight(character.rect) * entryRatio;
    after = point.y < threshold;
  } else {
    const threshold = forwardSelection === undefined
      ? (character.rect.left + character.rect.right) / 2
      : forwardSelection
        ? character.rect.left + rectWidth(character.rect) * entryRatio
        : character.rect.right - rectWidth(character.rect) * entryRatio;
    after = point.x > threshold;
  }

  return clamp(index + (after ? 1 : 0), 0, chars.length);
}

export function buildPdfSelectionText(chars: StructuredPdfChar[]) {
  const text: string[] = [];
  for (const character of chars) {
    if (character.ignorable) continue;
    text.push(character.u ?? character.c);
    if (
      !/\s/u.test(character.c) &&
      (character.spaceAfter || character.lineBreakAfter || character.paragraphBreakAfter)
    ) {
      text.push(" ");
    }
  }
  return text.join("").replace(/\s+/gu, " ").trim();
}

export function buildPdfSelectionRects(chars: StructuredPdfChar[]): PdfAnnotationRect[] {
  const rects: PdfAnnotationRect[] = [];
  let current: PdfCharRect | null = null;

  function flush() {
    if (!current) return;
    const width = rectWidth(current);
    const height = rectHeight(current);
    if (width > 0 && height > 0) {
      rects.push({
        height: round(height),
        left: round(current.left),
        top: round(current.top),
        width: round(width)
      });
    }
    current = null;
  }

  for (const character of chars) {
    current = current ? unionRect(current, character.inlineRect) : character.inlineRect;
    if (character.lineBreakAfter) flush();
  }
  flush();
  return consolidateSelectionRects(rects);
}

function consolidateSelectionRects(rects: PdfAnnotationRect[]) {
  const consolidated: PdfAnnotationRect[] = [];
  for (const rect of rects) {
    const rectRight = rect.left + rect.width;
    const rectBottom = rect.top + rect.height;
    const match = consolidated.find((candidate) => {
      const candidateRight = candidate.left + candidate.width;
      const candidateBottom = candidate.top + candidate.height;
      const verticalOverlap = Math.max(
        0,
        Math.min(rectBottom, candidateBottom) - Math.max(rect.top, candidate.top)
      );
      const horizontalOverlap = Math.max(
        0,
        Math.min(rectRight, candidateRight) - Math.max(rect.left, candidate.left)
      );
      return verticalOverlap >= Math.min(rect.height, candidate.height) * 0.72 &&
        horizontalOverlap > 0;
    });
    if (!match) {
      consolidated.push({ ...rect });
      continue;
    }
    const left = Math.min(match.left, rect.left);
    const top = Math.min(match.top, rect.top);
    const right = Math.max(match.left + match.width, rectRight);
    const bottom = Math.max(match.top + match.height, rectBottom);
    match.height = round(bottom - top);
    match.left = round(left);
    match.top = round(top);
    match.width = round(right - left);
  }
  return consolidated;
}

export function buildPdfSelectionRange(
  model: PageCharModel,
  selection: LogicalPdfSelection
): PdfSelectionRange {
  const anchorOffset = clamp(selection.anchorOffset, 0, model.chars.length);
  const headOffset = clamp(selection.headOffset, 0, model.chars.length);
  const startOffset = Math.min(anchorOffset, headOffset);
  const endOffset = Math.max(anchorOffset, headOffset);
  const chars = model.chars.slice(startOffset, endOffset);
  return {
    anchorOffset,
    endOffset,
    headOffset,
    pageIndex: model.pageIndex,
    rects: buildPdfSelectionRects(chars),
    startOffset,
    text: buildPdfSelectionText(chars)
  };
}

function normalizeClientRect(rect: DOMRect, pageRect: DOMRect): PdfCharRect | null {
  if (pageRect.width <= 0 || pageRect.height <= 0) return null;
  const left = clamp(((rect.left - pageRect.left) / pageRect.width) * 100, 0, 100);
  const right = clamp(((rect.right - pageRect.left) / pageRect.width) * 100, 0, 100);
  const top = clamp(((rect.top - pageRect.top) / pageRect.height) * 100, 0, 100);
  const bottom = clamp(((rect.bottom - pageRect.top) / pageRect.height) * 100, 0, 100);
  if (right <= left || bottom <= top) return null;
  return { bottom, left, right, top };
}

function fallbackCharacterRect(
  node: Text,
  startOffset: number,
  endOffset: number,
  pageRect: DOMRect
) {
  const parentRect = node.parentElement?.getBoundingClientRect();
  if (!parentRect || parentRect.width <= 0 || parentRect.height <= 0) return null;
  const length = Math.max(1, node.data.length);
  const leftRatio = startOffset / length;
  const rightRatio = endOffset / length;
  return normalizeClientRect({
    bottom: parentRect.bottom,
    height: parentRect.height,
    left: parentRect.left + parentRect.width * leftRatio,
    right: parentRect.left + parentRect.width * rightRatio,
    top: parentRect.top,
    width: parentRect.width * (rightRatio - leftRatio),
    x: parentRect.left + parentRect.width * leftRatio,
    y: parentRect.top,
    toJSON: () => ({})
  } as DOMRect, pageRect);
}

function nodeRotation(node: Text) {
  const element = node.parentElement;
  if (!element || typeof window.getComputedStyle !== "function") return 0;
  const value = window.getComputedStyle(element).getPropertyValue("--rotate");
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function segmentGraphemes(value: string) {
  type Segment = { index: number; segment: string };
  type Segmenter = new (
    locales?: string | string[],
    options?: { granularity: "grapheme" }
  ) => { segment: (input: string) => Iterable<Segment> };
  const SegmenterConstructor = (Intl as typeof Intl & { Segmenter?: Segmenter }).Segmenter;
  if (SegmenterConstructor) {
    return Array.from(new SegmenterConstructor(undefined, { granularity: "grapheme" }).segment(value));
  }
  const segments: Segment[] = [];
  let index = 0;
  for (const segment of Array.from(value)) {
    segments.push({ index, segment });
    index += segment.length;
  }
  return segments;
}

/**
 * Builds stable per-character geometry once, after PDF.js has rendered its text layer. DOM Range
 * is used only as a glyph measurement bridge here; live pointer selection never reads browser
 * Selection or Range state.
 */
export function buildPageCharModelFromTextLayer(input: {
  pageElement: HTMLElement;
  pageIndex: number;
  textLayer: HTMLElement;
}): PageCharModel {
  const textLayerRect = input.textLayer.getBoundingClientRect();
  const pageRect = textLayerRect.width > 0 && textLayerRect.height > 0
    ? textLayerRect
    : input.pageElement.getBoundingClientRect();
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(input.textLayer, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (
      node.nodeType === Node.TEXT_NODE &&
      node.textContent &&
      !node.parentElement?.closest('[role="img"]')
    ) {
      nodes.push(node as Text);
    }
    node = walker.nextNode();
  }

  const measured: MeasuredPdfChar[] = [];
  const measuredGeometry = new Set<string>();
  nodes.forEach((textNode, sourceIndex) => {
    if (textNode.parentElement) {
      textNode.parentElement.dataset.pdfSourceIndex = String(sourceIndex);
    }
    const rotation = nodeRotation(textNode);
    const value = textNode.data;
    for (const { index: startOffset, segment: character } of segmentGraphemes(value)) {
      const endOffset = startOffset + character.length;
      const range = document.createRange();
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);
      const clientRects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0
      );
      const clientRect = clientRects.length > 0
        ? clientRects.reduce<DOMRect>((current, item) => ({
            bottom: Math.max(current.bottom, item.bottom),
            height: Math.max(current.bottom, item.bottom) - Math.min(current.top, item.top),
            left: Math.min(current.left, item.left),
            right: Math.max(current.right, item.right),
            top: Math.min(current.top, item.top),
            width: Math.max(current.right, item.right) - Math.min(current.left, item.left),
            x: Math.min(current.left, item.left),
            y: Math.min(current.top, item.top),
            toJSON: () => ({})
          } as DOMRect), clientRects[0])
        : range.getBoundingClientRect();
      const rect = normalizeClientRect(clientRect, pageRect) ??
        fallbackCharacterRect(textNode, startOffset, endOffset, pageRect);
      if (rect) {
        // Some PDFs paint an accessibility/OCR copy directly on top of the visible glyphs.
        // Keeping both copies produces two preview rectangles and makes the overlap look
        // selected twice. Zotero receives an `isolated` flag from processed page data; the
        // stock PDF.js text layer has no equivalent, so collapse only geometry-identical glyphs.
        const geometryKey = [
          character.normalize("NFKC"),
          rotation,
          Math.round(rect.left * 100),
          Math.round(rect.top * 100),
          Math.round(rect.right * 100),
          Math.round(rect.bottom * 100)
        ].join("|");
        if (measuredGeometry.has(geometryKey)) continue;
        measuredGeometry.add(geometryKey);
        measured.push({
          c: character,
          ignorable: character === "\u00ad",
          inlineRect: rect,
          pageIndex: input.pageIndex,
          rect,
          rotation,
          sourceIndex
        });
      }
    }
  });

  for (let index = 0; index < measured.length; index += 1) {
    const current = measured[index];
    const next = measured[index + 1];
    if (!next) {
      current.lineBreakAfter = true;
      current.wordBreakAfter = /[\p{L}\p{N}]/u.test(current.c);
      continue;
    }
    const gap = next.rect.left - current.rect.right;
    const sourceChanged = current.sourceIndex !== next.sourceIndex;
    const sameAxis = isSameVisualLine(current, next);
    const columnGap = Math.max(4, Math.max(rectHeight(current.rect), rectHeight(next.rect)) * 4);
    const separatedColumn = sourceChanged && (
      gap > columnGap || next.rect.right < current.rect.left - columnGap
    );
    const sameLine = sameAxis && !separatedColumn;
    current.lineBreakAfter = !sameLine;
    const gapThreshold = Math.max(0.08, Math.min(rectHeight(current.rect), rectHeight(next.rect)) * 0.14);
    current.spaceAfter = sameLine && sourceChanged && gap > gapThreshold;
    current.wordBreakAfter = /[\p{L}\p{N}]/u.test(current.c) &&
      (!/[\p{L}\p{N}]/u.test(next.c) || current.spaceAfter || current.lineBreakAfter);
  }

  const chars = measured.map((character) => ({ ...character }));
  return {
    chars,
    lines: buildPdfCharLines(chars),
    pageIndex: input.pageIndex,
    viewBox: [0, 0, 100, 100]
  };
}

export function clientPointToPdfPoint(pageElement: HTMLElement, clientX: number, clientY: number) {
  const textLayerRect = pageElement.querySelector<HTMLElement>(".pdf-text-layer")?.getBoundingClientRect();
  const rect = textLayerRect && textLayerRect.width > 0 && textLayerRect.height > 0
    ? textLayerRect
    : pageElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100
  };
}
