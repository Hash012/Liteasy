import { expect, test } from "vitest";

import { resolvePdfSelectionMenuPosition } from "../app/features/pdf/pdfSelectionPosition";

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
