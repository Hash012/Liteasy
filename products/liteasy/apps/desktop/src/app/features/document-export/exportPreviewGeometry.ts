import { MAX_PDF_CANVAS_PIXELS, pdfCanvasSize } from "../pdf/pdfRenderBudget";
export type ExportPreviewMode = "fit-width" | "fit-page" | "actual-size" | "custom";
/** Reader zoom is relative to fitted width. Export actual-size explicitly uses 96 CSS px/in. */
export function exportPreviewGeometry(input: { width: number; height: number; availableWidth: number; availableHeight: number; dpr: number; mode: ExportPreviewMode; zoom: number }) {
  if (![input.width, input.height, input.dpr, input.zoom].every(value => Number.isFinite(value) && value > 0)) throw new Error("页面尺寸或缩放无效。");
  if (!Number.isFinite(input.availableWidth) || !Number.isFinite(input.availableHeight) || input.availableWidth <= 0 || input.availableHeight <= 0) return undefined;
  const scale = input.mode === "fit-width" ? input.availableWidth / input.width : input.mode === "fit-page" ? Math.min(input.availableWidth / input.width, input.availableHeight / input.height) : 4 / 3 * (input.mode === "actual-size" ? 1 : input.zoom / 100);
  const width = input.width * scale, height = input.height * scale;
  const output = pdfCanvasSize(width, height, input.dpr);
  // The reader policy is shared; floor at hard allocation limits to avoid ceil overshoot.
  const backingWidth = Math.max(1, Math.floor(width * output.ratio)), backingHeight = Math.max(1, Math.floor(height * output.ratio));
  if (backingWidth * backingHeight > MAX_PDF_CANVAS_PIXELS || Math.max(backingWidth, backingHeight) > 8192) throw new Error("页面超出预览内存上限。");
  return { scale, width, height, backingWidth, backingHeight, ratio: output.ratio, limited: output.ratio < input.dpr - 1e-8 };
}
