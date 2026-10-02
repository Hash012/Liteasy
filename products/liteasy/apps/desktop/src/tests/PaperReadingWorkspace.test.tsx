import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ReaderPane } from "../app/layout/ReaderPane";
import { PaperReadingWorkspace, readingQuotePages } from "../app/features/paper-reading/PaperReadingWorkspace";
import { loadPaperReadingPreferences } from "../app/features/paper-reading/paperReadingPreferences";
import { pdfAnnotationStorageKey, savePdfAnnotations, type PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { readingQuoteRects, type PdfReadingAnnotations } from "../app/features/pdf/pdfReadingAnnotations";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { RetrievalChunk } from "../app/features/retrieval/retrieval.types";
import type { PageCharModel } from "../app/features/pdf/pdfSelectionEngine";

const paper = { id: "reading-paper", title: "Reading paper", sourcePath: "/paper.pdf" };
const chunks: RetrievalChunk[] = [{ paperId: paper.id, paperTitle: paper.title, page: 2, snippet: "The experiment used 128 samples.", summary: "", tags: [] }];
const original: PdfAnnotationV2 = { id: "original-comment", kind: "highlight", page: 2, excerpt: chunks[0].snippet, note: "PDF 里的原始评论",
  text: "高亮", rects: [{ left: 10, top: 20, width: 30, height: 2 }], color: "yellow", revision: 1,
  createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z", paperIdentity: resolvePaperIdentity(paper),
  publication: { desiredVisibility: "private", state: "not_published" } };
const props = { analysisHint: "", artifactTabs: [], artifactTasks: [], selectedPapers: [paper], selectedPaperIds: [paper.id], selectionLocked: false,
  showArtifactRegion: false, onStartAnalysis: vi.fn() };
function content(session: PdfReadingAnnotations) {
  return <PaperReadingWorkspace session={session} chunks={chunks}><div className="paper-resource-tab"><div className="mineru-markdown"><p>{chunks[0].snippet}</p></div></div></PaperReadingWorkspace>;
}
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); window.getSelection()?.removeAllRanges(); });

test("reading lookup works without annotation geometry and passes the surrounding sentence", async () => {
  const query = vi.fn(async () => ({ text: "experiment", kind: "dictionary" as const, service: "youdao", sourceLabel: "有道词典", senses: [{ definition: "实验" }], pronunciations: [] }));
  const session: PdfReadingAnnotations = { scopeKey: "lookup-no-geometry", ready: false, annotations: [], pageTexts: {}, pageCount: 0, focusedPage: 1,
    lookup: { query, autoQuery: true, translationUsesAi: true }, create: vi.fn(), update: vi.fn(), remove: vi.fn(), openPdf: vi.fn() };
  render(content(session));
  const paragraph = screen.getByText(chunks[0].snippet), range = document.createRange();
  range.setStart(paragraph.firstChild!, 4); range.setEnd(paragraph.firstChild!, 14);
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); fireEvent.mouseUp(paragraph);
  const tools = screen.getByRole("toolbar", { name: "选段工具" });
  expect(within(tools).getByRole("button", { name: "高亮", exact: true })).toBeDisabled();
  expect(within(tools).getByRole("button", { name: "查词/翻译" })).toBeEnabled();
  await screen.findByText("实验");
  expect(query.mock.calls[0][0]).toMatchObject({ text: "experiment", context: "The experiment used 128 samples." });
  expect(screen.queryByRole("button", { name: "保存为批注" })).not.toBeInTheDocument();
  expect(within(tools).getByRole("button", { name: "AI 查词" })).toBeEnabled();
  await userEvent.click(within(tools).getByRole("button", { name: "AI 查词" }));
  await waitFor(() => expect(query).toHaveBeenLastCalledWith({ text: "experiment", mode: "explain", signal: expect.any(AbortSignal) }));
});

