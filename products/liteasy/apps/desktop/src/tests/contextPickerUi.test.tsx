import { useState } from "react";
import { ResourceReferencesContext, type ResourceReferences } from "../app/features/resource-links/ResourceReferencesContext";
import { beforeEach, expect, test, vi } from "vitest";
import { act, render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextAssetBrowser } from "../app/features/assistant/ContextAssetBrowser";
import { contextPickerFixture } from "./contextPickerFixture";
import { browserStateKey, readBrowserState, writePickerRecord } from "../app/features/context-picker/pickerState";
beforeEach(() => localStorage.clear());
function startImages(f: ReturnType<typeof contextPickerFixture>) {
  const key = browserStateKey(f.source.scope, "library", "context"), state = readBrowserState(key, f.source.scope);
  state.route = f.imageRoute; state.history = [["collections"], f.imageRoute]; state.historyIndex = 1; writePickerRecord(key, state);
}
test("NAV-01/ADD-01/02/BULK-01: navigate without adding, cross-page add receives 75 acknowledgments and stays open", async () => {
  const f = contextPickerFixture(), add = vi.fn(), close = vi.fn(), read = vi.fn();
  f.assets.forEach(asset => { asset.loadPreview = read; });
  render(<ContextAssetBrowser catalogPort={f.catalog} suggestions={f.assets} targetDraftId="draft" onClose={close} onAddContextToken={add} />);
  const user = userEvent.setup();
  for (const name of ["A", "论文 P", "提取资产", "图片"]) await user.click(screen.getByRole("button", { name: `进入 ${name}`, exact: true }));
  expect(add).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  expect(screen.getAllByRole("button", { name: /^预览 图 / })).toHaveLength(60);
  await user.click(screen.getByRole("checkbox", { name: "全选筛选结果", exact: true }));
  await user.click(screen.getByRole("button", { name: "添加所选（75）" }));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(75));
  expect(screen.getByRole("status")).toHaveTextContent("已添加 75 项");
  expect(close).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});
test("ADD-04/SCOPE-01/QUERY-02: closing retains draft selections outside filters; another draft starts empty", async () => {
  const f = contextPickerFixture(12); startImages(f); const add = vi.fn();
  const props = { catalogPort: f.catalog, suggestions: f.assets, onClose: vi.fn(), onAddContextToken: add };
  const first = render(<ContextAssetBrowser {...props} targetDraftId="A" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox", { name: "选择 图 000", exact: true }));
  await user.type(screen.getByRole("textbox", { name: "搜索当前范围" }), "不存在");
  await user.click(screen.getAllByRole("button", { name: "返回对话" }).at(-1)!);
  first.unmount(); expect(add).not.toHaveBeenCalled();
  const second = render(<ContextAssetBrowser {...props} targetDraftId="B" />);
  expect(screen.getByText("已选 0 项")).toBeInTheDocument(); second.unmount();
  render(<ContextAssetBrowser {...props} targetDraftId="A" />);
  expect(screen.getByText("已选 1 项")).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "只看已选" }));
  expect(screen.getByRole("checkbox", { name: "选择 图 000", exact: true })).toBeChecked();
});
test("BULK-02/03: explicit whole group includes hidden members then actual add excludes one image", async () => {
  const f = contextPickerFixture(12); startImages(f); const add = vi.fn();
  render(<ContextAssetBrowser catalogPort={f.catalog} suggestions={f.assets} targetDraftId="draft" onClose={vi.fn()} onAddContextToken={add} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "搜索当前范围" }), "tag:keep");
  await user.click(screen.getByRole("checkbox", { name: "全选筛选结果", exact: true }));
  expect(screen.getByText("已选 2 项")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "选择本层全部（12 项内容）" }));
  expect(screen.getByRole("status")).toHaveTextContent("隐藏");
  await user.click(screen.getByRole("button", { name: "确认选择全部" }));
  expect(screen.getByText("已选 12 项")).toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "搜索当前范围" }));
  await user.click(screen.getByRole("checkbox", { name: "选择 图 004", exact: true }));
  await user.click(screen.getByRole("button", { name: "添加所选（11）" }));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(11));
  expect(add.mock.calls.some(([token]) => token.contextRefs.some((ref: any) => ref.objectId === "image-4"))).toBe(false);
});
test("A11Y-01: arrows move focus, Space selects, Enter previews and Escape first closes preview", async () => {
  const f = contextPickerFixture(3); startImages(f);
  render(<ContextAssetBrowser catalogPort={f.catalog} suggestions={f.assets} onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  const first = screen.getByRole("button", { name: "预览 图 000" }); act(() => first.focus());
  const user = userEvent.setup(); await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("button", { name: "预览 图 001" })).toHaveFocus();
  expect(screen.getByText("已选 0 项")).toBeInTheDocument();
  await user.keyboard(" "); expect(screen.getByRole("checkbox", { name: "选择 图 001" })).toBeChecked();
  await user.keyboard("{Enter}"); expect(screen.getByRole("complementary", { name: "资产预览" })).toBeInTheDocument();
  await user.keyboard("{Escape}"); expect(screen.queryByRole("complementary", { name: "资产预览" })).not.toBeInTheDocument();
  const search = screen.getByRole("textbox", { name: "搜索当前范围" }); await user.click(search); await user.type(search, "图"); await user.keyboard("{Control>}a{/Control}");
  expect(screen.getByText("已选 1 项")).toBeInTheDocument();
});


test("REC-02: local recommendations keep their positions when attached; reopening alone takes a new snapshot", async () => {
  const f = contextPickerFixture(12);
  function Harness() {
    const [tokens, setTokens] = useState<any[]>([]);
    const refs = { service: { scope: f.source.scope }, suggestions: f.assets, picker: { catalog: f.catalog, workspaceId: "library", activePaperId: "p" } } as ResourceReferences;
    return <ResourceReferencesContext.Provider value={refs}><ContextAssetBrowser targetDraftId="rec" suggestions={f.assets} contextTokens={tokens} onClose={vi.fn()} onAddContextToken={token => setTokens(values => [...values, token])} /></ResourceReferencesContext.Provider>;
  }
  render(<Harness />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "推荐", exact: true }));
  const names = () => within(screen.getByRole("region", { name: "可添加资产" })).getAllByRole("button", { name: /^预览 / }).map(button => button.getAttribute("aria-label"));
  const initial = names(); expect(initial).toHaveLength(6);
  await user.click(screen.getByRole("checkbox", { name: `选择 ${initial[0]!.slice(3)}`, exact: true }));
  await user.click(screen.getByRole("button", { name: "添加所选（1）" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已添加 1 项"));
  expect(names()).toEqual(initial);
});
