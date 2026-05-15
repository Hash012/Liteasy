import { archiveAssistantSession, restoreAssistantSession } from "../app/features/assistant/assistantSessionHistory";
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

