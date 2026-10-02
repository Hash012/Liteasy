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

test("routes overlapping vertical connectors through separate right-angle gutter lanes", async () => {
  const { routeReadingMarginConnectors } = await import("../app/features/paper-reading/readingMarginLayout");
  const cards = [
    { id: "a", x: 180, y: 50, height: 80, top: 130 },
    { id: "b", x: 270, y: 60, height: 80, top: 218 },
    { id: "c", x: 250, y: 400, height: 80, top: 480 },
  ];
  const routes = routeReadingMarginConnectors(cards, 300, 356);
  expect(routes.map((route) => route.bend)).toEqual([308,316,308]);
  expect(routes[0].path).toBe("M 180 50 H 308 V 150 H 356");
  expect(routes.every((route) => route.bend > 300 && route.bend < 356)).toBe(true);
});

test("limits the annotation rail to the available space while retaining a readable body", async () => {
  const { clampReadingMarginWidth } = await import("../app/features/paper-reading/readingMarginLayout");
  expect(clampReadingMarginWidth(500, 700)).toBe(320);
  expect(clampReadingMarginWidth(-50)).toBe(200);
  expect(clampReadingMarginWidth(NaN)).toBe(260);
});
