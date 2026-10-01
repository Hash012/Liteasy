import { useState } from "react";
import { FluentProvider, webLightTheme, useRestoreFocusTarget } from "@fluentui/react-components";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mockFocusLayout } from "./fixtures/mockFocusLayout";
import { AiWorkbenchDialog } from "../app/features/ai-workbench/AiWorkbenchDialog";
import { useAiWorkbenchController } from "../app/controllers/useAiWorkbenchController";
import type { ArtifactType } from "../app/features/artifacts/artifact.types";
import type { Paper } from "../app/features/workspace/workspace.types";

let restoreFocusLayout: () => void;
beforeEach(() => { restoreFocusLayout = mockFocusLayout(); });
afterEach(() => restoreFocusLayout());

const papers: Paper[] = [
  { id: "current", title: "Current Paper", sourcePath: "D:\\Library\\Current.pdf" },
  { id: "recent", title: "Recent Paper", sourcePath: "D:\\Library\\Recent.pdf" },
  { id: "archived", title: "Archived Methods", sourcePath: "D:\\Library\\Research\\Methods.pdf" },
  { id: "metadata", title: "Metadata Only" }
];
const opened = papers.slice(0, 2);
const snapshot = { entries: [], folders: [{ name: "Research", path: "D:\\Library\\Research", parentPath: null }], rootPath: "D:\\Library", libraryId: "library", revision: 1, trashEntries: [] };
function Harness({ start, scopeId = "account", available = papers }: { start(type: ArtifactType, papers: Paper[]): string; scopeId?: string; available?: Paper[] }) {
  const [active, setActive] = useState("current");
  const restoreFocus = useRestoreFocusTarget();
  const model = useAiWorkbenchController({ scopeId, papers: available, openedPapers: opened, activePaperId: active, startAnalysis: start });
  return <FluentProvider theme={webLightTheme}>
    <button {...restoreFocus} onClick={model.show}>AI 工作台</button><button onClick={() => setActive("recent")}>切换阅读页</button>
    <AiWorkbenchDialog open={model.open} papers={model.papers} openedPapers={opened} activePaperId={active} snapshot={snapshot}
      selectedIds={model.selectedIds} confirmed={model.confirmed} selectionValid={model.selectionValid} message={model.message}
      onClose={model.close} onToggle={model.toggle} onIncludeOpened={model.includeOpened} onClear={model.clear} onConfirm={model.confirm} onStart={model.start} />
  </FluentProvider>;
}

// Fluent/Tabster updates portal accessibility asynchronously after focus changes.
// Await accessible controls rather than querying during a transient aria-hidden state.
test("defaults to the current paper, confirms task-local sources, and requires reconfirmation after edits", async () => {
  const user = userEvent.setup(), start = vi.fn(() => "正在生成产物。");
  render(<Harness start={start} />);
  await user.click(await screen.findByRole("button", { name: "AI 工作台" }));
  expect(await screen.findByRole("checkbox", { name: /Current Paper/ })).toBeChecked();
  expect(await screen.findByRole("checkbox", { name: /Recent Paper/ })).not.toBeChecked();
  expect(await screen.findByRole("button", { name: "生成 PPT" })).toBeDisabled();
  await user.click(await screen.findByRole("button", { name: "确认选择" }));
  await user.click(await screen.findByRole("button", { name: "生成 PPT" }));
  await user.click(await screen.findByRole("button", { name: "开始生成" }));
  expect(start).toHaveBeenCalledExactlyOnceWith("ppt", [papers[0]]);
  expect(await screen.findByRole("status")).toHaveTextContent("正在生成产物。");
  await user.click(await screen.findByRole("checkbox", { name: /Recent Paper/ }));
  expect(await screen.findByRole("button", { name: "生成 PPT" })).toBeDisabled();
  await user.click(await screen.findByRole("button", { name: "确认选择" }));
  await user.click(await screen.findByRole("button", { name: "生成提纲" }));
  await user.click(await screen.findByRole("button", { name: "开始生成" }));
  expect(start).toHaveBeenLastCalledWith("tree", papers.slice(0, 2));
});

test("selects papers from directories, retains hidden selections during search, and creates per-paper thin reading", async () => {
  const user = userEvent.setup(), start = vi.fn(() => "已开始");
  render(<Harness start={start} />);
  await user.click(await screen.findByRole("button", { name: "AI 工作台" }));
  await user.click(await screen.findByRole("tab", { name: "文献目录" }));
  await user.type(await screen.findByRole("textbox", { name: "搜索任务论文" }), "Methods");
  expect(screen.getByText("Research")).toBeInTheDocument();
  await user.click(await screen.findByRole("checkbox", { name: /Archived Methods/ }));
  expect(screen.getByText("已选 2 篇")).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "确认选择" }));
  expect(within(await screen.findByLabelText("已确认的任务论文")).getByText("Current Paper")).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "薄读", exact: true }));
  await user.click(await screen.findByRole("button", { name: "开始生成" }));
  expect(start.mock.calls).toEqual([["thin_reading", [papers[0]]], ["thin_reading", [papers[2]]]]);
  await user.clear(await screen.findByRole("textbox", { name: "搜索任务论文" }));
  expect(await screen.findByRole("checkbox", { name: /Metadata Only/ })).toBeDisabled();
});

test("reopens with the newly active reader and clears the dialog on account changes", async () => {
  const user = userEvent.setup(), start = vi.fn(() => "已开始");
  const { rerender } = render(<Harness start={start} />);
  await user.click(await screen.findByRole("button", { name: "AI 工作台" }));
  await user.click(await screen.findByRole("button", { name: "纳入已打开论文" }));
  await user.click(await screen.findByRole("button", { name: "确认选择" }));
  await user.click(await screen.findByRole("button", { name: "关闭 AI 工作台" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument());
  await user.click(await screen.findByRole("button", { name: "切换阅读页" }));
  await user.click(await screen.findByRole("button", { name: "AI 工作台" }));
  expect(await screen.findByRole("checkbox", { name: /Recent Paper/ })).toBeChecked();
  expect(await screen.findByRole("checkbox", { name: /Current Paper/ })).not.toBeChecked();
  expect(await screen.findByRole("button", { name: "生成 PPT" })).toBeDisabled();
  rerender(<Harness start={start} scopeId="other-account" />);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(start).not.toHaveBeenCalled();
});

test("invalidates a confirmed paper when it is removed and exposes launch errors", async () => {
  const user = userEvent.setup(), start = vi.fn(() => { throw new Error("服务暂不可用"); });
  const { rerender } = render(<Harness start={start} />);
  await user.click(await screen.findByRole("button", { name: "AI 工作台" }));
  await user.click(await screen.findByRole("button", { name: "清空" }));
  await user.click(await screen.findByRole("tab", { name: "文献目录" }));
  fireEvent.click(screen.getByText("Research"));
  await user.click(await screen.findByRole("checkbox", { name: /Archived Methods/ }));
  await user.click(await screen.findByRole("button", { name: "确认选择" }));
  await user.click(await screen.findByRole("button", { name: "生成 PPT" }));
  await user.click(await screen.findByRole("button", { name: "开始生成" }));
  expect(await screen.findByRole("status")).toHaveTextContent("服务暂不可用");
  rerender(<Harness start={start} available={papers.filter((paper) => paper.id !== "archived")} />);
  expect(await screen.findByRole("button", { name: "生成 PPT" })).toBeDisabled();
});
