import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import { createAssistantHistoryPersistence, parseAssistantHistory, type AssistantHistorySnapshot } from "../app/features/assistant/assistantHistoryPersistence";
import { createAssistantSession } from "../app/features/assistant/assistantSessionHistory";

const original: AssistantHistorySnapshot = {
  version: "liteasy.assistant-history/v1", activeSessionId: "saved-chat",
  sessions: [{ ...createAssistantSession({ id: "saved-chat" }), messages: [
    { id: "question", role: "user", content: "已保存的问题" },
    { id: "answer", role: "assistant", content: "已保存的回答" }
  ] }], draft: { input: "未发出的草稿", tokens: [], readerContexts: [] }
};
afterEach(() => localStorage.clear());

test("restores messages, active session and draft after blur and remount without making a model request", async () => {
  let disk: unknown = structuredClone(original);
  const transport = { load: vi.fn(async () => disk), save: vi.fn(async (snapshot) => { disk = structuredClone(snapshot); }) };
  const modelTransport = vi.fn(() => { throw new Error("Restoration must never replay a paid request"); });
  const props = { selectedSetStatus: { selectedCount: 0, importedCount: 0, selectionLocked: false }, onGenerateArtifact: () => "", modelTransport };
  const first = render(<AssistantPane {...props} historyPersistence={createAssistantHistoryPersistence(transport)} />);
  await screen.findByText("已保存的回答");
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("未发出的草稿");
  await userEvent.setup().type(screen.getByPlaceholderText("输入你的问题或命令"), "继续输入");
  fireEvent.blur(window);
  await waitFor(() => expect((disk as AssistantHistorySnapshot).draft.input).toBe("未发出的草稿继续输入"));
  first.unmount();
  render(<AssistantPane {...props} historyPersistence={createAssistantHistoryPersistence(transport)} />);
  await screen.findByText("已保存的问题");
  expect(screen.getByText("已保存的回答")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("未发出的草稿继续输入");
  expect(modelTransport).not.toHaveBeenCalled();
});

test("does not overwrite slow-loading or corrupt history", async () => {
  let resolve!: (value: unknown) => void;
  const save = vi.fn(async () => {});
  const repository = createAssistantHistoryPersistence({ load: () => new Promise((r) => { resolve = r; }), save });
  const loading = repository.load();
  await expect(repository.save(original)).rejects.toThrow("尚未读取");
  resolve({ version: "broken" });
  await expect(loading).rejects.toThrow("原记录已保留");
  expect(save).not.toHaveBeenCalled();
});

test("a failed disk write can be retried and a rapid remount retains the latest memory snapshot", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(undefined);
  const repository = createAssistantHistoryPersistence({ load: async () => null, save });
  await repository.load();
  await expect(repository.save(original)).rejects.toThrow("disk unavailable");
  expect((await repository.load())?.sessions[0].messages).toEqual(original.sessions[0].messages);
  await repository.save(original);
  await repository.flush();
  expect(save).toHaveBeenCalledTimes(2);
});

test("retains partial answers and marks interrupted work without replaying queued actions", () => {
  const snapshot = structuredClone(original);
  snapshot.sessions[0].status = "running";
  snapshot.sessions[0].messages[0].queuedDelivery = { policy: "after_run" };
  const restored = parseAssistantHistory(snapshot)!;
  expect(restored.sessions[0].status).toBe("cancelled");
  expect(restored.sessions[0].messages[0].queuedDelivery).toBeUndefined();
  expect(restored.sessions[0].messages.at(-1)?.content).toContain("上次运行已中断");
});
