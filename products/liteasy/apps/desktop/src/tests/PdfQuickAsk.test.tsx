import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { pdfAnnotationStorageKey, loadPdfAnnotations } from "../app/features/pdf/pdfAnnotationStorage";
import { buildQuickAskPrompt, extractQuickAskAbstract } from "../app/features/pdf/pdfQuickAsk";
import type { PdfQuickAskRequest } from "../app/features/pdf/pdfQuickAsk";
import { readerContextDragMime, readDraggedReaderContext } from "../app/features/assistant/readerContextDrag";

const pageTexts = { 1: "Paper title\nAbstract\nOur method learns compact representations.\n1 Introduction\nFull page evidence." };
vi.mock("../app/features/pdf/usePdfFulltextStore", () => ({
  usePdfFulltextStore: () => ({ pageTexts, scannedPages: new Set(), documentHasNoTextLayer: false, onPageTextRendered: () => {} })
}));
const paper = { id: "quick-ask-test", title: "Quick ask paper", sourcePath: "/papers/question.pdf" };

function selectText() {
  const span = document.createElement("span");
  span.textContent = "compact representations";
  document.querySelector(".pdf-text-layer")!.append(span);
  const rect = { top: 220, bottom: 240, left: 180, right: 340, width: 160, height: 20, x: 180, y: 220, toJSON: () => ({}) };
  vi.spyOn(window, "getSelection").mockReturnValue({
    getRangeAt: () => ({ commonAncestorContainer: span.firstChild!, getBoundingClientRect: () => rect,
      getClientRects: () => ({ 0: rect, item: () => rect, length: 1 }) }),
    rangeCount: 1, removeAllRanges: vi.fn(), toString: () => span.textContent
  } as unknown as Selection);
  fireEvent.mouseUp(screen.getByLabelText("PDF 页面滚动区"));
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

test("uses the full page and abstract, stores the answer privately, and restores a clickable dashed mark", async () => {
  const user = userEvent.setup();
  const onQuickAsk = vi.fn(async (_request: PdfQuickAskRequest) => "**回答**：这是紧凑表示。");
  const view = render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  await act(async () => {});
  selectText();
  await user.click(screen.getByRole("button", { name: "速问", exact: true }));
  await user.type(screen.getByLabelText("速问问题"), "这是什么意思？");
  await user.click(screen.getByRole("button", { name: "提问", exact: true }));
  await waitFor(() => expect(onQuickAsk).toHaveBeenCalledTimes(1));
  expect(onQuickAsk.mock.calls[0][0]).toMatchObject({
    page: 1, excerpt: "compact representations", question: "这是什么意思？",
    pageText: pageTexts[1], abstractText: "Our method learns compact representations."
  });
  await screen.findAllByText("回答");
  await waitFor(() => expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(1));
  const saved = loadPdfAnnotations(pdfAnnotationStorageKey(paper))[0];
  expect(saved.quickAsk?.answer).toContain("紧凑表示");
  expect(saved.publication?.desiredVisibility).toBe("private");
  view.unmount();
  render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  const mark = await screen.findByLabelText("速问：第 1 页：compact representations");
  expect(mark).toHaveStyle({ borderBottomStyle: "dashed" });
  await user.click(mark);
  expect(screen.getAllByText("这是什么意思？")).toHaveLength(2);
  expect(screen.getAllByText("回答")).toHaveLength(2);
  expect(screen.queryByLabelText("页内批注内容")).not.toBeInTheDocument();
  expect(onQuickAsk).toHaveBeenCalledTimes(1);
  const setData = vi.fn();
  fireEvent.dragStart(mark, { dataTransfer: { setData } });
  const payload = setData.mock.calls.find(([mime]) => mime === readerContextDragMime)![1];
  expect(readDraggedReaderContext(payload)).toMatchObject({ excerpt: "compact representations", paperId: paper.id, page: 1 });
});

test("cancels a pending question on paper switch and does not save its late answer to either paper", async () => {
  const user = userEvent.setup();
  let finish!: (answer: string) => void;
  const onQuickAsk = vi.fn((_request: PdfQuickAskRequest) => new Promise<string>((resolve) => { finish = resolve; }));
  const view = render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  await act(async () => {});
  selectText();
  await user.click(screen.getByRole("button", { name: "速问", exact: true }));
  await user.type(screen.getByLabelText("速问问题"), "解释一下");
  await user.click(screen.getByRole("button", { name: "提问", exact: true }));
  await waitFor(() => expect(onQuickAsk).toHaveBeenCalledTimes(1));
  const otherPaper = { ...paper, id: "other-paper" };
  view.rerender(<PdfReader selectedPapers={[otherPaper]} zoom={100} onQuickAsk={onQuickAsk} />);
  expect(onQuickAsk.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => { finish("late answer"); });
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(0);
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(otherPaper))).toHaveLength(0);
  expect(screen.queryByText("late answer")).not.toBeInTheDocument();
});

test("keeps a failed question available for retry without creating an annotation", async () => {
  const user = userEvent.setup();
  const onQuickAsk = vi.fn().mockRejectedValueOnce(new Error("连接中断")).mockResolvedValueOnce("重试成功");
  render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  await act(async () => {});
  selectText();
  await user.click(screen.getByRole("button", { name: "速问", exact: true }));
  await user.type(screen.getByLabelText("速问问题"), "解释一下");
  await user.click(screen.getByRole("button", { name: "提问", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("连接中断");
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(0);
  expect(screen.getByLabelText("速问问题")).toHaveValue("解释一下");
  await user.click(screen.getByRole("button", { name: "提问", exact: true }));
  await screen.findAllByText("重试成功");
});

test("extracts English and Chinese abstracts and retains opening text without headings", () => {
  expect(extractQuickAskAbstract(pageTexts[1])).toBe("Our method learns compact representations.");
  expect(extractQuickAskAbstract("题目 摘要：一种方法。关键词：方法 引言")).toBe("一种方法。");
  expect(extractQuickAskAbstract("Unheaded summary")).toBe("Unheaded summary");
  expect(() => buildQuickAskPrompt({ paper, page: 1, excerpt: "selection", question: "why", pageText: "", abstractText: "", signal: new AbortController().signal })).toThrow("当前页");
  expect(readDraggedReaderContext('{"source":"pdf_selection","page":-1}')).toBeNull();
  expect(readDraggedReaderContext("not JSON")).toBeNull();
});
