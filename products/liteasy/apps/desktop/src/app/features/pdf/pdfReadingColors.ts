import { isHexColor } from "../settings/viewSettings";

/** Recolor the page pixels, not the element behind PDF.js's opaque white canvas. */
export function pdfReadingPalette(background: string) {
  const color = isHexColor(background) ? background : "#ffffff";
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  const dark = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 128;
  return { background: rgb, foreground: dark ? [226, 230, 234] : [0, 0, 0], dark };
}

type Point = [number, number];
/** PDF.js records normalized top-left, bottom-left and top-right image corners. */
export function pdfImagePolygons(coordinates: ArrayLike<number> | null | undefined, width: number, height: number): Point[][] {
  if (!coordinates) return [];
  const polygons: Point[][] = [];
  for (let index = 0; index + 5 < coordinates.length; index += 6) {
    const a: Point = [coordinates[index] * width, coordinates[index + 1] * height];
    const b: Point = [coordinates[index + 2] * width, coordinates[index + 3] * height];
    const d: Point = [coordinates[index + 4] * width, coordinates[index + 5] * height];
    const c: Point = [b[0] + d[0] - a[0], b[1] + d[1] - a[1]];
    if ([...a, ...b, ...c, ...d].every(Number.isFinite)) polygons.push([a, b, c, d]);
  }
  return polygons;
}

export function imageSpansAtRow(polygons: readonly Point[][], y: number) {
  const spans: [number, number][] = [];
  for (const polygon of polygons) {
    const intersections: number[] = [];
    polygon.forEach((a, index) => {
      const b = polygon[(index + 1) % polygon.length];
      if (y >= Math.min(a[1], b[1]) && y < Math.max(a[1], b[1])) {
        intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    });
    if (intersections.length >= 2) spans.push([Math.floor(Math.min(...intersections)), Math.ceil(Math.max(...intersections))]);
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

export function recolorPdfPixels(data: Uint8ClampedArray, width: number, top: number, palette: ReturnType<typeof pdfReadingPalette>, polygons: readonly Point[][]) {
  for (let row = 0; row < data.length / (width * 4); row += 1) {
    const spans = imageSpansAtRow(polygons, top + row + .5);
    let span = 0;
    for (let x = 0; x < width; x += 1) {
      while (span < spans.length && x >= spans[span][1]) span += 1;
      if (span < spans.length && x >= spans[span][0]) continue;
      const index = (row * width + x) * 4;
      const r = data[index], g = data[index + 1], b = data[index + 2];
      // Preserve chromatic figures/plots. Neutral paper, text and antialiasing
      // share one transfer curve so colored backgrounds do not leave white halos.
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) continue;
      const light = (r + g + b) / (3 * 255);
      for (let channel = 0; channel < 3; channel += 1) {
        data[index + channel] = Math.round(palette.foreground[channel] + (palette.background[channel] - palette.foreground[channel]) * light);
      }
    }
  }
}

/** Bounded scratch memory; yield between strips and never write a cancelled render. */
export async function applyPdfReadingColors(context: CanvasRenderingContext2D, background: string, coordinates: ArrayLike<number> | null | undefined, cancelled: () => boolean) {
  if (background.toLowerCase() === "#ffffff") return;
  const { width, height } = context.canvas;
  const palette = pdfReadingPalette(background);
  const polygons = pdfImagePolygons(coordinates, width, height);
  for (let top = 0; top < height; top += 64) {
    if (cancelled()) return;
    const image = context.getImageData(0, top, width, Math.min(64, height - top));
    recolorPdfPixels(image.data, width, top, palette, polygons);
    context.putImageData(image, 0, top);
    if (top % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
