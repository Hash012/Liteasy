import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { PdfReader } from "../app/features/pdf/PdfReader";
import {
  pdfAnnotationStorageKey,
  savePdfAnnotations,
  type PdfAnnotationV2
} from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { Paper } from "../app/features/workspace/workspace.types";
import { pdfWhiteboardStorageKey } from "../app/features/pdf/pdf-whiteboard/pdfWhiteboardStorage";

const paper: Paper = {
  id: "pdf-reader-interaction",
  sourcePath: "/papers/reader-interaction.pdf",
  title: "PDF Reader Interaction"
};

function annotation(overrides: Partial<PdfAnnotationV2> = {}): PdfAnnotationV2 {
  return {
    createdAt: "2026-08-30T00:00:00.000Z",
    excerpt: "A deliberately long highlighted passage whose complete contents should become visible when the sidebar entry is expanded.",
    id: "reader-annotation",
    kind: "highlight",
    normalizedStart: 120,
    page: 1,
    paperIdentity: resolvePaperIdentity(paper),
    publication: { desiredVisibility: "private", state: "not_published" },
    rects: [{ height: 2, left: 20, top: 40, width: 35 }],
    revision: 1,
    text: "高亮",
    updatedAt: "2026-08-30T00:00:00.000Z",
    ...overrides
  };
}

function renderAnnotation(value: PdfAnnotationV2) {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [value]);
  return render(<PdfReader selectedPapers={[paper]} zoom={100} />);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

test("shows the same colored highlights in thumbnails and the page", async () => {
  renderAnnotation(annotation({ color: "green" }));
  await userEvent.setup().click(screen.getByRole("button", { name: "缩略图", exact: true }));
  await waitFor(() => expect(document.querySelector(".pdf-thumbnail-mark.highlight")).not.toBeNull());
  const thumbnail = document.querySelector<HTMLElement>(".pdf-thumbnail-mark.highlight")!;
  const page = document.querySelector<HTMLElement>("button.pdf-overlay-mark.highlight")!;
  expect(thumbnail.style.backgroundColor).toBe(page.style.backgroundColor);
  expect(thumbnail.style.left).toBe(page.style.left);
  expect(thumbnail.style.top).toBe(page.style.top);
});

test("expands a sidebar annotation entry so its complete excerpt is available", async () => {
  const user = userEvent.setup();
  renderAnnotation(annotation());

  const summary = await screen.findByRole("button", { name: /编辑批注/u });
  const item = summary.closest(".pdf-annotation-item");
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(item).not.toHaveClass("expanded");

  await user.click(summary);

  expect(summary).toHaveAttribute("aria-expanded", "true");
  expect(item).toHaveClass("expanded");
  expect(item?.querySelector(".pdf-annotation-excerpt")).toHaveTextContent(
    "complete contents should become visible"
  );
});

test("double-clicking an annotation entry scrolls to its exact page position", async () => {
  renderAnnotation(annotation());
  const summary = await screen.findByRole("button", { name: /编辑批注/u });
  const stage = screen.getByLabelText("PDF 页面滚动区");
  const page = screen.getByLabelText("PDF.js 页面 1");
  const scrollTo = vi.fn();
  Object.defineProperty(stage, "clientHeight", { configurable: true, value: 600 });
  Object.defineProperty(stage, "scrollTo", { configurable: true, value: scrollTo });
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    bottom: 700,
    height: 600,
    left: 180,
    right: 980,
    top: 100,
    width: 800,
    x: 180,
    y: 100,
    toJSON: () => ({})
  } as DOMRect);
  vi.spyOn(page, "getBoundingClientRect").mockReturnValue({
    bottom: 1500,
    height: 1000,
    left: 220,
    right: 980,
    top: 500,
    width: 760,
    x: 220,
    y: 500,
    toJSON: () => ({})
  } as DOMRect);

  fireEvent.doubleClick(summary);

  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({
    behavior: "smooth",
    top: 632
  }));
  expect(screen.getByText("已定位到第 1 页的高亮。")).toBeInTheDocument();
});

test("draws an underline at the glyph rectangle baseline instead of one line below it", async () => {
  renderAnnotation(annotation({ kind: "underline", text: "划线" }));

  const mark = await screen.findByLabelText(/划线标注/u);
  expect(mark).toHaveStyle({
    height: "2%",
    top: "40%",
    width: "35%"
  });
  expect(mark).toHaveStyle("border-bottom: 2px solid rgba(27, 102, 179, 0.8)");
});

