import { createAssistantStore } from "../app/features/assistant/assistant.store";

test("defaults to command mode and can switch to qa mode", () => {
  const store = createAssistantStore();

  expect(store.getState().mode).toBe("command");
  store.setMode("qa");
  expect(store.getState().mode).toBe("qa");
});

test("restores a saved assistant session snapshot", () => {
  const store = createAssistantStore();

  store.addMessage({
    content: "旧问题",
    id: "message-1",
    role: "user"
  });
  store.setPending(true);

  store.restoreSession("qa", [
    {
      content: "历史问题",
      id: "history-user",
      role: "user"
    },
    {
      content: "历史回答",
      id: "history-assistant",
      role: "assistant"
    }
  ]);

  expect(store.getState()).toEqual({
    messages: [
      {
        content: "历史问题",
        id: "history-user",
        role: "user"
      },
      {
        content: "历史回答",
        id: "history-assistant",
        role: "assistant"
      }
    ],
    mode: "qa",
    pending: false
  });
});

