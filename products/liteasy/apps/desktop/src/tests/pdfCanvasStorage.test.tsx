import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PdfAnnotationMarkdown } from "../app/features/pdf/PdfAnnotationMarkdown";
import { isPdfInkStroke, pdfInkBounds } from "../app/features/pdf/pdfInk";
import { isPdfTextBoxImages, readPdfTextBoxImage } from "../app/features/pdf/pdfTextBoxImages";
import { normalizePdfAnnotationPrivateState } from "../app/features/pdf/pdfAnnotationStorage";

const image = "data:image/png;base64,aGVsbG8=";
const ink = { color: "#1b66b3", width: .3, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
const identity = { paperId: "paper", title: "Paper", candidates: [], primary: { kind: "local" as const, value: "paper" } };
const base = { id: "annotation", createdAt: "2026-09-13", updatedAt: "2026-09-13", excerpt: "Annotation", text: "Annotation",
  page: 1, paperIdentity: identity, rects: [], revision: 1, publication: { desiredVisibility: "private", state: "not_published" } };
afterEach(cleanup);

test("ink and embedded image content survive serialization into the private artifact snapshot", () => {
  const annotations = [
    { ...base, kind: "ink", ink, rects: [pdfInkBounds(ink)] },
    { ...base, id: "text", kind: "text", note: "![图片](attachment:pic)", images: { pic: image } }
  ];
  const result = normalizePdfAnnotationPrivateState(JSON.parse(JSON.stringify({ annotations, autoPublic: false, version: 2 })), identity);
  expect(result.annotations).toEqual(annotations);
  expect(result.annotations[0].rects).toEqual([{ left: 0, top: 0, width: 100, height: 100 }]);
});

test("corrupt pen geometry is excluded without losing valid siblings", () => {
  expect(isPdfInkStroke({ ...ink, points: [{ x: NaN, y: 2 }] })).toBe(false);
  expect(isPdfInkStroke({ ...ink, points: [] })).toBe(false);
  expect(isPdfInkStroke({ ...ink, width: -1 })).toBe(false);
  expect(isPdfInkStroke({ ...ink, points: [{ x: 101, y: 2 }] })).toBe(false);
  const result = normalizePdfAnnotationPrivateState({ annotations: [
    { ...base, kind: "ink", ink: { ...ink, points: [] } },
    { ...base, id: "valid", kind: "ink", ink }
  ], version: 2, autoPublic: false }, identity);
  expect(result.annotations.map((item) => item.id)).toEqual(["valid"]);
});

test("only bounded raster attachments are admitted and unsafe Markdown links stay blocked", async () => {
  expect(isPdfTextBoxImages({ pic: image })).toBe(true);
  expect(isPdfTextBoxImages({ pic: "data:image/svg+xml;base64,aGVsbG8=" })).toBe(false);
  expect(isPdfTextBoxImages({ pic: "https://example.org/image.png" })).toBe(false);
  expect(isPdfTextBoxImages({ pic: "data:image/png;base64," + "A".repeat(3_000_001) })).toBe(false);
  await expect(readPdfTextBoxImage(new File(["<svg/>"], "vector.svg", { type: "image/svg+xml" }))).rejects.toThrow("PNG");
  await expect(readPdfTextBoxImage(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }))).rejects.toThrow("2 MB");
  const png = await readPdfTextBoxImage(new File(["hello"], "a.png", { type: "image/png" }));
  expect(png).toBe(image);
  render(<PdfAnnotationMarkdown value="![图片](attachment:pic) [链接](javascript:alert)" images={{ pic: image }} />);
  expect(screen.getByAltText("图片")).toHaveAttribute("src", image);
  expect(screen.getByText("链接")).toHaveAttribute("href", "");
});
