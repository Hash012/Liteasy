import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { PdfInkLayer } from "../app/features/pdf/PdfInkLayer";
import {
  PdfMarkdownTextBox,
  resizePdfTextBoxEdges,
} from "../app/features/pdf/PdfMarkdownTextBox";
import {
  canGroupPdfInkStroke,
  pdfInkGroupBounds,
  pdfInkStrokes,
} from "../app/features/pdf/pdfInk";
import {
  normalizePdfAnnotationPrivateState,
  pdfAnnotationStorageKey,
  savePdfAnnotations,
  type PdfAnnotationV2,
} from "../app/features/pdf/pdfAnnotationStorage";
import {
  ObjectWorkbenchContext,
  type ObjectWorkbenchPort,
} from "../app/features/objects/objectWorkbenchPort";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import { preparePdfAnnotationCapture } from "../app/features/pdf/pdfAnnotationCapture";

const paper = {
  id: "pdf-workbench-regression",
  title: "Annotation paper",
  sourcePath: "/papers/annotation.pdf",
};
const stroke = {
  points: [
    { x: 20, y: 20 },
    { x: 25, y: 25 },
  ],
  color: "#1b66b3",
  width: 0.3,
};
const nextStroke = {
  ...stroke,
  color: "#a4262c",
  points: [
    { x: 26, y: 26 },
    { x: 28, y: 29 },
  ],
};
function annotation(kind: PdfAnnotationV2["kind"] = "ink"): PdfAnnotationV2 {
  return {
    id: "annotation",
    kind,
    paperIdentity: resolvePaperIdentity(paper),
    page: 1,
    excerpt: kind === "ink" ? "手绘笔记" : "Original quote",
    note: "My explanation",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    revision: 1,
    ink: stroke,
    text: "Annotation",
    rects: [pdfInkGroupBounds([stroke])],
    publication: { desiredVisibility: "private", state: "not_published" },
  };
}
function port(
  overrides: Partial<ObjectWorkbenchPort> = {},
): ObjectWorkbenchPort {
  return {
    capturePdf: vi.fn(async () => []),
    captureMessage: vi.fn(async () => []),
    dragPdf: vi.fn(),
    dragMessage: vi.fn(),
    explain: vi.fn(),
    openLegacyBoard: vi.fn(async () => {}),
    open: vi.fn(),
    ...overrides,
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

test("nearby drawing strokes group only within the time, page and privacy boundaries", () => {
  const item = annotation();
  const now = Date.parse(item.createdAt) + 5000;
  expect(canGroupPdfInkStroke(item, 1, nextStroke, now)).toBe(true);
  expect(canGroupPdfInkStroke(item, 1, nextStroke, now + 6000)).toBe(false);
  expect(canGroupPdfInkStroke(item, 2, nextStroke, now)).toBe(false);
  expect(
    canGroupPdfInkStroke(
      item,
      1,
      { ...nextStroke, points: [{ x: 80, y: 80 }] },
      now,
    ),
  ).toBe(false);
  expect(
    canGroupPdfInkStroke(
      { ...item, updatedAt: new Date(now).toISOString() },
      1,
      nextStroke,
      now + 6000,
    ),
  ).toBe(false);
  expect(
    canGroupPdfInkStroke(
      {
        ...item,
        publication: { desiredVisibility: "public", state: "published" },
      },
      1,
      nextStroke,
      now,
    ),
  ).toBe(false);
});

test("grouped drawing notes preserve every stroke and legacy single strokes after serialization", () => {
  const grouped = {
    ...annotation(),
    inkStrokes: [stroke, nextStroke],
    inkLastStrokeAt: "2026-09-13T00:00:05.000Z",
    rects: [pdfInkGroupBounds([stroke, nextStroke])],
  };
  const normalized = normalizePdfAnnotationPrivateState(
    JSON.parse(
      JSON.stringify({
        annotations: [grouped, { ...annotation(), id: "legacy" }],
        version: 2,
        autoPublic: false,
      }),
    ),
    resolvePaperIdentity(paper),
  );
  expect(normalized.annotations[0]).toEqual(grouped);
  expect(pdfInkStrokes(normalized.annotations[1])).toEqual([stroke]);
  const onDeleteStroke = vi.fn();
  const onDelete = vi.fn();
  render(
    <PdfInkLayer
      annotations={[grouped]}
      mode="erase"
      color="#000000"
      width={0.3}
      aspectRatio={1.4}
      onCreate={vi.fn()}
      onDelete={onDelete}
      onDeleteStroke={onDeleteStroke}
    />,
  );
  const paths = screen.getAllByLabelText("手绘笔迹");
  expect(paths).toHaveLength(2);
  expect(paths[1]).toHaveAttribute("stroke", "#a4262c");
  fireEvent.pointerDown(paths[1]);
  expect(onDeleteStroke).toHaveBeenCalledWith(grouped, 1);
  expect(onDelete).not.toHaveBeenCalled();
});

test.each(["highlight", "underline", "note", "text", "ink"] as const)(
  "%s annotations use the object transfer route with their full saved content",
  async (kind) => {
    const item = annotation(kind);
    savePdfAnnotations(pdfAnnotationStorageKey(paper), [item]);
    const workbench = port({ dragAnnotation: vi.fn() });
    render(
      <ObjectWorkbenchContext.Provider value={workbench}>
        <PdfReader selectedPapers={[paper]} zoom={100} />
      </ObjectWorkbenchContext.Provider>,
    );
    const summary = await screen.findByRole("button", {
      name: `编辑批注：${item.excerpt}`,
    });
    const data = {
      effectAllowed: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;
    fireEvent.dragStart(summary, { dataTransfer: data });
    expect(workbench.dragAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        paper,
        annotation: expect.objectContaining({
          id: item.id,
          kind,
          note: item.note,
        }),
      }),
      data,
    );
  },
);

test("the PDF toolbar closes the object whiteboard without reserving a hidden legacy grid column", () => {
  const workbench = port({ isOpen: true, close: vi.fn() });
  render(
    <ObjectWorkbenchContext.Provider value={workbench}>
      <PdfReader selectedPapers={[paper]} zoom={100} />
    </ObjectWorkbenchContext.Provider>,
  );
  expect(screen.getByLabelText("PDF 阅读工作区")).not.toHaveClass(
    "whiteboard-open",
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭 PDF 白板" }));
  expect(workbench.close).toHaveBeenCalledTimes(1);
  expect(workbench.openLegacyBoard).not.toHaveBeenCalled();
});

test.each(["highlight", "underline"] as const)(
  "%s popup and sidebar use the same Fluent editor and save action",
  async (kind) => {
    const item = annotation(kind);
    savePdfAnnotations(pdfAnnotationStorageKey(paper), [item]);
    await act(async () => {
      render(<PdfReader selectedPapers={[paper]} zoom={100} />);
    });
    const overlay = document.querySelector(`.pdf-overlay-mark.${kind}`)!;
    fireEvent.click(overlay);
    const popup = screen.getByLabelText(
      `${kind === "highlight" ? "高亮" : "划线"}注释编辑器：${item.excerpt}`,
    );
    expect(popup).toHaveClass("pdf-annotation-fluent");
    expect(
      within(popup).getByLabelText("页内批注内容").closest(".fui-Textarea"),
    ).not.toBeNull();
    fireEvent.change(within(popup).getByLabelText("页内批注内容"), {
      target: { value: "Edited explanation" },
    });
    fireEvent.click(within(popup).getByRole("button", { name: "保存注释" }));
    await waitFor(() =>
      expect(
        window.localStorage.getItem(pdfAnnotationStorageKey(paper)!),
      ).toContain("Edited explanation"),
    );
  },
);

test("text box edges resize independently and maintain minimum bounds", () => {
  const rect = { left: 20, top: 20, width: 30, height: 20 };
  expect(resizePdfTextBoxEdges(rect, "nw", -10, -5)).toEqual({
    left: 10,
    top: 15,
    width: 40,
    height: 25,
  });
  expect(resizePdfTextBoxEdges(rect, "e", 15, 50)).toEqual({
    ...rect,
    width: 45,
  });
  expect(resizePdfTextBoxEdges(rect, "se", 200, 200)).toEqual({
    ...rect,
    width: 80,
    height: 80,
  });
  expect(resizePdfTextBoxEdges(rect, "w", 100, 0).width).toBe(8);
});

test("text boxes activate with one click and expose all eight resize handles plus a board drag handle", () => {
  const item = {
    ...annotation("text"),
    manualSize: true,
    rects: [{ left: 20, top: 20, width: 30, height: 20 }],
  };
  const onActivate = vi.fn();
  const onMove = vi.fn();
  const onDragToBoard = vi.fn();
  const props = {
    annotation: item,
    onActivate,
    onMove,
    onDragToBoard,
    onCommit: vi.fn(),
    onDelete: vi.fn(),
    onOpacityChange: vi.fn(),
    rect: item.rects[0],
  };
  const rendered = render(<PdfMarkdownTextBox {...props} active={false} />);
  fireEvent.click(screen.getByRole("region"));
  expect(onActivate).toHaveBeenCalledTimes(1);
  expect(
    screen.getAllByRole("button", {
      name: /^调整 Markdown 文本框(左|上|右|下)/,
    }),
  ).toHaveLength(8);
  fireEvent.keyDown(
    screen.getByRole("button", { name: "调整 Markdown 文本框右边" }),
    { key: "ArrowRight" },
  );
  expect(onMove).toHaveBeenCalledWith(
    item.id,
    expect.objectContaining({ width: item.rects[0].width + 0.5 }),
    true,
  );
  rendered.rerender(<PdfMarkdownTextBox {...props} active />);
  const data = { setData: vi.fn() } as unknown as DataTransfer;
  fireEvent.dragStart(
    screen.getByRole("button", { name: "拖动 Markdown 笔记到研究白板" }),
    { dataTransfer: data },
  );
  expect(onDragToBoard).toHaveBeenCalledWith(
    expect.objectContaining({ note: item.note }),
    data,
  );
});

test("annotation capture retains Markdown, image references, source quotes and quick ask answers", async () => {
  const item = {
    ...annotation("text"),
    note: "![figure](attachment:figure)",
    images: { figure: "data:image/png;base64,AAAA" },
  };
  expect(
    await preparePdfAnnotationCapture({ paper, annotation: item }),
  ).toEqual({
    text: item.note,
    quote: "",
    rects: item.rects,
    images: item.images,
  });
  const quote = await preparePdfAnnotationCapture({
    paper,
    annotation: {
      ...annotation("highlight"),
      quickAsk: {
        question: "Why?",
        answer: "Because.",
        pageText: "Page",
        abstractText: "Abstract",
      },
    },
  });
  expect(quote.text).toContain("Because.");
  expect(quote.quote).toBe("Original quote");
});

test("blob-backed PDFs retain the annotation key across reopenings while replaced bytes remain separate", () => {
  const original = {
    ...paper,
    sourcePath: "blob:reader/first",
    contentHash: "same-bytes",
  };
  expect(
    pdfAnnotationStorageKey({ ...original, sourcePath: "blob:reader/second" }),
  ).toBe(pdfAnnotationStorageKey(original));
  expect(
    pdfAnnotationStorageKey({ ...original, contentHash: "replacement-bytes" }),
  ).not.toBe(pdfAnnotationStorageKey(original));
  expect(pdfAnnotationStorageKey({ ...paper, contentHash: "same-bytes" })).toBe(
    pdfAnnotationStorageKey(paper),
  );
});

test("a failed board migration leaves a readable snapshot that the toolbar can close", async () => {
  const workbench = port({
    isOpen: false,
    openLegacyBoard: vi.fn(async () => {
      throw new Error("Storage unavailable");
    }),
  });
  await act(async () => {
    render(
      <ObjectWorkbenchContext.Provider value={workbench}>
        <PdfReader selectedPapers={[paper]} zoom={100} />
      </ObjectWorkbenchContext.Provider>,
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "打开 PDF 白板" }));
  await screen.findByRole("button", { name: "关闭 PDF 白板" });
  expect(screen.getByLabelText("PDF 阅读工作区")).toHaveClass(
    "whiteboard-open",
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭 PDF 白板" }));
  expect(screen.getByLabelText("PDF 阅读工作区")).not.toHaveClass(
    "whiteboard-open",
  );
  expect(workbench.openLegacyBoard).toHaveBeenCalledTimes(1);
});

test("annotation summaries retain readable content with icon metadata and reveal actions only after selection", async () => {
  const item = annotation("highlight");
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item]);
  const workbench = port({
    dragAnnotation: vi.fn(),
    captureAnnotation: vi.fn(async () => []),
  });
  await act(async () => {
    render(
      <ObjectWorkbenchContext.Provider value={workbench}>
        <PdfReader selectedPapers={[paper]} zoom={100} />
      </ObjectWorkbenchContext.Provider>,
    );
  });
  const summary = screen.getByRole("button", {
    name: `编辑批注：${item.excerpt}`,
  });
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(summary).toHaveTextContent(item.excerpt);
  expect(summary).toHaveTextContent(item.note!);
  expect(summary).not.toHaveTextContent("未公开到论坛");
  expect(
    within(summary).getByRole("img", { name: "高亮" }),
  ).toBeInTheDocument();
  expect(within(summary).getByLabelText("第 1 页")).toHaveTextContent("1");
  expect(
    within(summary).getByRole("img", { name: "未公开到论坛" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("toolbar", { name: /^批注操作/ }),
  ).not.toBeInTheDocument();
  const saved = window.localStorage.getItem(pdfAnnotationStorageKey(paper)!);
  fireEvent.click(summary);
  const actions = screen.getByRole("toolbar", { name: /^批注操作/ });
  expect(
    within(actions).getByRole("button", { name: "删除" }).textContent,
  ).toBe("");
  expect(
    within(actions).getByRole("button", { name: /^定位批注/ }),
  ).toBeInTheDocument();
  expect(
    within(actions).getByRole("button", { name: /^加入研究白板/ }),
  ).toBeInTheDocument();
  expect(
    within(actions).getByRole("checkbox", { name: /公开到论坛/ }),
  ).not.toBeChecked();
  fireEvent.click(
    within(actions).getByRole("button", { name: "收起批注操作" }),
  );
  expect(
    screen.queryByRole("toolbar", { name: /^批注操作/ }),
  ).not.toBeInTheDocument();
  expect(window.localStorage.getItem(pdfAnnotationStorageKey(paper)!)).toBe(
    saved,
  );
});

test("failed publication remains identifiable by icon and readable tooltip without a permanent status paragraph", async () => {
  const item = {
    ...annotation("underline"),
    publication: {
      desiredVisibility: "private" as const,
      state: "failed" as const,
      remoteAnnotationId: "remote-1",
      lastError: "timeout",
    },
  };
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item]);
  await act(async () => {
    render(<PdfReader selectedPapers={[paper]} zoom={100} />);
  });
  const status = screen.getByRole("img", {
    name: "撤回失败，论坛仍公开：timeout",
  });
  expect(status).toHaveTextContent("");
  await userEvent.hover(status);
  expect(
    await screen.findByRole("tooltip", {
      name: "撤回失败，论坛仍公开：timeout",
    }),
  ).toBeInTheDocument();
});

test("a drawing summary uses a compact stroke count and separate accessible page metadata", async () => {
  const item = {
    ...annotation("ink"),
    note: undefined,
    inkStrokes: [stroke, nextStroke],
  };
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item]);
  await act(async () => {
    render(<PdfReader selectedPapers={[paper]} zoom={100} />);
  });
  const summary = screen.getByRole("button", {
    name: `编辑批注：${item.excerpt}`,
  });
  expect(summary).toHaveTextContent("2 笔");
  expect(summary).not.toHaveTextContent("第 1 页");
  expect(within(summary).getByLabelText("第 1 页")).toBeInTheDocument();
  expect(
    within(summary).getByRole("img", { name: "手绘" }),
  ).toBeInTheDocument();
});
