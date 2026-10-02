export type ReadingMarginAnchor = { id: string; x: number; y: number; height: number };

/** Pack only visible notes into the margin, keeping order and a gap between cards. */
export function layoutReadingMarginCards(anchors: readonly ReadingMarginAnchor[], top: number, bottom: number) {
  const sorted = [...anchors].sort((a, b) => a.y - b.y);
  const cards: (ReadingMarginAnchor & { top: number })[] = [];
  let used = 0;
  for (const anchor of sorted) {
    if (used + anchor.height > bottom - top) break;
    cards.push({ ...anchor, top: Math.max(top, anchor.y - 20, cards.length ? cards[cards.length - 1].top + cards[cards.length - 1].height + 8 : top) });
    used += anchor.height + 8;
  }
  let end = bottom;
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    cards[index].top = Math.min(cards[index].top, end - cards[index].height);
    end = cards[index].top - 8;
  }
  return cards;
}

/** Allocate separate gutter lanes only when vertical runs overlap. Text is never crossed vertically. */
export function routeReadingMarginConnectors(cards: ReturnType<typeof layoutReadingMarginCards>, pageEdge: number, railLeft: number) {
  const lanes: { start: number; end: number }[][] = [];
  return cards.map((card) => {
    const target = card.top + 20;
    const start = Math.min(card.y, target), end = Math.max(card.y, target);
    let lane = lanes.findIndex((runs) => runs.every((run) => end + 6 < run.start || start - 6 > run.end));
    if (lane < 0) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push({ start, end });
    // The number of visible cards is bounded by viewport height. Reserve enough
    // of the gutter for all of them, even after a resize or densely spaced marks.
    const step = Math.min(8, Math.max(1, (railLeft - pageEdge - 16) / Math.max(1, cards.length)));
    const bend = Math.max(card.x + 4, pageEdge + 8 + lane * step);
    return { id: card.id, bend, path: `M ${card.x} ${card.y} H ${bend} V ${target} H ${railLeft}` };
  });
}

export const readingMarginWidthLimits = { min: 200, max: 520, default: 260 };
export function clampReadingMarginWidth(width: number, available = Infinity) {
  return Math.max(readingMarginWidthLimits.min, Math.min(readingMarginWidthLimits.max, available - 380, Number.isFinite(width) ? Math.round(width) : readingMarginWidthLimits.default));
}
