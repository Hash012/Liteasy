import type { createAssistantStore } from "./assistant.store";
import type { AssistantMessage, AssistantMode, AssistantState } from "./assistant.types";

export type AssistantSessionHistoryItem = {
  id: string;
  messages: AssistantMessage[];
  mode: AssistantMode;
  title: string;
};

type ArchiveAssistantSessionInput = {
  currentHistory: AssistantSessionHistoryItem[];
  now?: () => number;
  randomId?: () => string;
  state: AssistantState;
};

type RestoreAssistantSessionInput = {
  history: AssistantSessionHistoryItem[];
  sessionId: string;
  store: ReturnType<typeof createAssistantStore>;
};

function createSessionId(now: () => number, randomId: () => string) {
  return `session-${now()}-${randomId()}`;
}

export function archiveAssistantSession({
  currentHistory,
  now = Date.now,
  randomId = () => Math.random().toString(36).slice(2, 8),
  state
}: ArchiveAssistantSessionInput): AssistantSessionHistoryItem[] {
  if (state.messages.length === 0) {
    return currentHistory;
  }

  const messages = [...state.messages];
  const firstUserMessage = messages.find((message) => message.role === "user");

  return [
    {
      id: createSessionId(now, randomId),
      messages,
      mode: state.mode,
      title: firstUserMessage?.content ?? "未命名会话"
    },
    ...currentHistory
  ];
}

export function restoreAssistantSession({
  history,
  sessionId,
  store
}: RestoreAssistantSessionInput) {
  const session = history.find((historyItem) => historyItem.id === sessionId);
  if (!session) {
    return false;
  }

  store.restoreSession(session.mode, session.messages);
  return true;
}
