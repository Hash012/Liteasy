import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { PaperReadingWorkspace } from "../app/features/paper-reading/PaperReadingWorkspace";
import { indexReadingContent, readReadingHistory, readingLocation, restoreReadingLocation } from "../app/features/paper-reading/paperReadingNavigation";
import type { PdfReadingAnnotations } from "../app/features/pdf/pdfReadingAnnotations";

const session: PdfReadingAnnotations = { scopeKey: "account-one/paper-one", ready: true, annotations: [], pageCount: 2, pageTexts: {}, focusedPage: 1,
  create: vi.fn(), update: vi.fn(), remove: vi.fn(), openPdf: vi.fn() };
const body = <div className="paper-resource-tab"><div className="mineru-markdown"><h1>Introduction</h1><p>A reproducible <em>experiment</em> matters.</p><h2>Results</h2><p>The experiment found two effects.</p></div></div>;
function reader(scopeKey = session.scopeKey, children = body) {
  return <PaperReadingWorkspace session={{ ...session, scopeKey }} chunks={[]}>{children}</PaperReadingWorkspace>;
}
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

test("outline and case-insensitive search navigate source paragraphs without rewriting inline content", async () => {
  render(reader());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "阅读目录" }));
  const outline = screen.getByRole("navigation", { name: "论文目录" });
  await user.click(within(outline).getByRole("button", { name: "Results" }));
  expect(document.querySelector("h2")).toHaveAttribute("data-reading-navigation-match", "true");
  expect(screen.getByRole("button", { name: "返回跳转前" })).toBeEnabled();
  await user.click(screen.getByRole("tab", { name: "查找", exact: true }));
  await user.type(screen.getByRole("textbox", { name: "查找阅读正文" }), "EXPERIMENT");
  expect(await screen.findByText("2 个匹配段落")).toBeInTheDocument();
  await user.keyboard("{Shift>}{Enter}{/Shift}");
  expect(document.querySelector("p[data-reading-navigation-match]")).toHaveTextContent("The experiment found two effects.");
  await user.keyboard("{Enter}");
  expect(document.querySelector("p[data-reading-navigation-match]")).toHaveTextContent("A reproducible experiment matters.");
  await user.keyboard("{Enter}");
  expect(document.querySelector("p[data-reading-navigation-match]")).toHaveTextContent("The experiment found two effects.");
  expect(document.querySelector(".mineru-markdown em")).toHaveTextContent("experiment");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("complementary", { name: "阅读导航" })).not.toBeInTheDocument();
});

test("bookmarks survive reopening, can be removed, and remain isolated by paper/account", async () => {
  const view = render(reader());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "阅读书签" }));
  await user.click(screen.getByRole("button", { name: "收藏当前位置" }));
  expect(screen.getByRole("status")).toHaveTextContent("已添加书签");
  await user.click(screen.getByRole("button", { name: "收藏当前位置" }));
  expect(screen.getByRole("status")).toHaveTextContent("已经有书签");
  expect(document.querySelectorAll(".paper-reading-bookmark")).toHaveLength(1);
  view.unmount();
  const reopened = render(reader());
  await user.click(screen.getByRole("button", { name: "阅读书签" }));
  expect(document.querySelectorAll(".paper-reading-bookmark")).toHaveLength(1);
  reopened.rerender(reader("account-one/paper-two"));
  await user.click(screen.getByRole("button", { name: "阅读书签" }));
  expect(document.querySelectorAll(".paper-reading-bookmark")).toHaveLength(0);
  reopened.rerender(reader("account-two/paper-one"));
  await user.click(screen.getByRole("button", { name: "阅读书签" }));
  expect(document.querySelectorAll(".paper-reading-bookmark")).toHaveLength(0);
  reopened.rerender(reader());
  await user.click(screen.getByRole("button", { name: "阅读书签" }));
  await user.click(screen.getByRole("button", { name: /移除书签：/ }));
  expect(document.querySelectorAll(".paper-reading-bookmark")).toHaveLength(0);
});

