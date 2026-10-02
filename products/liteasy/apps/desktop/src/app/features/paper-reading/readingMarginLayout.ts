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
