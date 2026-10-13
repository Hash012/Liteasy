import { presetGenerationPrompt } from "../app/features/ai-prompts/generationPrompts";
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

test("PDF lookup uses the selected text and sentence, persists results and opens contextual explanation", async () => {
  const query = vi.fn(async () => ({ text: "compact representations", kind: "dictionary" as const, service: "bing", sourceLabel: "必应词典", senses: [{ definition: "紧凑表示" }], pronunciations: [] }));
  const onQuickAsk = vi.fn(async () => "解释");
  render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} selectionLookup={{ query, autoQuery: false, translationUsesAi: true }} />);
  await act(async () => {}); selectText();
  expect(query).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "查词/翻译" }));
  await screen.findByText("紧凑表示");
  expect(query.mock.calls[0][0]).toMatchObject({ text: "compact representations", context: expect.stringContaining("Our method learns compact representations."), paperId: paper.id });
  expect(query.mock.calls[0][0].context).not.toContain("Full page evidence");
  await userEvent.click(screen.getByRole("button", { name: "保存为批注" }));
  await waitFor(() => expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper)).some((item) => item.note?.includes("紧凑表示"))).toBe(true));
  await userEvent.click(screen.getByRole("button", { name: "结合本句解释" }));
  expect(screen.getByRole("textbox", { name: "速问问题" })).toHaveValue("请结合所在句子解释这个单词或短语在论文中的具体含义，说明它与常见释义的关系。");
  expect(screen.queryByRole("region", { name: "查词与翻译结果" })).not.toBeInTheDocument();
});

test("uses the full page and abstract, stores the answer privately, and restores a clickable dashed mark", async () => {
  const user = userEvent.setup();
  const onQuickAsk = vi.fn(async (_request: PdfQuickAskRequest) => "**回答**：这是紧凑表示。");
  const view = render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  await act(async () => {});
  selectText();
  await user.click(screen.getByRole("button", { name: "速问", exact: true }));
  await user.type(screen.getByLabelText("速问问题"), "这是什么意思？");
  expect(screen.queryByRole("textbox", { name: "本次系统提示词" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "回答偏好" }));
  await user.click(screen.getByRole("combobox", { name: "生成风格" }));
  await user.click(screen.getByRole("option", { name: "直觉" }));
  await user.click(screen.getByRole("button", { name: "更多指令" }));
  expect(screen.getByRole("textbox", { name: "本次系统提示词" })).toHaveValue(presetGenerationPrompt("selection_explanation", "intuitive"));
  await user.clear(screen.getByRole("textbox", { name: "本次系统提示词" }));
  await user.type(screen.getByRole("textbox", { name: "本次系统提示词" }), "用二维向量举例");
  await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(onQuickAsk).toHaveBeenCalledTimes(1));
  expect(onQuickAsk.mock.calls[0][0]).toMatchObject({
    page: 1, excerpt: "compact representations", question: "这是什么意思？",
    systemPrompt: "用二维向量举例", pageText: pageTexts[1], abstractText: "Our method learns compact representations."
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
  await user.click(screen.getByRole("button", { name: "发送", exact: true }));
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
  await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("本次回答没有完成");
  await user.click(screen.getByRole("button", { name: "查看错误详情" }));
  expect(screen.getByText("连接中断")).toBeVisible();
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(0);
  expect(screen.getByLabelText("速问问题")).toHaveValue("解释一下");
  await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await screen.findAllByText("重试成功");
});

test("extracts genuine abstracts and degrades honestly without a heading", () => {
  expect(extractQuickAskAbstract(pageTexts[1])).toBe("Our method learns compact representations.");
  expect(extractQuickAskAbstract("题目 摘要：一种方法。关键词：方法 引言")).toBe("一种方法。");
  expect(extractQuickAskAbstract("Unheaded summary")).toBe("");
  expect(buildQuickAskPrompt({ paper, page: 1, excerpt: "selection", question: "why", pageText: "", abstractText: "", signal: new AbortController().signal })).toContain("未提供");
  expect(() => buildQuickAskPrompt({ paper, page: 1, excerpt: "", question: "why", pageText: "", abstractText: "", signal: new AbortController().signal })).toThrow("选段没有");
  expect(readDraggedReaderContext('{"source":"pdf_selection","page":-1}')).toBeNull();
  expect(readDraggedReaderContext("not JSON")).toBeNull();
});


test("starts the default explanation without typing or selecting a configuration", async () => {
  const onQuickAsk = vi.fn(async (_request: PdfQuickAskRequest) => "默认解释");
  render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  await act(async () => {});
  selectText();
  await userEvent.click(screen.getByRole("button", { name: "速问", exact: true }));
  const explain = screen.getByRole("button", { name: "解释选段", exact: true });
  expect(explain).toBeEnabled();
  await userEvent.click(explain);
  await waitFor(() => expect(onQuickAsk).toHaveBeenCalledTimes(1));
  expect(onQuickAsk.mock.calls[0][0].question.trim()).not.toBe("");
  await screen.findByText("已保存为私人批注");
});

test("task buttons only change intent and explicit instructions win without losing the draft", async () => {
  const onQuickAsk = vi.fn(async (_request: PdfQuickAskRequest) => "仅翻译回答");
  render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  await act(async () => {}); selectText();
  await userEvent.click(screen.getByRole("button", { name: "速问", exact: true }));
  await userEvent.type(screen.getByLabelText("速问问题"), "只用英文翻译");
  await userEvent.click(screen.getByRole("button", { name: "拆解推导", exact: true }));
  expect(screen.getByLabelText("速问问题")).toHaveValue("只用英文翻译");
  expect(onQuickAsk).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("速问问题"), { key: "Enter", ctrlKey: true, isComposing: true });
  expect(onQuickAsk).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("速问问题"), { key: "Enter" });
  expect(onQuickAsk).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("速问问题"), { key: "Enter", ctrlKey: true });
  await screen.findByText("已保存为私人批注");
  expect(onQuickAsk).toHaveBeenCalledTimes(1);
  expect(onQuickAsk.mock.calls[0][0].question).toBe("只用英文翻译");
  expect(onQuickAsk.mock.calls[0][0].presetSnapshot?.id).toBe("derive");
});

