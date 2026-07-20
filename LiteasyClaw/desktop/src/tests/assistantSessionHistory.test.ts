import {
  archiveAssistantSession,
  createArtifactTaskSession,
  createAssistantSession,
  restoreAssistantSession,
  snapshotAssistantSession,
  upsertAssistantSession
} from "../app/features/assistant/assistantSessionHistory";
import { createAssistantStore } from "../app/features/assistant/assistant.store";
import type { AssistantMessage } from "../app/features/assistant/assistant.types";

function message(id: string, role: AssistantMessage["role"], content: string): AssistantMessage {
  return { id, role, content };
}

test("archives the current assistant store state with a user-title snapshot", () => {
  const store = createAssistantStore();
  const now = () => 42;
  const randomId = () => "fixed";

  store.setMode("qa");
  store.addMessage(message("assistant-1", "assistant", "欢迎"));
  store.addMessage(message("user-1", "user", "解释注意力机制"));

  const history = archiveAssistantSession({
    currentHistory: [],
    randomId,
    state: store.getState(),
    now
  });

  expect(history).toEqual([
    {
      id: "session-42-fixed",
      messages: [
        message("assistant-1", "assistant", "欢迎"),
        message("user-1", "user", "解释注意力机制")
      ],
      mode: "qa",
      title: "解释注意力机制"
    }
  ]);
});

test("does not archive an empty assistant session", () => {
  const store = createAssistantStore();

  const history = archiveAssistantSession({
    currentHistory: [],
    randomId: () => "unused",
    state: store.getState(),
    now: () => 42
  });

  expect(history).toEqual([]);
});

test("restores an archived assistant session by id", () => {
  const store = createAssistantStore();
  const archivedMessages = [message("user-1", "user", "历史问题")];

  const restored = restoreAssistantSession({
    history: [
      {
        id: "session-1",
        messages: archivedMessages,
        mode: "explain",
        title: "历史问题"
      }
    ],
    sessionId: "session-1",
    store
  });

  expect(restored).toBe(true);
  expect(store.getState()).toEqual({
    messages: archivedMessages,
    mode: "explain",
    pending: false
  });
});

test("updates one stable conversation session instead of creating archive copies", () => {
  const session = createAssistantSession({
    id: "session-current",
    mode: "qa",
    now: () => 0
  });
  const updated = snapshotAssistantSession({
    now: () => 1,
    session,
    state: {
      messages: [message("user-1", "user", "解释 MaxSim")],
      mode: "qa",
      pending: false
    }
  });

  const sessions = upsertAssistantSession([session], updated);

  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    id: "session-current",
    kind: "conversation",
    title: "解释 MaxSim"
  });
  expect(sessions[0].messages).toEqual([message("user-1", "user", "解释 MaxSim")]);
});

test("projects artifact progress into a stable generation session", () => {
  const running = createArtifactTaskSession({
    id: "task-1",
    message: "正在生成",
    partialAnswer: "- ColBERT",
    progress: 45,
    stage: "generating_answer",
    status: "running",
    type: "tree"
  }, undefined, () => 0);
  const completed = createArtifactTaskSession({
    id: "task-1",
    message: "已保存",
    partialAnswer: "完整结果",
    progress: 100,
    stage: "completed",
    status: "completed",
    type: "tree"
  }, running, () => 1);

  expect(completed.id).toBe(running.id);
  expect(completed.createdAt).toBe(running.createdAt);
  expect(completed.kind).toBe("artifact_generation");
  expect(completed.status).toBe("completed");
  expect(completed.messages[1].content).toContain("进度：100%");
  expect(completed.messages[1].content).toContain("完整结果");
});
