import { getOverlayStyle, getHighlightColor } from "../app/features/pdf/pdfAnnotationAppearance";
import { describe, expect, test } from "vitest";
import { MAX_PDF_RENDERED_PAGES, MAX_PDF_CANVAS_PIXELS, pdfCanvasSize, pdfPagesInViewport } from "../app/features/pdf/pdfRenderBudget";
import { readingHighlightRange, indexReadingHighlights } from "../app/features/paper-reading/readingHighlightRanges";
import { obsidianEditingStatus } from "../app/features/note-files/obsidianWorkspace";

describe("bounded PDF residency", () => {
  test("render cost follows the viewport, not document length, and follows distant jumps", () => {
    const pages = Array.from({ length: 10000 }, (_, index) => ({ page: index + 1, top: index * 900, bottom: (index + 1) * 900 }));
    expect(pdfPagesInViewport(pages, 0, 850)).toEqual([1, 2]);
    const far = pdfPagesInViewport(pages, 900 * 9998, 900 * 9999);
    expect(far[0]).toBe(9999); expect(far).not.toContain(1); expect(far.length).toBeLessThanOrEqual(MAX_PDF_RENDERED_PAGES);
  });
  test("ordinary zoom retains native pixels while oversized canvases are capped", () => {
    expect(pdfCanvasSize(800, 1000, 2)).toEqual({ width: 1600, height: 2000, ratio: 2 });
    const huge = pdfCanvasSize(10000, 10000, 4);
    expect(huge.width * huge.height).toBeLessThanOrEqual(MAX_PDF_CANVAS_PIXELS);
    expect(huge.width).toBeLessThanOrEqual(8192);
  });
});
test("reading marks span inline formatting, normalize ligatures, avoid translations and ambiguous quotes", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div data-reading-page="2"><div class="mineru-markdown"><p>Intro: ﬁrst <em>experiment</em> results.</p></div></div><div class="paper-resource-tab__reading-pane" aria-label="译文"><div class="mineru-markdown">first experiment</div></div>';
  const index = indexReadingHighlights(root);
  expect(readingHighlightRange(index, "first experiment", 2)?.toString()).toBe("ﬁrst experiment");
  expect(readingHighlightRange(index, "first experiment", 1)).toBeUndefined();
  root.querySelector("p")!.append(" first experiment");
  expect(readingHighlightRange(root, "first experiment", 2)).toBeUndefined();
});
test("Obsidian distinguishes an editing leaf from reading or a stale recent-file list", () => {
  expect(obsidianEditingStatus({ lastOpenFiles: ["paper.md"] }, "paper.md").open).toBe(false);
  const workspace = { main: { children: [{ type: "leaf", state: { type: "markdown", state: { file: "研究/paper.md", mode: "source" } } }] } };
  expect(obsidianEditingStatus(workspace, "研究/paper.md")).toEqual({ available: true, open: true, editing: true });
  workspace.main.children[0].state.state.mode = "preview";
  expect(obsidianEditingStatus(workspace, "研究/paper.md").editing).toBe(false);
  expect(obsidianEditingStatus(null, "研究/paper.md").available).toBe(false);
});


test("underline colors edited in reading mode remain the same in the PDF overlay", () => {
  const rect = { left: 10, top: 20, width: 30, height: 2 };
  expect(getOverlayStyle("underline", rect, "green").borderBottom).toBe(`2px solid ${getHighlightColor("green")}`);
  expect(getOverlayStyle("underline", rect).borderBottom).toContain("rgba(27, 102, 179, 0.8)");
  const capped = pdfCanvasSize(12000, 8000, 4);
  expect(capped.width * capped.height).toBeLessThanOrEqual(MAX_PDF_CANVAS_PIXELS);
});
