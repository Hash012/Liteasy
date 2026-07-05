import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReaderPane } from "../app/layout/ReaderPane";

const readerTestPaper = {
  id: "paper-1",
  sourcePath: "/papers/colbert-late-interaction.pdf",
  title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
};

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRect({ height, left, top, width }: { height: number; left: number; top: number; width: number }) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top
  } as DOMRect;
}

function makeRectList(rects: DOMRect[]) {
  return {
    ...rects,
    item: (index: number) => rects[index] ?? null,
    length: rects.length
  } as unknown as DOMRectList;
}

function getPdfTextNode() {
  const textNode = document.querySelector(".pdf-text-layer span")?.firstChild;
  if (!textNode) {
    throw new Error("Expected PDF text layer fallback text to exist");
  }

  return textNode;
}

function mockPdfSelection({
  ancestor,
  boundingRect,
  clientRects,
  text
}: {
  ancestor: Node;
  boundingRect: DOMRect;
  clientRects?: DOMRect[];
  text: string;
}) {
  vi.spyOn(window, "getSelection").mockReturnValue({
    getRangeAt: () =>
      ({
        commonAncestorContainer: ancestor,
        getBoundingClientRect: () => boundingRect,
        getClientRects: () => makeRectList(clientRects ?? [boundingRect])
      }) as Range,
    rangeCount: 1,
    removeAllRanges: vi.fn(),
    toString: () => text
  } as unknown as Selection);
}

