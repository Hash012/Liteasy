import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantSessionController } from "../app/controllers/assistant/AssistantSessionController";
import { createAssistantHistoryPersistence, type AssistantHistorySnapshot } from "../app/features/assistant/assistantHistoryPersistence";
import { createAssistantSession } from "../app/features/assistant/assistantSessionHistory";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import { mockFocusLayout } from "./fixtures/mockFocusLayout";

const props = { onGenerateArtifact: () => "", selectedSetStatus: { selectedCount: 0, importedCount: 0, selectionLocked: false } };
const fixture = (): AssistantHistorySnapshot => ({ version: "liteasy.assistant-history/v1", activeSessionId: "old-chat", sessions: [{
  ...createAssistantSession({ id: "old-chat" }), title: "旧的研究主题", titleSource: "user", titleVersion: 1,
  messages: [{ id: "u", role: "user", content: "对比论文中的误差来源" }, { id: "a", role: "assistant", content: "区分采样偏差与测量误差。" }]
}], draft: { input: "", tokens: [], readerContexts: [] } });
let restore: () => void;
beforeEach(() => { restore = mockFocusLayout(); });
afterEach(() => { restore(); localStorage.clear(); vi.restoreAllMocks(); });

test("explicit AI rename from home calls the configured model, updates the same conversation and survives reopening", async () => {
  let disk = fixture();
  const transport = { load: async () => disk, save: vi.fn(async (snapshot: AssistantHistorySnapshot) => { disk = structuredClone(snapshot); }) };
  const model = vi.fn(async (_request: { body: string }) => ({ body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "completed", answer: "论文误差来源比较" }) + "\n")); controller.close(); } }), json: async () => ({ answer: "论文误差来源比较", execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }), ok: true, status: 200 }));
  const settingsStore = createSeededSettingsStore();
  const first = render(<AssistantSessionController {...props} settingsStore={settingsStore} modelTransport={model} historyPersistence={createAssistantHistoryPersistence(transport)} />);
  await screen.findByText("区分采样偏差与测量误差。");
  expect(model).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "首页", exact: true }));
  const home = within(screen.getByLabelText("助手首页"));
  await userEvent.click(home.getByRole("button", { name: "管理 旧的研究主题" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "AI 重命名对话" }));
  await waitFor(() => expect(home.getByRole("button", { name: "打开会话：论文误差来源比较" })).toBeVisible());
  expect(model).toHaveBeenCalledTimes(1);
  const request = model.mock.calls[0][0] as { body?: string };
  expect(request.body).toContain("对比论文中的误差来源");
  expect(request.body).toContain("区分采样偏差与测量误差");
  await waitFor(() => expect(disk.sessions.find(session => session.id === "old-chat")).toMatchObject({ title: "论文误差来源比较", titleSource: "model", titleVersion: 2 }));
  first.unmount();
  render(<AssistantSessionController {...props} settingsStore={settingsStore} modelTransport={model} historyPersistence={createAssistantHistoryPersistence(transport)} />);
  await userEvent.click(await screen.findByRole("button", { name: "历史", exact: true }));
  expect(await screen.findByRole("button", { name: /会话：论文误差来源比较/ })).toBeVisible();
  expect(model).toHaveBeenCalledTimes(1);
});

test("delete from the current conversation is confirmed, persisted and absent after reopening", async () => {
  let disk = fixture();
  const transport = { load: async () => disk, save: async (snapshot: AssistantHistorySnapshot) => { disk = structuredClone(snapshot); } };
  const first = render(<AssistantSessionController {...props} historyPersistence={createAssistantHistoryPersistence(transport)} />);
  await screen.findByText("区分采样偏差与测量误差。");
  await userEvent.click(screen.getByRole("button", { name: "更多会话操作" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "删除对话" }));
  expect(disk.sessions[0].lifecycle).not.toBe("tombstoned");
  await userEvent.click(within(screen.getByRole("dialog", { name: "删除对话确认" })).getByRole("button", { name: "删除对话" }));
  await waitFor(() => expect(disk.sessions.find(session => session.id === "old-chat")?.lifecycle).toBe("tombstoned"));
  expect(screen.queryByText("区分采样偏差与测量误差。")).not.toBeInTheDocument();
  first.unmount();
  render(<AssistantSessionController {...props} historyPersistence={createAssistantHistoryPersistence(transport)} />);
  await screen.findByLabelText("助手首页");
  await userEvent.click(screen.getByRole("button", { name: "历史", exact: true }));
  expect(screen.queryByRole("button", { name: /会话：旧的研究主题/ })).not.toBeInTheDocument();
});

test("storage errors show a recovery summary while the exact cause stays in explicit technical details", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("object_missing old-chat-uuid /private/store.db")).mockResolvedValue(fixture());
  render(<AssistantSessionController {...props} historyPersistence={createAssistantHistoryPersistence({ load, save: async () => {} })} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("对话读取失败，请重试。已有内容仍保留。");
  expect(screen.getByText(/object_missing/)).not.toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "错误技术详情" }));
  expect(screen.getByText(/object_missing/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "重试", exact: true }));
  expect(await screen.findByText("区分采样偏差与测量误差。")).toBeVisible();
});

test("a failed deletion restores the conversation and lets the user retry", async () => {
  let fail = false, disk = fixture();
  const transport = { load: async () => disk, save: async (snapshot: AssistantHistorySnapshot) => { if (fail) throw new Error("disk-write-failed internal-file-id"); disk = structuredClone(snapshot); } };
  render(<AssistantSessionController {...props} historyPersistence={createAssistantHistoryPersistence(transport)} />);
  await screen.findByText("区分采样偏差与测量误差。");
  await screen.findByText("已保存到此浏览器");
  fail = true;
  await userEvent.click(screen.getByRole("button", { name: "更多会话操作" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "删除对话" }));
  await userEvent.click(within(screen.getByRole("dialog", { name: "删除对话确认" })).getByRole("button", { name: "删除对话" }));
  await screen.findByText("对话暂未删除，请重试。");
  expect(disk.sessions[0].lifecycle).not.toBe("tombstoned");
  fail = false;
  await userEvent.click(within(screen.getByRole("dialog", { name: "删除对话确认" })).getByRole("button", { name: "删除对话" }));
  await waitFor(() => expect(disk.sessions[0].lifecycle).toBe("tombstoned"));
});
