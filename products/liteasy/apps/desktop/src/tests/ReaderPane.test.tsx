import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildTargetEvidenceRects,
  findQuoteRangeInTextLayer,
  shouldLoadPdfFromLocalBytes
} from "../app/features/pdf/PdfReader";
import { normalizePdfTextForSearch } from "../app/features/pdf/pdfTextSearch";
import {
  pdfAnnotationAutoPublicStorageKey,
  pdfAnnotationStorageKey
} from "../app/features/pdf/pdfAnnotationStorage";
import { ReaderPane } from "../app/layout/ReaderPane";

const readerTestPaper = {
  id: "paper-1",
  sourcePath: "/papers/colbert-late-interaction.pdf",
  title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
};

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
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

test("distinguishes managed desktop paths from browser PDF sources", () => {
  expect(shouldLoadPdfFromLocalBytes("/home/octopus/LiteasyLibrary/paper.pdf")).toBe(true);
  expect(shouldLoadPdfFromLocalBytes("C:\\Users\\reader\\LiteasyLibrary\\paper.pdf")).toBe(true);
  expect(shouldLoadPdfFromLocalBytes("/papers/fixture.pdf")).toBe(true);
  expect(shouldLoadPdfFromLocalBytes("blob:http://localhost/paper")).toBe(false);
});

function makeRectList(rects: DOMRect[]) {
  return {
    ...rects,
    item: (index: number) => rects[index] ?? null,
    length: rects.length
  } as unknown as DOMRectList;
}