test("PDF and reading mode edit and delete the same persisted comment without changing its source", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [original]);
  render(<ReaderPane {...props} readingContent={content} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "阅读模式", exact: true }));
  const comments = await screen.findByRole("complementary", { name: "阅读模式批注" });
  expect(await within(comments).findByText("PDF 里的原始评论")).toBeInTheDocument();
  await user.click(within(comments).getByRole("button", { name: "编辑", exact: true }));
  await user.selectOptions(screen.getByRole("combobox", { name: "标记类型" }), "underline");
  await user.selectOptions(screen.getByRole("combobox", { name: "标记颜色" }), "green");
  await user.clear(screen.getByRole("textbox", { name: "阅读批注内容" }));
  await user.type(screen.getByRole("textbox", { name: "阅读批注内容" }), "从阅读模式补充的评论");
  await user.click(screen.getByRole("button", { name: "保存批注", exact: true }));
  await waitFor(() => expect(within(comments).getByRole("status")).toHaveTextContent("批注已保存"));
  const saved = JSON.parse(localStorage.getItem(pdfAnnotationStorageKey(paper)!)!);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id: original.id, revision: 2, kind: "underline", color: "green", excerpt: original.excerpt, rects: original.rects, note: "从阅读模式补充的评论" });
  await user.click(within(comments).getByRole("button", { name: "查看 PDF" }));
  expect(screen.queryByRole("complementary", { name: "阅读模式批注" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("补充批注笔记")).toHaveValue("从阅读模式补充的评论");
  await user.click(screen.getByRole("button", { name: `阅读模式查看批注：${original.excerpt}` }));
  await user.click(screen.getByRole("complementary", { name: "阅读模式批注" }).querySelector("button")!);
  await user.click(within(screen.getByRole("complementary", { name: "阅读模式批注" })).getByRole("button", { name: "删除", exact: true }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(pdfAnnotationStorageKey(paper)!)!)).toEqual([]));
});

test("selected reading text retains its page and comment across mode changes and reopening", async () => {
  const view = render(<ReaderPane {...props} readingContent={content} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "阅读模式", exact: true }));
  await waitFor(() => expect(screen.getByRole("button", { name: "添加页批注" })).toBeEnabled());
  const paragraph = screen.getByText(chunks[0].snippet);
  const range = document.createRange(); range.selectNodeContents(paragraph);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(paragraph);
  expect(screen.getByRole("combobox", { name: "批注页码" })).toHaveValue("2");
  // This fixture has extracted text but no PDF document/geometry. Keep a page note rather than guess a highlight.
  await user.selectOptions(screen.getByRole("combobox", { name: "标记类型" }), "note");
  await user.type(screen.getByRole("textbox", { name: "阅读批注内容" }), "核对样本量");
  await user.click(screen.getByRole("button", { name: "保存批注", exact: true }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "阅读批注内容" })).not.toBeInTheDocument());
  const saved = JSON.parse(localStorage.getItem(pdfAnnotationStorageKey(paper)!)!);
  expect(saved[0]).toMatchObject({ page: 2, excerpt: chunks[0].snippet, note: "核对样本量", rects: [], publication: { state: "not_published" } });
  view.unmount();
  render(<ReaderPane {...props} readingContent={content} />);
  await user.click(screen.getByRole("button", { name: "阅读模式", exact: true }));
  expect(await within(screen.getByRole("complementary", { name: "阅读模式批注" })).findByText("核对样本量")).toBeInTheDocument();
});

test("reading typography persists locally and malformed preferences are bounded", async () => {
  localStorage.setItem("bad", JSON.stringify({ fontSize: 999, width: -20, font: "__proto__", lineHeight: 0 }));
  expect(loadPaperReadingPreferences("bad")).toMatchObject({ fontSize: 18, font: "serif", lineHeight: 1.85, width: 800 });
  const view = render(<ReaderPane {...props} readingContent={content} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "阅读模式", exact: true }));
  await user.click(screen.getByRole("button", { name: "阅读排版", exact: true }));
  fireEvent.change(screen.getByRole("slider", { name: "阅读字号" }), { target: { value: "24" } });
  await user.click(screen.getByRole("combobox", { name: "阅读字体" }));
  await user.click(screen.getByRole("option", { name: "无衬线 · 黑体" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "阅读页面宽度" }), "1080");
  await user.selectOptions(screen.getByRole("combobox", { name: "阅读行距" }), "2.2");
  await user.keyboard("{Escape}");
  view.unmount(); render(<ReaderPane {...props} readingContent={content} />);
  await user.click(screen.getByRole("button", { name: "阅读模式", exact: true }));
  expect(document.querySelector(".paper-reading-workspace")).toHaveStyle({ "--paper-reading-size": "24px", "--paper-reading-width": "1080px", "--paper-reading-line-height": "2.2" });
  await user.click(screen.getByRole("button", { name: "阅读排版", exact: true }));
  await user.click(screen.getByRole("combobox", { name: "阅读字体" }));
  await user.click(screen.getByRole("option", { name: "跟随阅读设置" }));
  expect((document.querySelector(".paper-reading-workspace") as HTMLElement).style.getPropertyValue("--paper-reading-font")).toContain("var(--reader-font-family,");
});