test("storage failure keeps the same answer and retries only its private annotation write", async () => {
  const original = Storage.prototype.setItem;
  let fail = true;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
    if (fail && key.includes("pdf-annotations") && value.includes("SAVED_ON_RETRY")) throw new Error("模拟磁盘写入失败");
    original.call(this, key, value);
  });
  const onQuickAsk = vi.fn(async (_request: PdfQuickAskRequest) => "SAVED_ON_RETRY");
  render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  await act(async () => {}); selectText();
  await userEvent.click(screen.getByRole("button", { name: "速问", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "解释选段", exact: true }));
  await screen.findByText("回答完成，尚未保存");
  expect(screen.queryByText("已保存为私人批注")).not.toBeInTheDocument();
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(0);
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "重试保存", exact: true }));
  await screen.findByText("已保存为私人批注");
  expect(onQuickAsk).toHaveBeenCalledTimes(1);
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(1);
});

test("streaming remains readable after hiding and explicit stop aborts without saving partial output", async () => {
  let finish!: (answer: string) => void;
  const onQuickAsk = vi.fn((request: PdfQuickAskRequest) => { request.onDelta?.("PARTIAL_ANSWER", "PARTIAL_ANSWER"); return new Promise<string>(resolve => { finish = resolve; }); });
  render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  await act(async () => {}); selectText();
  await userEvent.click(screen.getByRole("button", { name: "速问", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "解释选段", exact: true }));
  await screen.findByText("PARTIAL_ANSWER");
  await userEvent.click(screen.getByRole("button", { name: "收起", exact: true }));
  expect(onQuickAsk.mock.calls[0][0].signal.aborted).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: /返回速问/ }));
  expect(screen.getByText("PARTIAL_ANSWER")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "停止回答", exact: true }));
  expect(onQuickAsk.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => { finish("LATE_FINISH"); });
  expect(screen.queryByText("LATE_FINISH")).not.toBeInTheDocument();
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(0);
});

test.each([
  ["document revision", { ...paper, contentHash: "replacement-content" }],
  ["source permission", { ...paper, sourcePath: "org://restricted/paper.pdf" }],
])("cancels the frozen source on %s change before accepting late output", async (_kind, changed) => {
  let finish!: (answer: string) => void;
  const onQuickAsk = vi.fn((_request: PdfQuickAskRequest) => new Promise<string>(resolve => { finish = resolve; }));
  const view = render(<PdfReader selectedPapers={[paper]} zoom={100} onQuickAsk={onQuickAsk} />);
  await act(async () => {}); selectText();
  await userEvent.click(screen.getByRole("button", { name: "速问", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "解释选段", exact: true }));
  await waitFor(() => expect(onQuickAsk).toHaveBeenCalledTimes(1));
  view.rerender(<PdfReader selectedPapers={[changed]} zoom={100} onQuickAsk={onQuickAsk} />);
  expect(onQuickAsk.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => { finish("LATE_REVOKED_RESULT"); });
  expect(screen.queryByText("LATE_REVOKED_RESULT")).not.toBeInTheDocument();
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(0);
});