function getPdfTextNode() {
  const textLayer = document.querySelector(".pdf-text-layer");
  if (!textLayer) {
    throw new Error("Expected PDF text layer to exist");
  }
  const testText = document.createElement("span");
  testText.textContent = "Test-only PDF text layer content";
  textLayer.append(testText);
  return testText.firstChild!;
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
  test.each([
    ["ambiguous", "选择身份候选"],
    ["conflict", "处理身份冲突"],
    ["unavailable", "重试身份确认"],
    ["unresolved", "确认文献身份"]
  ] as const)("shows the %s literature identity state as a recoverable action", (status, label) => {
    const onResolveLiteratureIdentity = vi.fn();
    const request = { purpose: "liteasy_pdf_annotation" as const, query: "State paper" };
    const literatureResolution = status === "ambiguous"
      ? {
          candidates: [{
            candidateKey: "crossref:doi:10.1000/state",
            provider: "crossref" as const,
            record: { authors: [], identifiers: [], title: "State paper" }
          }],
          request,
          status,
          unavailableProviders: [],
          updatedAt: "2026-08-11T00:00:00.000Z"
        }
      : {
          request,
          status,
          unavailableProviders: [],
          updatedAt: "2026-08-11T00:00:00.000Z"
        };
    render(
      <ReaderPane
        analysisHint=""
        artifactTabs={[]}
        artifactTasks={[]}
        literatureResolution={literatureResolution}
        onResolveLiteratureIdentity={onResolveLiteratureIdentity}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={[readerTestPaper.id]}
        selectionLocked={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onResolveLiteratureIdentity).toHaveBeenCalledOnce();
  });

  test("matches Agent evidence quotes across PDF text-layer spans", () => {
    const textLayer = document.createElement("div");
    textLayer.innerHTML = [
      "<span>ColBERT uses late</span>",
      "<span> interaction to preserve</span>",
      "<span> token-level matching signals.</span>"
    ].join("");

    const range = findQuoteRangeInTextLayer(
      textLayer,
      "late interaction to preserve token-level matching"
    );

    expect(range?.toString().replace(/\s+/g, " ")).toContain(
      "late interaction to preserve token-level matching"
    );
  });

  test("uses a persisted page-text offset to disambiguate repeated evidence quotes", () => {
    const textLayer = document.createElement("div");
    textLayer.innerHTML = [
      "<span>first token-level matching signal. </span>",
      "<span>padding between occurrences. </span>",
      "<span>second token-level matching signal.</span>"
    ].join("");

    const range = findQuoteRangeInTextLayer(
      textLayer,
      "token-level matching signal",
      48
    );

    expect(range?.startContainer.parentElement?.textContent).toContain(
      "second token-level matching signal"
    );
  });

  test("keeps persisted offsets aligned when PDF.js omits spaces between positioned spans", () => {
    const textLayer = document.createElement("div");
    const prefixItems = Array.from({ length: 40 }, (_, index) => `x${index}`);
    const pageItems = [
      ...prefixItems,
      "first repeated evidence phrase",
      "second repeated evidence phrase"
    ];
    for (const item of pageItems) {
      const span = document.createElement("span");
      span.textContent = item;
      textLayer.append(span);
    }
    const normalizedPage = normalizePdfTextForSearch(pageItems.join(" "));
    const firstOccurrence = normalizedPage.indexOf("repeated evidence phrase");

    const range = findQuoteRangeInTextLayer(
      textLayer,
      "repeated evidence phrase",
      firstOccurrence
    );

    expect(range?.startContainer.parentElement?.textContent).toContain(
      "first repeated evidence phrase"
    );
  });

  test("uses the shared Unicode-normalized offset to disambiguate repeated evidence quotes", () => {
    const textLayer = document.createElement("div");
    const pageText = "first multimodal AI reference. padding. second multi\u00admodal \uFF21I reference.";
    textLayer.innerHTML = [
      "<span>first multimodal AI reference. padding. </span>",
      "<span>second multi\u00admodal \uFF21I reference.</span>"
    ].join("");
    const normalizedPage = normalizePdfTextForSearch(pageText);
    const secondOccurrence = normalizedPage.indexOf(
      "multimodal ai reference",
      normalizedPage.indexOf("multimodal ai reference") + 1
    );

    const range = findQuoteRangeInTextLayer(
      textLayer,
      "multimodal AI reference",
      secondOccurrence
    );

    expect(range?.startContainer.parentElement?.textContent).toContain("second multi\u00admodal \uFF21I reference");
  });

  test("matches a quote across PDF line-break hyphenation and Unicode dash drift", () => {
    const textLayer = document.createElement("div");
    textLayer.innerHTML = [
      "<span>The late inter-</span>",
      "<span>action path preserves token‐level signals.</span>"
    ].join("");

    const range = findQuoteRangeInTextLayer(
      textLayer,
      "late interaction path preserves token-level signals"
    );

    expect(range?.toString().replace(/\s+/g, " ")).toContain(
      "late inter-action path preserves token‐level signals"
    );
  });

  test("keeps Agent evidence highlight coordinates stable across PDF zoom scales", () => {
    const textLayer = document.createElement("div");
    textLayer.innerHTML = "<span>late interaction independently encodes query and document tokens</span>";
    const page = document.createElement("article");
    let scale = 1;
    const originalGetClientRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => makeRectList([
        makeRect({ height: 16 * scale, left: 120 * scale, top: 160 * scale, width: 320 * scale })
      ])
    });
    vi.spyOn(page, "getBoundingClientRect").mockImplementation(() => makeRect({
      height: 980 * scale,
      left: 20 * scale,
      top: 40 * scale,
      width: 760 * scale
    }));

    try {
      const at100Percent = buildTargetEvidenceRects(
        textLayer,
        page,
        "late interaction independently encodes query and document tokens"
      );
      scale = 2;
      const at200Percent = buildTargetEvidenceRects(
        textLayer,
        page,
        "late interaction independently encodes query and document tokens"
      );

      expect(at100Percent).toHaveLength(1);
      expect(at200Percent).toEqual(at100Percent);
    } finally {
      if (originalGetClientRects) {
        Object.defineProperty(Range.prototype, "getClientRects", originalGetClientRects);
      } else {
        delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
      }
    }
  });

  test("renders the reader header and leaves artifact generation to the floating launcher", () => {
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

    const readerHeader = screen.getByLabelText("PDF 标题栏");
    expect(within(readerHeader).queryByText("AI-driven paper-assisted reading platform")).not.toBeInTheDocument();
    expect(within(readerHeader).queryByText("云端模型能力")).not.toBeInTheDocument();
    expect(within(readerHeader).getByRole("toolbar", { name: "PDF 阅读批注工具栏" })).toBeInTheDocument();
    expect(within(readerHeader).getByText(readerTestPaper.title)).toBeInTheDocument();
    expect(within(readerHeader).getByText("显示比例 100%")).toBeInTheDocument();
    expect(document.querySelector(".pdf-toolbar")).not.toBeInTheDocument();
    expect(screen.getByText("选择分析类型以生成产物")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "思维导图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对比表" })).not.toBeInTheDocument();
    expect(onStartAnalysis).not.toHaveBeenCalled();
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

    const emptyState = screen.getByLabelText("PDF 空状态");
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

    const readerHeader = screen.getByLabelText("PDF 标题栏");
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
      ""
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
    expect(within(selectionMenu).getByRole("button", { name: "加入对话" })).toHaveAttribute(
      "title",
      "把选中文段加入右侧对话上下文"
    );
    expect(within(selectionMenu).queryByRole("button", { name: /深入/ })).not.toBeInTheDocument();

    await user.click(within(selectionMenu).getByRole("button", { name: "高亮" }));
    expect(screen.getByText("已创建高亮批注。")).toBeInTheDocument();
    expect(screen.getByText("vector database systems")).toBeInTheDocument();
    expect(screen.getAllByText("vector database systems")).toHaveLength(1);
    expect(within(screen.getByLabelText("PDF 批注覆盖层")).getByLabelText(/高亮标注/)).toBeInTheDocument();

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: selectionRect,
      text: "vector database systems"
    });
    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "注释" }));
    expect(screen.getByText("注释")).toBeInTheDocument();
    expect(within(screen.getByLabelText("PDF 批注覆盖层")).getByLabelText(/旁注/)).toBeInTheDocument();
  });

  test("keeps a cached-paper promotion failure visible after saving the annotation", async () => {
    const user = userEvent.setup();
    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onPaperAnnotated={vi.fn().mockRejectedValue(new Error("磁盘空间不足"))}
        onStartAnalysis={vi.fn()}
        selectedPapers={[{
          id: "cached-paper-promotion-failure",
          sourcePath: "/papers/survey-vector-database-management-systems.pdf",
          title: "Cached paper"
        }]}
        selectedPaperIds={["cached-paper-promotion-failure"]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: makeRect({ height: 20, left: 180, top: 220, width: 160 }),
      text: "cached paper annotation"
    });
    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", {
      name: "高亮"
    }));

    expect(await screen.findByText(/批注已保存，但 PDF 自动转入文献库失败：磁盘空间不足/u))
      .toBeInTheDocument();
  });

  test("restores local PDF annotations when the same paper is reopened", async () => {
    const user = userEvent.setup();
    const selectionRect = makeRect({ height: 20, left: 180, top: 220, width: 160 });
    const first = render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={[readerTestPaper.id]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({ ancestor: getPdfTextNode(), boundingRect: selectionRect, text: "persistent PDF annotation" });
    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "高亮" }));
    expect(window.localStorage.getItem(pdfAnnotationStorageKey(readerTestPaper)!)).toContain("persistent PDF annotation");

    first.unmount();
    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={[readerTestPaper.id]}
        selectionLocked={true}
      />
    );

    expect(await screen.findByText("persistent PDF annotation")).toBeInTheDocument();
  });

  test("keeps auto-public disabled until the reader explicitly enables it", async () => {
    const user = userEvent.setup();
    const onChangeAnnotationPublication = vi.fn(async () => ({
      desiredVisibility: "public" as const,
      remoteAnnotationId: "annotation-1",
      remoteRevision: 1,
      state: "published" as const
    }));
    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onChangeAnnotationPublication={onChangeAnnotationPublication}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={[readerTestPaper.id]}
        selectionLocked={true}
      />
    );

    const autoPublic = screen.getByRole("checkbox", { name: "新批注自动公开到论坛" });
    expect(autoPublic).not.toBeChecked();
    await user.click(autoPublic);

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: makeRect({ height: 20, left: 180, top: 220, width: 160 }),
      text: "a publicly queued PDF annotation"
    });
    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "注释" }));

    await waitFor(() => expect(onChangeAnnotationPublication).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "publish" })
    ));
    expect(await screen.findByText("已公开到论坛")).toBeInTheDocument();
    expect(window.localStorage.getItem(pdfAnnotationStorageKey(readerTestPaper)!)).toContain('"state":"published"');
    expect(window.localStorage.getItem(pdfAnnotationAutoPublicStorageKey(readerTestPaper)!)).toBe("true");
  });

  test("publishes one local annotation directly from its checkbox", async () => {
    const user = userEvent.setup();
    const onChangeAnnotationPublication = vi.fn(async () => ({
      desiredVisibility: "public" as const,
      remoteAnnotationId: "annotation-1",
      remoteRevision: 1,
      state: "published" as const
    }));
    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        onChangeAnnotationPublication={onChangeAnnotationPublication}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={[readerTestPaper.id]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: makeRect({ height: 20, left: 180, top: 220, width: 160 }),
      text: "a forum draft annotation"
    });
    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    await user.click(within(screen.getByLabelText("选中文本批注菜单")).getByRole("button", { name: "注释" }));
    await user.click(screen.getByRole("checkbox", {
      name: "将第 1 页注释批注公开到论坛：a forum draft annotation"
    }));

    expect(onChangeAnnotationPublication).toHaveBeenCalledWith(expect.objectContaining({ operation: "publish" }));
    expect(await screen.findByText("已公开到论坛")).toBeInTheDocument();
  });

  test("does not offer a forum handoff from the PDF selection menu", async () => {
    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={[readerTestPaper.id]}
        selectionLocked={true}
      />
    );

    mockPdfSelection({
      ancestor: getPdfTextNode(),
      boundingRect: makeRect({ height: 20, left: 180, top: 220, width: 160 }),
      text: "forum context selection"
    });
    fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
    expect(screen.queryByRole("button", { name: "发到论坛" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "立即同步" })).not.toBeInTheDocument();
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

  test("does not expose bundled fixture paths as readable production PDF URLs", () => {
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
      ""
    );
    expect(screen.getAllByText("浏览器不能直接打开此 PDF 路径。").length).toBeGreaterThan(0);
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

  test("shows artifact readiness without rendering generation actions", () => {
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

    expect(screen.getByText("锁定选中文献后开始分析")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "树形展开" })).not.toBeInTheDocument();
  });

  test("highlights the PDF page referenced by an Agent evidence record", () => {
    render(
      <ReaderPane
        analysisHint="已找到引用证据。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
        targetEvidence={{
          evidenceId: "evidence-2-example",
          page: 1,
          paperId: "paper-1",
          quote: "late interaction independently encodes query and document tokens",
          requestId: 1
        }}
      />
    );

    expect(screen.getByLabelText("PDF.js 页面 1")).toHaveClass("evidence-target");
    expect(screen.getByRole("button", { name: "缩略图" })).toHaveClass("active");
  });

  test("reports page-level positioning when the PDF text layer cannot match evidence", async () => {
    render(
      <ReaderPane
        analysisHint="已找到引用证据。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
        targetEvidence={{
          evidenceId: "evidence-unmatched",
          page: 1,
          paperId: "paper-1",
          quote: "a quote that is not available in this text layer",
          requestId: 2
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("已定位到第 1 页；原文文本层未能精确匹配，当前为页级定位。")).toBeInTheDocument();
    });
  });

  test("reports OCR evidence as an explicit page-level fallback without claiming a text-layer match", async () => {
    render(
      <ReaderPane
        analysisHint="已找到 OCR 证据。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPapers={[readerTestPaper]}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
        targetEvidence={{
          evidenceId: "evidence-ocr",
          page: 1,
          paperId: "paper-1",
          quote: "OCR-derived quote",
          requestId: 3,
          textExtraction: "ocr"
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("已定位到第 1 页；该证据来自 OCR 识别，当前只能页级定位。"))
        .toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Agent 引用证据高亮/)).not.toBeInTheDocument();
  });
});
