import type { AssistantMessage, AssistantMode, AssistantState } from "./assistant.types";

export function createAssistantStore() {
  const state: AssistantState = {
    mode: "command",
    messages: [],
    pending: false
  };

  return {
    setMode(mode: AssistantMode) {
      state.mode = mode;
    },
    addMessage(message: AssistantMessage) {
      state.messages.push(message);
    },
    setPending(pending: boolean) {
      state.pending = pending;
    },
    clearMessages() {
      state.messages = [];
    },
    getState() {
      return state;
    }
  };
}
