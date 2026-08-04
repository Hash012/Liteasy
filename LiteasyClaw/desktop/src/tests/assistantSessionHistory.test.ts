import {
  archiveAssistantSession,
  createArtifactTaskSession,
  createAssistantSession,
  getArtifactTaskSessionId,
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

test("keeps all pages of one thin-reading artifact in its paper-bound session", () => {
  expect(getArtifactTaskSessionId("thin-root", {
    artifactId: "artifact-paper-attention",
    type: "thin_reading"
  })).toBe("artifact:thin-reading:artifact-paper-attention");
  expect(getArtifactTaskSessionId("thin-branch", {
    artifactId: "artifact-paper-attention",
    type: "thin_reading"
  })).toBe("artifact:thin-reading:artifact-paper-attention");
});

test("projects detailed artifact failures into the AI generation session", () => {
  const failed = createArtifactTaskSession({
    failure: {
      endpoint: "http://127.0.0.1:8787",
      failedStage: "generating_answer",
      message: "OpenAI Responses API 请求失败（401）",
      model: "gpt-5.5",
      occurredAt: "2026-07-21T03:00:00.000Z",
      provider: "openai",
      recovery: ["重新配置并重启 dev-cloud。"]
    },
    id: "task-failed",
    message: "Agent 分析失败：OpenAI Responses API 请求失败（401）",
    progress: 55,
    stage: "failed",
    status: "failed",
    type: "tree"
  }, undefined, () => 0);

  expect(failed.status).toBe("failed");
  expect(failed.messages[1].content).toContain("失败诊断");
  expect(failed.messages[1].content).toContain("http://127.0.0.1:8787");
  expect(failed.messages[1].content).toContain("Provider：openai");
  expect(failed.messages[1].content).toContain("Model：gpt-5.5");
  expect(failed.messages[1].content).toContain("重新配置并重启 dev-cloud");
});
