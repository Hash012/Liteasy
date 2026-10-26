import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ContextAssetBrowser } from "../app/features/assistant/ContextAssetBrowser";
import { browserStateKey, readBrowserState, writePickerRecord } from "../app/features/context-picker/pickerState";
import { contextPickerFixture } from "./contextPickerFixture";

beforeEach(() => localStorage.clear());
function startImages(f: ReturnType<typeof contextPickerFixture>) {
  const key = browserStateKey(f.source.scope, "library", "context", "draft");
  const state = readBrowserState(key, f.source.scope);
  state.route = f.imageRoute; state.history = [["collections"], f.imageRoute]; state.historyIndex = 1;
  writePickerRecord(key, state);
}

test("unchecking select-all clears individually selected results", () => {
  const f = contextPickerFixture(3); startImages(f);
  render(<ContextAssetBrowser catalogPort={f.catalog} suggestions={f.assets} targetDraftId="draft" onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  for (const name of ["图 000", "图 001", "图 002"]) fireEvent.click(screen.getByRole("checkbox", { name: `选择 ${name}`, exact: true }));
  const all = screen.getByRole("checkbox", { name: "全选筛选结果", exact: true });
  expect(all).toBeChecked();
  fireEvent.click(all);
  expect(all).not.toBeChecked();
  expect(screen.getByText("待加入 0 项")).toBeInTheDocument();
});

test("clearing filtered results leaves selected assets outside that filter intact", () => {
  const f = contextPickerFixture(3); startImages(f);
  render(<ContextAssetBrowser catalogPort={f.catalog} suggestions={f.assets} targetDraftId="draft" onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "全选筛选结果", exact: true }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索当前范围" }), { target: { value: "图 000" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "全选筛选结果", exact: true }));
  expect(screen.getByText("待加入 2 项")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "选择 图 000", exact: true })).not.toBeChecked();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索当前范围" }), { target: { value: "" } });
  expect(screen.getByRole("checkbox", { name: "选择 图 001", exact: true })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 图 002", exact: true })).toBeChecked();
});

test("unchecking a container clears members selected through an overlapping container", () => {
  const f = contextPickerFixture(3);
  render(<ContextAssetBrowser catalogPort={f.catalog} suggestions={f.assets} targetDraftId="draft" onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 A", exact: true }));
  const overlapping = screen.getByRole("checkbox", { name: "选择 B", exact: true });
  expect(overlapping).toBeChecked();
  fireEvent.click(overlapping);
  expect(overlapping).not.toBeChecked();
  expect(screen.getByText("待加入 0 项")).toBeInTheDocument();
});
