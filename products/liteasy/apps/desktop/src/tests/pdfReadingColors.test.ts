import { expect, test, vi } from "vitest";
import { applyPdfReadingColors, imageSpansAtRow, pdfImagePolygons, pdfReadingPalette, recolorPdfPixels } from "../app/features/pdf/pdfReadingColors";

test("maps paper and ink to night/custom colors while preserving colored diagrams and alpha", () => {
  const data = new Uint8ClampedArray([255,255,255,255, 0,0,0,255, 128,128,128,255, 255,0,0,200]);
  recolorPdfPixels(data, 4, 0, pdfReadingPalette("#20252a"), []);
  expect([...data]).toEqual([32,37,42,255, 226,230,234,255, 129,133,138,255, 255,0,0,200]);
  const warm = new Uint8ClampedArray([255,255,255,255, 0,0,0,255]);
  recolorPdfPixels(warm, 2, 0, pdfReadingPalette("#fff7dd"), []);
  expect([...warm]).toEqual([255,247,221,255, 0,0,0,255]);
  expect(pdfReadingPalette("invalid").background).toEqual([255,255,255]);
});

test("leaves raster images unchanged, including rotated images, instead of inverting the whole canvas", () => {
  const polygons = pdfImagePolygons([.25,0, .25,1, .75,0], 4, 1);
  const data = new Uint8ClampedArray([255,255,255,255, 255,255,255,255, 0,0,0,255, 0,0,0,255]);
  recolorPdfPixels(data, 4, 0, pdfReadingPalette("#20252a"), polygons);
  expect([...data]).toEqual([32,37,42,255, 255,255,255,255, 0,0,0,255, 226,230,234,255]);
  const rotated = pdfImagePolygons([.5,0, 0,.5, 1,.5], 100, 100);
  expect(imageSpansAtRow(rotated, 25)).toEqual([[25,75]]);
  expect(imageSpansAtRow(rotated, 75)).toEqual([[25,75]]);
  expect(imageSpansAtRow(rotated, 101)).toEqual([]);
});

test("recoloring yields bounded strips and stops writing after cancellation", async () => {
  let cancelled = false;
  const context = { canvas: { width: 4, height: 1000 }, getImageData: vi.fn((x, y, w, h) => ({ data: new Uint8ClampedArray(w*h*4).fill(255) })), putImageData: vi.fn(() => { cancelled = true; }) };
  await applyPdfReadingColors(context as unknown as CanvasRenderingContext2D, "#20252a", null, () => cancelled);
  expect(context.getImageData).toHaveBeenCalledOnce();
  expect(context.getImageData).toHaveBeenCalledWith(0, 0, 4, 64);
  expect(context.putImageData).toHaveBeenCalledOnce();
});
