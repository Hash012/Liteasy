import { expect, test } from "vitest";

import { fitPdfSelectionMenuPosition, resolvePdfSelectionMenuPosition } from "../app/features/pdf/pdfSelectionPosition";

test("centres the PDF selection menu above the real selection without guessing menu height", () => {
  expect(resolvePdfSelectionMenuPosition({
    contentWidth: 900,
    rect: { bottom: 440, left: 360, top: 420, width: 160 },
    scrollLeft: 20,
    scrollTop: 600,
    stageRect: { left: 100, top: 80 }
  })).toEqual({ left: 360, placement: "above", top: 940 });
});

test("places the menu below a selection near the top and keeps it inside the stage width", () => {
  expect(resolvePdfSelectionMenuPosition({
    contentWidth: 420,
    rect: { bottom: 126, left: 86, top: 106, width: 24 },
    scrollLeft: 0,
    scrollTop: 0,
    stageRect: { left: 80, top: 80 }
  })).toEqual({ left: 102, placement: "below", top: 46 });
});

test("keeps a measured menu within a narrow horizontally scrolled viewport", () => {
  expect(fitPdfSelectionMenuPosition({
    anchor: { left: 1200, top: 850, placement: "below" },
    menuWidth: 292, menuHeight: 170, viewportWidth: 260, viewportHeight: 300,
    scrollLeft: 400, scrollTop: 600
  })).toEqual({ left: 408, top: 722, maxHeight: 284 });
});

test("allows a tall menu to scroll while keeping its top and bottom accessible", () => {
  expect(fitPdfSelectionMenuPosition({
    anchor: { left: 250, top: 400, placement: "above" },
    menuWidth: 292, menuHeight: 500, viewportWidth: 600, viewportHeight: 200,
    scrollLeft: 0, scrollTop: 300
  })).toEqual({ left: 104, top: 308, maxHeight: 184 });
});