test("an old reading session cannot write after switching papers", async () => {
  let session!: PdfReadingAnnotations;
  const view = render(<ReaderPane {...props} readingContent={(value) => { session = value; return content(value); }} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "阅读模式", exact: true }));
  await waitFor(() => expect(session.ready).toBe(true));
  const old = session;
  view.rerender(<ReaderPane {...props} selectedPapers={[{ ...paper, id: "other-paper" }]} readingContent={content} />);
  await act(async () => { await expect(old.create({ page: 1, excerpt: "", note: "不能串入下一篇" })).rejects.toThrow("论文已切换"); });
  expect(localStorage.getItem(pdfAnnotationStorageKey({ ...paper, id: "other-paper" })!) ?? "").not.toContain("不能串入下一篇");
});

test("retries persist the same edit while conflicting stale edits cannot overwrite a newer comment", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [original]);
  let session!: PdfReadingAnnotations;
  render(<ReaderPane {...props} readingContent={(value) => { session = value; return content(value); }} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "阅读模式", exact: true }));
  await waitFor(() => expect(session.ready).toBe(true));
  await act(async () => { await session.update(original.id, 1, "新版批注"); });
  await act(async () => { await session.update(original.id, 1, "新版批注"); });
  await expect(session.update(original.id, 1, "旧编辑覆盖")).rejects.toThrow("批注已变化");
  expect(JSON.parse(localStorage.getItem(pdfAnnotationStorageKey(paper)!)!)[0]).toMatchObject({ revision: 2, note: "新版批注" });
});

test("only an unambiguous quote becomes a PDF mark; repeated or changed text remains page anchored", () => {
  const makeModel = (text: string): PageCharModel => ({ pageIndex: 1, viewBox: [0, 0, 100, 100], lines: [],
    chars: [...text].map((c, index) => ({ c, pageIndex: 1, rect: { left: index, right: index + 1, top: 10, bottom: 12 }, inlineRect: { left: index, right: index + 1, top: 10, bottom: 12 } })) });
  expect(readingQuoteRects(makeModel("alpha beta"), "alpha").length).toBeGreaterThan(0);
  expect(readingQuoteRects(makeModel("alpha alpha"), "alpha")).toEqual([]);
  expect(readingQuoteRects(makeModel("alpha"), "altered")).toEqual([]);
  expect(readingQuotePages("alpha", { 1: "alpha", 2: "alpha" }, [])).toEqual([1, 2]);
});

test("reading selections expose the same position-independent tools and cancel outstanding questions on close", async () => {
  const create = vi.fn().mockResolvedValue(undefined), capture = vi.fn().mockResolvedValue(undefined);
  const quickAsk = vi.fn().mockImplementation(() => new Promise(() => {}));
  const session: PdfReadingAnnotations = { scopeKey: "tools", ready: true, annotations: [original], pageTexts: { 2: chunks[0].snippet },
    pageCount: 2, focusedPage: 2, create, capture, quickAsk, update: vi.fn(), remove: vi.fn(), openPdf: vi.fn(),
    annotationTools: () => <button>AI review</button> };
  const view = render(content(session));
  const paragraph = screen.getByText(chunks[0].snippet);
  const range = document.createRange(); range.selectNodeContents(paragraph);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(paragraph);
  const tools = screen.getByRole("toolbar", { name: "选段工具" });
  await userEvent.click(within(tools).getByRole("button", { name: "高亮", exact: true }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: "highlight", page: 2, excerpt: chunks[0].snippet }));
  await userEvent.click(within(tools).getByRole("button", { name: "加入白板", exact: true }));
  expect(capture).toHaveBeenCalledWith({ page: 2, excerpt: chunks[0].snippet }, "board");
  await userEvent.click(within(tools).getByRole("button", { name: "加入对话", exact: true }));
  expect(capture).toHaveBeenLastCalledWith({ page: 2, excerpt: chunks[0].snippet }, "conversation");
  expect(screen.getByRole("button", { name: "AI review" })).toBeInTheDocument();
  await userEvent.click(within(tools).getByRole("button", { name: "速问", exact: true }));
  await userEvent.type(screen.getByRole("textbox", { name: "速问问题" }), "如何理解这个实验？");
  await userEvent.click(screen.getByRole("button", { name: "提问", exact: true }));
  expect(quickAsk).toHaveBeenCalledWith({ page: 2, excerpt: chunks[0].snippet, question: "如何理解这个实验？" }, expect.any(AbortSignal));
  const signal = quickAsk.mock.calls[0][1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