describe("ReaderPane", () => {
  test("renders the reader header and forwards artifact start actions", async () => {
    const user = userEvent.setup();
    const onStartAnalysis = vi.fn();

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={onStartAnalysis}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    const readerHeader = screen.getByLabelText("Reader 标题栏");
    expect(within(readerHeader).getByText("Reader", { selector: ".reader-pane-title" })).toBeInTheDocument();
    expect(within(readerHeader).getByText("LiteasyClaw")).toBeInTheDocument();
    expect(within(readerHeader).getByText("AI-driven paper-assisted reading platform")).toBeInTheDocument();
    expect(within(readerHeader).getByText("云端模型能力")).toBeInTheDocument();
    expect(within(readerHeader).getByRole("toolbar", { name: "PDF 阅读批注工具栏" })).toBeInTheDocument();
    expect(within(readerHeader).getByText(readerTestPaper.title)).toBeInTheDocument();
    expect(within(readerHeader).getByText("显示比例 100%")).toBeInTheDocument();
    expect(document.querySelector(".pdf-toolbar")).not.toBeInTheDocument();
    expect(screen.getByText("选中文献集：1 篇 · 已锁定")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "思维导图" })).toHaveAttribute(
      "title",
      "可以启动中栏分析。"
    );

    await user.click(screen.getByRole("button", { name: "思维导图" }));

    expect(onStartAnalysis).toHaveBeenCalledWith("mindmap");
  });

  test("shows only the LiteasyClaw logo in the reader body when no paper is open", () => {
    render(
      <ReaderPane
        analysisHint="请选择文献。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPaperIds={[]}
        selectionLocked={false}
      />
    );

    const emptyState = screen.getByLabelText("Reader 空状态");
    expect(within(emptyState).getByRole("img", { name: "LiteasyClaw" })).toBeInTheDocument();
    expect(screen.queryByText("选择文献后开始阅读")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("PDF 阅读器")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("多模态产物区域")).not.toBeInTheDocument();
  });

  test("keeps file controls in the reader title row and collapses the artifact area", async () => {
    const user = userEvent.setup();
    const onToggleBottomPane = vi.fn();

    const { rerender } = render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        layoutCollapsed={{ bottom: false, left: false, right: false }}
        onStartAnalysis={vi.fn()}
        onToggleBottomPane={onToggleBottomPane}
        onToggleLeftPane={vi.fn()}
        onToggleRightPane={vi.fn()}
        selectedPapers={[
          {
            id: "paper-1",
            sourcePath: "/papers/acorn-vector-search.pdf",
            title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
          }
        ]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    const readerHeader = screen.getByLabelText("Reader 标题栏");
    const layoutControls = within(readerHeader).getByRole("toolbar", { name: "阅读区布局控制" });
    expect(within(layoutControls).getByRole("button", { name: "折叠左侧栏" })).toHaveAttribute(
      "title",
      "折叠左侧栏"
    );
    expect(within(layoutControls).getByRole("button", { name: "折叠下栏" })).toHaveAttribute("title", "折叠下栏");
    expect(within(layoutControls).getByRole("button", { name: "折叠右侧栏" })).toHaveAttribute(
      "title",
      "折叠右侧栏"
    );
    expect(within(readerHeader).getByText("ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data")).toBeInTheDocument();
    expect(within(readerHeader).getByText("显示比例 100%")).toBeInTheDocument();
    expect(screen.getByLabelText("多模态产物区域")).toBeInTheDocument();

    await user.click(within(layoutControls).getByRole("button", { name: "折叠下栏" }));
    expect(onToggleBottomPane).toHaveBeenCalledTimes(1);

    rerender(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        layoutCollapsed={{ bottom: true, left: false, right: false }}
        onStartAnalysis={vi.fn()}
        onToggleBottomPane={onToggleBottomPane}
        onToggleLeftPane={vi.fn()}
        onToggleRightPane={vi.fn()}
        selectedPapers={[
          {
            id: "paper-1",
            sourcePath: "/papers/acorn-vector-search.pdf",
            title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
          }
        ]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    expect(screen.getByRole("button", { name: "展开下栏" })).toHaveAttribute("title", "展开下栏");
    expect(screen.queryByLabelText("多模态产物区域")).not.toBeInTheDocument();
    expect(screen.getByLabelText("PDF 阅读器").closest(".reader-content-grid")).toHaveClass("artifacts-collapsed");
  });

  test("renders a PDF.js reading surface without the browser PDF object toolbar", () => {
    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[
          {
            id: "paper-1",
            sourcePath: "/papers/colbert-late-interaction.pdf",
            title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
          }
        ]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    expect(screen.getByLabelText("PDF 页面预览")).toBeInTheDocument();
    expect(screen.queryByLabelText("PDF 文档预览")).not.toBeInTheDocument();
    expect(screen.getByLabelText("PDF.js 页面列表")).toHaveClass("responsive");
    expect(screen.getByLabelText("PDF.js 页面 1")).toBeInTheDocument();
    expect(screen.getByLabelText("PDF 阅读器")).toHaveAttribute(
      "data-pdf-source",
      "/papers/colbert-late-interaction.pdf"
    );
  });

  test("shows annotation actions beside the selected PDF text and records selected content", async () => {
    const user = userEvent.setup();
    const selectionRect = makeRect({ height: 20, left: 180, top: 220, width: 160 });

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[
          {
            id: "paper-1",
            sourcePath: "/papers/survey-vector-database-management-systems.pdf",
            title: "Survey of Vector Database Management Systems"
          }
        ]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: selectionRect,
      text: "vector database systems"
    });

    expect(screen.queryByLabelText("选中文本批注菜单")).not.toBeInTheDocument();

    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));

    const selectionMenu = screen.getByLabelText("选中文本批注菜单");
    expect(within(selectionMenu).getByRole("button", { name: "高亮" })).toHaveAttribute("title", "高亮选中文段");
    expect(within(selectionMenu).getByRole("button", { name: "划线" })).toHaveAttribute("title", "给选中文段添加下划线");
    expect(within(selectionMenu).getByRole("button", { name: "注释" })).toHaveAttribute("title", "给选中文段添加旁注");
    expect(within(selectionMenu).getByRole("button", { name: "问 AI" })).toHaveAttribute(
      "title",
      "预留接口：后续会把选中文段发送给 AI"
    );

    await user.click(within(selectionMenu).getByRole("button", { name: "高亮" }));
    expect(screen.getByText("已创建高亮批注。")).toBeInTheDocument();
    expect(screen.getByText("vector database systems")).toBeInTheDocument();
    expect(screen.getAllByText("vector database systems")).toHaveLength(1);
    expect(within(screen.getByLabelText("PDF 批注覆盖层")).getByText("高亮标注")).toBeInTheDocument();

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: selectionRect,
      text: "vector database systems"
    });
    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "注释" }));
    expect(screen.getByText("注释")).toBeInTheDocument();
    expect(within(screen.getByLabelText("PDF 批注覆盖层")).getByText("旁注")).toBeInTheDocument();
  });

  test("uses line-level PDF text rects instead of one tall selection box", async () => {
    const user = userEvent.setup();

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[
          {
            id: "paper-1",
            sourcePath: "/papers/survey-vector-database-management-systems.pdf",
            title: "Survey of Vector Database Management Systems"
          }
        ]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: makeRect({ height: 420, left: 160, top: 130, width: 260 }),
      clientRects: [
        makeRect({ height: 18, left: 160, top: 130, width: 220 }),
        makeRect({ height: 18, left: 160, top: 154, width: 180 })
      ],
      text: "vector database systems span two text layer lines"
    });

    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "高亮" }));

    const highlightMarks = Array.from(document.querySelectorAll<HTMLElement>(".pdf-overlay-mark.highlight"));
    expect(highlightMarks).toHaveLength(2);
    highlightMarks.forEach((mark) => {
      expect(Number.parseFloat(mark.style.height)).toBeLessThanOrEqual(3);
    });
  });

  test("merges overlapping PDF.js fragments on the same visual line", async () => {
    const user = userEvent.setup();

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: makeRect({ height: 20, left: 160, top: 130, width: 250 }),
      clientRects: [
        makeRect({ height: 18, left: 160, top: 130, width: 170 }),
        makeRect({ height: 18, left: 220, top: 130, width: 190 }),
        makeRect({ height: 20, left: 160, top: 129, width: 250 })
      ],
      text: "one visual line from fragmented PDF text"
    });

    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "高亮" }));

    expect(document.querySelectorAll(".pdf-overlay-mark.highlight")).toHaveLength(1);
  });

  test("does not stack duplicate highlights for the same selected text", async () => {
    const user = userEvent.setup();

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );
    const selectionRect = makeRect({ height: 18, left: 160, top: 130, width: 210 });

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: selectionRect,
      text: "the same highlighted sentence"
    });
    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "高亮" }));

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: selectionRect,
      text: "the same highlighted sentence"
    });
    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "高亮" }));

    expect(document.querySelectorAll(".pdf-overlay-mark.highlight")).toHaveLength(1);
    expect(screen.getAllByText("the same highlighted sentence")).toHaveLength(1);
    expect(screen.getByText("该文段已经有高亮批注。")).toBeInTheDocument();
  });

  test("renders note annotations as compact side markers instead of text-height overlays", async () => {
    const user = userEvent.setup();

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: makeRect({ height: 260, left: 160, top: 130, width: 320 }),
      clientRects: [makeRect({ height: 18, left: 160, top: 130, width: 210 })],
      text: "predicate agnostic search"
    });

    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "注释" }));

    const noteMark = document.querySelector<HTMLElement>(".pdf-overlay-mark.note");
    expect(noteMark).toBeInTheDocument();
    expect(Number.parseFloat(noteMark?.style.height ?? "100")).toBeLessThanOrEqual(3);
    expect(Number.parseFloat(noteMark?.style.width ?? "100")).toBeLessThanOrEqual(3);
  });

  test("ignores text selections that do not originate from the PDF text layer", () => {
    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({
      ancestor: document.createTextNode("outside selection"),
      boundingRect: makeRect({ height: 40, left: 24, top: 24, width: 400 }),
      text: "outside selection"
    });

    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));

    expect(screen.queryByLabelText("选中文本批注菜单")).not.toBeInTheDocument();
  });

  test("opens a supplemental note editor from a sidebar annotation item", async () => {
    const user = userEvent.setup();

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: makeRect({ height: 18, left: 160, top: 130, width: 210 }),
      text: "late interaction"
    });

    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "高亮" }));
    await user.click(screen.getByRole("button", { name: /编辑批注/ }));
    await user.type(screen.getByLabelText("补充批注笔记"), "这里要联系实验设置。");
    await user.click(screen.getByRole("button", { name: "保存笔记" }));

    expect(screen.getByText("补充：这里要联系实验设置。")).toBeInTheDocument();
  });

  test("maps bundled fixture PDFs to PDF.js public URLs instead of recursive app-relative paths", () => {
    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[
          {
            id: "paper-1",
            sourcePath: "/papers/colbert-late-interaction.pdf",
            title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
          }
        ]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    expect(screen.getByLabelText("PDF 阅读器")).toHaveAttribute(
      "data-pdf-source",
      "/papers/colbert-late-interaction.pdf"
    );
    expect(screen.queryByText("浏览器不能直接打开此 PDF 路径。")).not.toBeInTheDocument();
  });

  test("uses a Zotero-style PDF workspace with a left annotation sidebar and central page area", () => {
    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    expect(screen.getByLabelText("PDF 左侧批注栏")).toBeInTheDocument();
    expect(screen.getByLabelText("PDF 页面滚动区")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "缩略图" })).toHaveAttribute("title", "显示页面缩略图");
    expect(screen.getByRole("button", { name: "批注" })).toHaveAttribute("title", "显示当前文档批注");
  });

  test("renders non-empty PDF.js thumbnail surfaces instead of blank Page labels", async () => {
    const user = userEvent.setup();

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[
          {
            id: "paper-1",
            sourcePath: "/papers/acorn-vector-search.pdf",
            title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
          }
        ]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    await user.click(screen.getByRole("button", { name: "缩略图" }));

    const sidebar = screen.getByLabelText("PDF 左侧批注栏");
    expect(within(sidebar).getByLabelText("PDF.js 缩略图 1")).toBeInTheDocument();
    expect(within(sidebar).queryByText("Page 1")).not.toBeInTheDocument();
    expect(within(sidebar).getByText("1")).toBeInTheDocument();
  });

  test("collapses and expands the PDF annotation sidebar", async () => {
    const user = userEvent.setup();

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    const workspace = screen.getByLabelText("PDF 阅读工作区");
    expect(workspace).toHaveClass("sidebar-open");

    await user.click(screen.getByRole("button", { name: "收起 PDF 左侧栏" }));

    expect(workspace).toHaveClass("sidebar-collapsed");
    expect(screen.queryByText("暂无批注")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开 PDF 左侧栏" }));

    expect(workspace).toHaveClass("sidebar-open");
    expect(screen.getByText("暂无批注")).toBeInTheDocument();
  });

  test("disables artifact actions until selected papers are locked", () => {
    render(
      <ReaderPane
        analysisHint="请先锁定。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={false}
      />
    );

    expect(screen.getByRole("button", { name: "树形展开" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "树形展开" })).toHaveAttribute("title", "请先锁定。");
  });
});
