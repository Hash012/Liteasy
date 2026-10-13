import { expect, test } from "vitest";
import { exportPreviewGeometry } from "../app/features/document-export/exportPreviewGeometry";
import { MAX_PDF_CANVAS_PIXELS } from "../app/features/pdf/pdfRenderBudget";
for (const dpr of [1, 1.25, 1.5, 2]) test(`actual-size geometry owns CSS and backing pixels at DPR ${dpr}`, () => {
  const result = exportPreviewGeometry({ width: 600, height: 800, availableWidth: 900, availableHeight: 700, dpr, mode: "actual-size", zoom: 100 })!;
  expect(result.width).toBe(800); expect(result.height).toBeCloseTo(3200 / 3); expect(result.backingWidth).toBe(Math.floor(800 * dpr)); expect(result.ratio).toBe(dpr); expect(result.limited).toBe(false);
});
test("hidden containers allocate nothing, extreme pages honor the shared pixel and dimension budgets", () => {
  const input = { width: 600, height: 800, availableWidth: 900, availableHeight: 700, dpr: 4, mode: "custom" as const, zoom: 300 };
  expect(exportPreviewGeometry({ ...input, availableWidth: 0 })).toBeUndefined();
  const result = exportPreviewGeometry({ ...input, width: 90000, height: 120000 })!;
  expect(result.backingWidth * result.backingHeight).toBeLessThanOrEqual(MAX_PDF_CANVAS_PIXELS);
  expect(Math.max(result.backingWidth, result.backingHeight)).toBeLessThanOrEqual(8192); expect(result.limited).toBe(true);
});