test("focus, search shortcuts and reading themes preserve comment editing and preferences", async () => {
  const view = render(reader());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "添加页批注" }));
  await user.type(screen.getByRole("textbox", { name: "阅读批注内容" }), "尚未保存的想法");
  await user.click(screen.getByRole("button", { name: "专注阅读", exact: true }));
  expect(document.querySelector(".paper-reading-workspace")).toHaveClass("is-focused");
  expect(screen.queryByRole("complementary", { name: "阅读模式批注" })).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("textbox", { name: "阅读批注内容" })).toHaveValue("尚未保存的想法");
  fireEvent.keyDown(document.querySelector(".paper-reading-workspace")!, { key: "f", ctrlKey: true });
  expect(screen.getByRole("textbox", { name: "查找阅读正文" })).toHaveFocus();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "阅读排版", exact: true }));
  await user.selectOptions(screen.getByRole("combobox", { name: "阅读主题" }), "night");
  await user.selectOptions(screen.getByRole("combobox", { name: "阅读段间距" }), "1.5");
  await user.keyboard("{Escape}");
  view.unmount(); render(reader());
  expect(document.querySelector(".paper-reading-workspace")).toHaveAttribute("data-reading-theme", "night");
  expect(document.querySelector(".paper-reading-workspace")).toHaveStyle({ "--paper-reading-paragraph-spacing": "1.5em" });
});

test("comparison indexes the original only, while translated-only mode indexes and identifies the translation", async () => {
  const translatedBody = (compare: boolean) => <div className="paper-resource-tab">
    {compare ? <section className="paper-resource-tab__reading-pane" aria-label="原文"><div className="mineru-markdown"><h1>Original heading</h1><p>Original text</p></div></section> : null}
    <section className="paper-resource-tab__reading-pane" aria-label="中文 译文"><div className="mineru-markdown"><h1>中文标题</h1><p>中文正文</p></div></section>
  </div>;
  const view = render(reader(session.scopeKey, translatedBody(true)));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "阅读目录" }));
  expect(within(screen.getByRole("navigation", { name: "论文目录" })).queryByRole("button", { name: "中文标题" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "书签", exact: true }));
  await user.click(screen.getByRole("button", { name: "收藏当前位置" }));
  view.rerender(reader(session.scopeKey, translatedBody(false)));
  await waitFor(() => expect(screen.getByText("当前正文：中文 译文")).toBeInTheDocument());
  await user.click(document.querySelector(".paper-reading-bookmark > button")!);
  expect(screen.getByRole("status")).toHaveTextContent("请先切换至原文");
  await user.click(screen.getByRole("tab", { name: "目录", exact: true }));
  expect(within(screen.getByRole("navigation", { name: "论文目录" })).getByRole("button", { name: "中文标题" })).toBeInTheDocument();
});

test("position recovery follows a paragraph through reflow and falls back to a bounded ratio if text changes", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="paper-resource-tab"><div class="mineru-markdown"><p>First</p><p>Second</p></div></div>';
  const { blocks, scroller } = indexReadingContent(root);
  Object.defineProperties(scroller, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
  scroller!.scrollTop = 200;
  vi.spyOn(scroller!, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  vi.spyOn(blocks[0].element, "getBoundingClientRect").mockReturnValue({ top: -200, bottom: -100, height: 100 } as DOMRect);
  const bounds = vi.spyOn(blocks[1].element, "getBoundingClientRect").mockReturnValue({ top: -20, bottom: 80, height: 100 } as DOMRect);
  const position = readingLocation(blocks, scroller!, "原文");
  expect(position).toMatchObject({ key: blocks[1].key, ratio: 0.25, offset: 0.36 });
  bounds.mockReturnValue({ top: 100, bottom: 300, height: 200 } as DOMRect);
  restoreReadingLocation(position, blocks, scroller!);
  expect(scroller!.scrollTop).toBe(356);
  restoreReadingLocation({ ...position, key: "missing" }, blocks, scroller!);
  expect(scroller!.scrollTop).toBe(200);
  localStorage.setItem("corrupt", JSON.stringify({ positions: { 原文: { ...position, ratio: 99 } }, bookmarks: [{ id: "bad", label: "bad", location: null }] }));
  expect(readReadingHistory("corrupt")).toEqual({ positions: {}, bookmarks: [] });
});

test("unavailable storage reports that bookmarks may not survive reopening", async () => {
  render(reader());
  const user = userEvent.setup();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  await user.click(screen.getByRole("button", { name: "阅读书签" }));
  await user.click(screen.getByRole("button", { name: "收藏当前位置" }));
  expect(screen.getByRole("status")).toHaveTextContent("暂时无法保存在本机");
  expect(document.querySelectorAll(".paper-reading-bookmark")).toHaveLength(1);
});
