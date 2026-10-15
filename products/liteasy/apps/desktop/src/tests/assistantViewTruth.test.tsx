import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AssistantSessionController } from "../app/controllers/assistant/AssistantSessionController";
import { createAssistantHistoryPersistence, type AssistantHistorySnapshot } from "../app/features/assistant/assistantHistoryPersistence";
import { createAssistantSession } from "../app/features/assistant/assistantSessionHistory";
import { AssistantMessageList } from "../app/features/assistant/AssistantMessageList";
import { createAgentActivity } from "../app/features/assistant/agentActivity";
import { ObjectWorkbenchContext } from "../app/features/objects/objectWorkbenchPort";

const props = { selectedSetStatus: { selectedCount: 0, importedCount: 0, selectionLocked: false }, onGenerateArtifact: () => "" };
const fixture = (): AssistantHistorySnapshot => ({
  version: "liteasy.assistant-history/v1", activeSessionId: "conversation-a",
  sessions: [{ ...createAssistantSession({ id: "conversation-a" }), messages: [
    { id: "user-a", role: "user", content: "A 的问题" },
    { id: "answer-a", role: "assistant", content: "只属于 A 的旧回答" }
  ] }], draft: { input: "", tokens: [], readerContexts: [] }
});
afterEach(() => localStorage.clear());

test("A02-06 empty home neither writes an empty snapshot nor claims content was saved", async () => {
  const save = vi.fn(async () => {});
  render(<AssistantSessionController {...props} historyPersistence={createAssistantHistoryPersistence({ load: async () => null, save })} />);
  await waitFor(() => expect(screen.queryByText("正在恢复对话…")).not.toBeInTheDocument());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
  expect(screen.queryByText("已保存到此浏览器")).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

test("A02-02 task list does not retain the active conversation transcript", async () => {
  render(<AssistantSessionController {...props} historyPersistence={createAssistantHistoryPersistence({ load: async () => fixture(), save: async () => {} })} />);
  await screen.findByText("只属于 A 的旧回答");
  fireEvent.click(screen.getByRole("button", { name: "任务", exact: true }));
  expect(screen.getByLabelText("历史会话面板")).toBeInTheDocument();
  expect(screen.queryByText("只属于 A 的旧回答")).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText("输入你的问题或命令")).not.toBeInTheDocument();
});

async function pendingWrite() {
  let finish!: () => void;
  let delay = false;
  const save = vi.fn(async (_snapshot: AssistantHistorySnapshot) => {
    if (delay) await new Promise<void>((resolve) => { finish = resolve; });
  });
  const persistence = createAssistantHistoryPersistence({ load: async () => fixture(), save });
  render(<AssistantSessionController {...props} historyPersistence={persistence} />);
  await screen.findByText("只属于 A 的旧回答");
  await waitFor(() => expect(screen.getByText("已保存到此浏览器")).toBeInTheDocument());
  delay = true;
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "修订 r7" } });
  fireEvent.blur(window);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  return { finish: async () => { delay = false; await act(async () => { finish(); await persistence.flush(); }); }, save };
}

test("A02-08 r7 acknowledgement does not confirm the unsaved r8 draft", async () => {
  const pending = await pendingWrite();
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "修订 r8" } });
  await pending.finish();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("修订 r8");
  expect(screen.queryByText("已保存到此浏览器")).not.toBeInTheDocument();
});

test("A02-07 A acknowledgement does not confirm a new target B draft", async () => {
  const pending = await pendingWrite();
  fireEvent.click(screen.getByRole("button", { name: "新建", exact: true }));
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "B 未保存的草稿" } });
  await pending.finish();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("B 未保存的草稿");
  expect(screen.queryByText("已保存到此浏览器")).not.toBeInTheDocument();
});

test("A02-09 only completed business turns contribute to the accessible announcement", () => {
  const activity = createAgentActivity();
  render(<AssistantMessageList mode="qa" onModeChange={() => {}} messages={[
    { id: "failed", role: "assistant", content: "historical manager failure", agentActivity: { ...activity, status: "failed" } },
    { id: "unknown", role: "assistant", content: "legacy result_missing" },
    { id: "tool", kind: "system_notice", role: "assistant", content: "tool finished", turnOutcome: "completed" },
    { id: "one", runId: "run-one", role: "assistant", content: "actual answer", agentActivity: { ...activity, status: "completed" } },
    { id: "duplicate", runId: "run-one", role: "assistant", content: "same turn", agentActivity: { ...activity, status: "completed" } },
    { id: "working", runId: "run-two", role: "assistant", content: "partial", agentActivity: activity }
  ]} />);
  expect(screen.getByText("1 条完整回复")).toHaveAttribute("role", "status");
  expect(screen.getByText("legacy result_missing")).toBeInTheDocument();
});

