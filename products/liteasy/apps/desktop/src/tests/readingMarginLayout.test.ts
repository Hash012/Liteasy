import { expect, test } from "vitest";
import { layoutReadingMarginCards } from "../app/features/paper-reading/readingMarginLayout";

test("nearby margin notes remain ordered, separated and inside the visible reading area", () => {
  const cards = layoutReadingMarginCards([
    { id: "third", x: 200, y: 450, height: 100 },
    { id: "first", x: 250, y: 440, height: 120 },
    { id: "second", x: 230, y: 445, height: 160 },
  ], 12, 500);
  expect(cards.map((card) => card.id)).toEqual(["first", "second", "third"]);
  expect(cards[0].top).toBeGreaterThanOrEqual(12);
  expect(cards[1].top).toBeGreaterThanOrEqual(cards[0].top + cards[0].height + 8);
  expect(cards[2].top).toBeGreaterThanOrEqual(cards[1].top + cards[1].height + 8);
  expect(cards[2].top + cards[2].height).toBeLessThanOrEqual(500);
});

test("crowded or small viewports never place overflow cards over other notes or controls", () => {
  const anchors = Array.from({ length: 50 }, (_, i) => ({ id: String(i), x: 100, y: 20 + i, height: 120 }));
  expect(layoutReadingMarginCards(anchors, 8, 300)).toHaveLength(2);
  expect(layoutReadingMarginCards(anchors, 8, 100)).toEqual([]);
});
