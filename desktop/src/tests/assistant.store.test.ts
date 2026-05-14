import { createAssistantStore } from "../app/features/assistant/assistant.store";

test("defaults to command mode and can switch to qa mode", () => {
  const store = createAssistantStore();

  expect(store.getState().mode).toBe("command");
  store.setMode("qa");
  expect(store.getState().mode).toBe("qa");
});