test("A02-01 home names the selected source and persists an openable source locator without claiming to have read it", async () => {
  const save = vi.fn(async (_value: AssistantHistorySnapshot) => {});
  render(<AssistantSessionController {...props} historyPersistence={createAssistantHistoryPersistence({ load: async () => null, save })} selectedPapers={[{ id: "p1", title: "离线合成论文" }]} />);
  await waitFor(() => expect(screen.queryByText("正在恢复对话…")).not.toBeInTheDocument());
  expect(screen.getByLabelText("助手首页")).toHaveTextContent("可使用的已选资料：离线合成论文");
  expect(screen.queryByRole("log")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "根据已选资料提问" }));
  expect((screen.getByPlaceholderText("输入你的问题或命令") as HTMLTextAreaElement).value).toContain("概述这篇论文");
  await waitFor(() => expect(save.mock.calls.at(-1)?.[0].draft.tokens[0]).toMatchObject({ resourcePath: "liteasy://papers/p1?scope=local" }));
});

test("A02-03 selecting either run of task A cannot project task B's events", async () => {
  const task = (artifactId: string, run: number) => ({ id: `${artifactId}-${run}`, agentRunId: `run-${artifactId}-${run}`, artifactId,
    type: "thin_reading" as const, status: "failed" as const, stage: "failed" as const, progress: 20, message: `${artifactId} 的第 ${run} 次诊断` });
  const tasks = [task("B", 2), task("A", 2), task("B", 1), task("A", 1)];
  const rendered = render(<AssistantSessionController {...props} artifactTasks={tasks} artifactSessionOpenRequest={{ requestId: "open-a", taskId: "A-2" }} />);
  await screen.findByRole("combobox", { name: "选择运行记录" });
  expect(screen.getByRole("alert")).toHaveTextContent("A 的第 2 次诊断");
  expect(screen.queryByText(/B 的第/)).not.toBeInTheDocument();
  expect(screen.queryByText("run-A-2")).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "选择运行记录" })).toHaveTextContent("第 2 次 · 失败");
  await userEvent.click(screen.getByRole("combobox", { name: "选择运行记录" }));
  await userEvent.click(screen.getByRole("option", { name: "第 1 次 · 失败" }));
  expect(screen.getByRole("alert")).toHaveTextContent("A 的第 1 次诊断");
  rendered.rerender(<AssistantSessionController {...props} artifactTasks={[{ ...tasks[0], message: "B 的迟到更新" }, ...tasks.slice(1)]} artifactSessionOpenRequest={{ requestId: "open-a", taskId: "A-2" }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("A 的第 1 次诊断");
  expect(screen.queryByText(/B 的迟到更新/)).not.toBeInTheDocument();
});

test("A02-05 a failed later run preserves the prior saved result and frozen reference", async () => {
  const ref = { objectId: "saved-reading", revision: "r1" };
  const active = vi.fn();
  const resolve = vi.fn(async () => [{ refs: [ref], ref, title: "结果 r1", kind: "artifact.document" }]);
  const first = { id: "first", agentRunId: "run-1", artifactId: "reading", type: "thin_reading" as const, status: "completed" as const, stage: "completed" as const, progress: 100, message: "结果已保存" };
  const wrap = (tasks: import("../app/features/artifacts/artifact.types").ArtifactTask[]) => <ObjectWorkbenchContext.Provider value={{ scopeId: "local", resolveLiteasyPath: resolve } as never}>
    <AssistantSessionController {...props} onActiveSessionChange={active} artifactTasks={tasks} artifactSessionOpenRequest={{ requestId: "open", taskId: "first" }} />
  </ObjectWorkbenchContext.Provider>;
  const rendered = render(wrap([first]));
  await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
  await act(async () => {});
  rendered.rerender(wrap([{ ...first, id: "second", agentRunId: "run-2", status: "failed", stage: "failed", message: "新运行失败" }, first]));
  expect(await screen.findByText("本次失败 · 已保存结果可用")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("combobox", { name: "选择运行记录" }));
  expect(screen.getAllByRole("option")).toHaveLength(2);
  await userEvent.keyboard("{Escape}");
  fireEvent.click(screen.getByRole("button", { name: "围绕此结果提问" }));
  await waitFor(() => expect(screen.getByPlaceholderText("输入你的问题或命令")).toBeInTheDocument());
  await waitFor(() => expect(active.mock.calls.at(-1)?.[0].resultRefs).toEqual([ref]));
  expect(resolve).toHaveBeenCalledTimes(1);
});