test("insets a highlight band by five percent above and below the selected glyphs", async () => {
  renderAnnotation(annotation());

  const mark = await screen.findByLabelText(/高亮标注/u);
  expect(mark).toHaveStyle({
    height: "1.8%",
    top: "40.1%",
    width: "35.2%"
  });
});

test("clicking a page highlight opens its comment editor with a live Markdown preview", async () => {
  const user = userEvent.setup();
  renderAnnotation(annotation({ note: "" }));

  const mark = await screen.findByLabelText(/高亮标注/u);
  await user.click(mark);

  const editor = screen.getByLabelText(/高亮注释编辑器/u);
  const input = within(editor).getByRole("textbox", { name: "页内批注内容" });
  await user.clear(input);
  await user.type(input, "**核心结论**\n\n- 第一项");

  const preview = within(editor).getByLabelText("页内批注 Markdown 实时预览");
  expect(within(preview).getByText("核心结论").tagName).toBe("STRONG");
  expect(within(preview).getByRole("listitem")).toHaveTextContent("第一项");
  expect(preview).not.toHaveTextContent("**核心结论**");

  await user.click(within(editor).getByRole("button", { name: "保存注释" }));
  expect(screen.queryByLabelText(/高亮注释编辑器/u)).not.toBeInTheDocument();
  const sidebarPreview = screen.getByText("核心结论").closest(".annotation-note-preview");
  expect(sidebarPreview?.querySelector("strong")).toHaveTextContent("核心结论");
});

test("shows highlighted comments beside the PDF only when the margin layer is enabled", async () => {
  const user = userEvent.setup();
  renderAnnotation(annotation({ note: "**页边结论**\n\n$E=mc^2$" }));

  expect(screen.queryByLabelText(/comment：/u)).not.toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "显示页边批注" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");

  await user.click(toggle);

  const comment = screen.getByLabelText(/^第 1 页高亮批注：/u);
  const page = screen.getByLabelText("PDF.js 页面 1");
  const rail = screen.getByLabelText("第 1 页页外批注栏");
  expect(page).not.toContainElement(comment);
  expect(page.parentElement).toContainElement(rail);
  const connector = page.parentElement?.querySelector<HTMLElement>(".pdf-margin-comment-connector");
  expect(connector).not.toBeNull();
  expect(Number.parseFloat(connector?.style.width ?? "0")).toBeGreaterThan(0);
  expect(connector?.style.transform).toBe("");
  expect(screen.getByLabelText("PDF.js 页面列表")).toHaveClass("with-margin-comments");
  expect(within(comment).getByText("页边结论").tagName).toBe("STRONG");
  expect(comment.querySelector(".katex")).not.toBeNull();
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(window.localStorage.getItem("liteasy:pdf-reader:margin-comments")).toBe("true");

  const connectorToggle = screen.getByRole("button", { name: "显示批注关联线" });
  expect(connectorToggle).toHaveAttribute("aria-pressed", "true");
  await user.click(connectorToggle);
  expect(page.parentElement?.querySelector(".pdf-margin-comment-connector")).toBeNull();
  expect(window.localStorage.getItem("liteasy:pdf-reader:margin-comment-connectors")).toBe("false");
  expect(comment).toBeInTheDocument();

  await user.click(toggle);
  expect(screen.queryByLabelText(/comment：/u)).not.toBeInTheDocument();
});

test("opens a persistent whiteboard beside the PDF reader", async () => {
  const user = userEvent.setup();
  render(<PdfReader selectedPapers={[paper]} zoom={100} />);
  const toggle = screen.getByRole("button", { name: "打开 PDF 白板" });

  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await user.click(toggle);

  const whiteboard = screen.getByLabelText("PDF 思考白板");
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("PDF 阅读工作区")).toHaveClass("whiteboard-open");
  await user.click(within(whiteboard).getByRole("button", { name: "文字" }));

  const storageKey = pdfWhiteboardStorageKey(paper)!;
  await waitFor(() => {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    expect(stored?.nodes).toHaveLength(1);
    expect(stored.nodes[0].kind).toBe("markdown");
  });

  await user.click(within(whiteboard).getByRole("button", { name: "收起 PDF 白板" }));
  expect(screen.queryByLabelText("PDF 思考白板")).not.toBeInTheDocument();
  expect(toggle).toHaveAttribute("aria-pressed", "false");
});
