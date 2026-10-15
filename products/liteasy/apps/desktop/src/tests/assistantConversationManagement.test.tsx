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


test("recovery after deleting the active conversation does not move its draft into a new conversation", async () => {
  const saved = fixture(); saved.sessions[0].lifecycle = "tombstoned";
  saved.draft.input = "已删除对话的未发送内容";
  render(<AssistantSessionController {...props} historyPersistence={createAssistantHistoryPersistence({ load: async () => saved, save: async () => {} })} />);
  await screen.findByLabelText("助手首页");
  await waitFor(() => expect(screen.queryByText("正在恢复对话…")).not.toBeInTheDocument());
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("");
  expect(screen.queryByText("区分采样偏差与测量误差。")).not.toBeInTheDocument();
});

test("opening a lazily loaded renamed history item preserves its newer title", async () => {
  const snapshot = fixture();
  const old = { ...snapshot.sessions[0], id: "lazy-chat", title: "未载入的旧标题", messages: [], messagesLoaded: false, messageCount: 2 };
  snapshot.sessions.push(old);
  const persistence = createAssistantHistoryPersistence({ load: async () => snapshot, save: async () => {} });
  persistence.loadSession = vi.fn(async () => ({ ...fixture().sessions[0], id: old.id, title: old.title, messagesLoaded: true }));
  render(<AssistantSessionController {...props} historyPersistence={persistence} />);
  await screen.findByText("区分采样偏差与测量误差。");
  await userEvent.click(screen.getByRole("button", { name: "历史", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "管理 未载入的旧标题" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "重命名对话", exact: true }));
  await userEvent.clear(screen.getByRole("textbox", { name: "会话名称" }));
  await userEvent.type(screen.getByRole("textbox", { name: "会话名称" }), "刚修改的标题");
  // Exercise the real modal isolation before closing, including its deferred ARIA restoration.
  await waitFor(() => expect(screen.queryByRole("button", { name: "打开会话：未载入的旧标题" })).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "保存名称" }));
  const renamedRow = await screen.findByRole("button", { name: "打开会话：刚修改的标题" });
  expect(renamedRow).toBeVisible();
  await userEvent.click(renamedRow);
  await waitFor(() => expect(screen.getByLabelText("当前会话")).toHaveTextContent("刚修改的标题"));
  expect(persistence.loadSession).toHaveBeenCalledWith(old.id);
});


test("home recent conversations exclude generated tasks, which remain available in the task list", async () => {
  const saved = fixture();
  saved.sessions.push({ ...saved.sessions[0], id: "saved-task", kind: "artifact_generation", title: "生成：科研文档", status: "completed" });
  render(<AssistantSessionController {...props} historyPersistence={createAssistantHistoryPersistence({ load: async () => saved, save: async () => {} })} />);
  await screen.findByText("区分采样偏差与测量误差。");
  await userEvent.click(screen.getByRole("button", { name: "首页", exact: true }));
  expect(within(screen.getByLabelText("助手首页")).queryByRole("button", { name: /生成：科研文档/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "任务", exact: true }));
  expect(screen.getByRole("button", { name: "打开会话：生成：科研文档" })).toHaveTextContent("已完成");
});


test.each(["/internal/cache/object-digest.pdf", "org://tenant-uuid/shared-library/paper-uuid"])("paper suggestions do not present internal source locations: %s", async (sourcePath) => {
  let saved = fixture();
  render(<AssistantSessionController {...props} availablePapers={[{ id: "exact-paper-uuid", title: "缓存文献", sourcePath }]}
    historyPersistence={createAssistantHistoryPersistence({ load: async () => saved, save: async snapshot => { saved = snapshot; } })} />);
  await screen.findByText("区分采样偏差与测量误差。");
  await userEvent.type(screen.getByPlaceholderText("输入你的问题或命令"), "@缓存");
  const suggestion = screen.getByRole("button", { name: /缓存文献.*PDF 文献/ });
  expect(suggestion).not.toHaveAttribute("title", expect.stringContaining(sourcePath));
  expect(document.body).not.toHaveTextContent(sourcePath);
  await userEvent.click(suggestion);
  await screen.findByRole("button", { name: "预览上下文：缓存文献" });
  await waitFor(() => expect(saved.draft.tokens[0]).toMatchObject({ id: "paper-exact-paper-uuid", detail: "PDF 文献", resourcePath: "liteasy://papers/exact-paper-uuid?scope=local" }));
});
