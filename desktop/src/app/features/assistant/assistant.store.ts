import type { AssistantMessage, AssistantMode, AssistantState } from "./assistant.types";
import { invoke } from "@tauri-apps/api/core";

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
    getState() {
      return state;
    },
    async persistConversation(title: string) {
      try {
        await invoke("db_save_conversation", {
          id: `conv-${Date.now()}`,
          paperId: null,
          mode: state.mode,
          title,
          createdAt: new Date().toISOString(),
          messagesJson: JSON.stringify(state.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            citationRefs: null,
            createdAt: new Date().toISOString(),
          }))),
        });
      } catch {}
    },
  };
}
