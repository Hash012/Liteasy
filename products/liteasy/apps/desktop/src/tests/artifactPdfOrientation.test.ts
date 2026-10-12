// @vitest-environment node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";
import { createCompatibilityImagePdf } from "../app/features/artifacts/artifactDocumentExport";

test("production compatibility JPEG PDF keeps a real asymmetric image upright", async () => {
  const jpeg = new Uint8Array(await readFile(resolve("../../../../development/test-data/document-export/orientation.jpg")));
  const bytes = createCompatibilityImagePdf([jpeg]);
  const document = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  expect(document.numPages).toBe(1);
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext("2d") as any, canvas: canvas as any, viewport }).promise;
  const top = canvas.getContext("2d").getImageData(50, 50, 1, 1).data;
  const bottom = canvas.getContext("2d").getImageData(50, 750, 1, 1).data;
  expect(top[0]).toBeGreaterThan(top[2] + 100);
  expect(bottom[2]).toBeGreaterThan(bottom[0] + 100);
  if (process.env.EXPORT_EVIDENCE_DIR) {
    await mkdir(process.env.EXPORT_EVIDENCE_DIR, { recursive: true });
    await writeFile(resolve(process.env.EXPORT_EVIDENCE_DIR, "orientation.pdf"), bytes);
    await writeFile(resolve(process.env.EXPORT_EVIDENCE_DIR, "orientation-pdfjs.png"), canvas.toBuffer("image/png"));
  }
  await document.destroy();
});
