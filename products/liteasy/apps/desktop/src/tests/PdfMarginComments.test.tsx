import { expect, test } from "vitest";
import { buildPdfMarginConnectorGeometry, layoutPdfMarginComments } from "../app/features/pdf/PdfMarginComments";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";

const annotation = (id: string, top: number): PdfAnnotationV2 => ({
  id, kind: "underline", excerpt: id, note: "A short comment", text: "", page: 1, revision: 1,
  createdAt: "2026-10-27", updatedAt: "2026-10-27", publication: { desiredVisibility: "private", state: "not_published" },
  rects: [{ left: 10, top, width: 20, height: 2 }, { left: 10, top: top + 3, width: 70, height: 2 }],
});
test("uses the first selected line, measured header and actual card heights even at page edges", () => {
  const items = [annotation("bottom", 96), annotation("next", 3), annotation("first", 2)];
  const dimensions = new Map([["first", { height: 100, anchorOffset: 18 }], ["next", { height: 130, anchorOffset: 18 }], ["bottom", { height: 120, anchorOffset: 18 }]]);
  const cards = layoutPdfMarginComments(items, 1000, dimensions);
  expect(cards.map(card => card.annotation.id)).toEqual(["first", "next", "bottom"]);
  expect(cards[0].anchorRect).toEqual(items[2].rects[0]);
  expect(cards[0].top + 18).toBe(40);
  expect(cards[1].top).toBe(cards[0].top + 108);
  expect(cards[2].top + cards[2].height).toBeGreaterThan(1000);
  const connector = buildPdfMarginConnectorGeometry({ anchorRect: cards[1].anchorRect, kind: "underline", pageWidth: 800, pageHeight: 1000, pageBorder: 1, commentTop: cards[1].top, commentAnchorOffset: 18 });
  expect(connector.top).toBe(50);
  expect(connector.path).toBe(`M 241 50 H 806 V ${cards[1].top + 18} H 810`);
});
