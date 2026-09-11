import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AssistantSessionHistoryItem } from "./assistantSessionHistory";
import type { AssistantContextToken } from "./assistant.types";
import type { ReaderConversationContext } from "./assistantContext.types";

export const assistantHistoryStorageKey = "liteasy.assistant-history.v1";
export type AssistantHistorySnapshot = {
  version: "liteasy.assistant-history/v1";
  activeSessionId: string;
  sessions: AssistantSessionHistoryItem[];
  draft: { input: string; tokens: AssistantContextToken[]; readerContexts: ReaderConversationContext[] };
};
type Transport = { load(): Promise<unknown>; save(snapshot: AssistantHistorySnapshot): Promise<void> };

export function parseAssistantHistory(value: unknown): AssistantHistorySnapshot | null {
  if (value === null || value === undefined) return null;
  const snapshot = value as AssistantHistorySnapshot;
  if (snapshot.version !== "liteasy.assistant-history/v1" || !Array.isArray(snapshot.sessions) ||
    typeof snapshot.activeSessionId !== "string" || !snapshot.sessions.every((session) =>
      typeof session.id === "string" && typeof session.title === "string" &&
      ["qa", "command", "explain"].includes(session.mode) && Array.isArray(session.messages) &&
      session.messages.every((message) => typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string"))) {
    throw new Error("对话历史格式损坏，原记录已保留，未用空会话覆盖。");
  }
  return {
    ...snapshot,
    draft: snapshot.draft && typeof snapshot.draft.input === "string" &&
      Array.isArray(snapshot.draft.tokens) && Array.isArray(snapshot.draft.readerContexts)
      ? snapshot.draft : { input: "", tokens: [], readerContexts: [] },
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      status: session.status === "running" ? "cancelled" : session.status,
      messages: session.messages.map(({ queuedDelivery: _queued, confirmation: _confirmation, ...message }) => ({
        ...message,
        ...(message.artifactTask && ["queued", "running"].includes(message.artifactTask.status) ? {
          artifactTask: { ...message.artifactTask, status: "cancelled" as const }
        } : {}),
        ...(message.agentActivity?.status === "working" ? { agentActivity: {
          ...message.agentActivity, status: "cancelled" as const,
          statusText: "上次运行已中断，可重新发送以继续", connectionText: "连接已结束",
          entries: message.agentActivity.entries.map((entry) => entry.status === "running"
            ? { ...entry, status: "failed" as const } : entry)
        } } : {})
      })),
      ...(session.status === "running" && !session.messages.some((message) => message.agentActivity) ? {
        messages: [...session.messages.map(({ queuedDelivery: _queued, confirmation: _confirmation, ...message }) => message), {
          id: `${session.id}:interrupted`, role: "assistant" as const,
          content: "上次运行已中断，已保留现有消息；可重新发送以继续。"
        }]
      } : {})
    }))
  };
}

export function createAssistantHistoryPersistence(transport?: Transport) {
  const native = isTauri();
  const activeTransport: Transport = transport ?? {
    load: async () => native ? invoke("load_assistant_history") : JSON.parse(localStorage.getItem(assistantHistoryStorageKey) ?? "null"),
    save: async (snapshot) => {
      if (native) await invoke("save_assistant_history", { snapshot });
      else localStorage.setItem(assistantHistoryStorageKey, JSON.stringify(snapshot));
    }
  };
  let loaded = false;
  let cached: AssistantHistorySnapshot | null = null;
  let loading: Promise<AssistantHistorySnapshot | null> | undefined;
  let queue = Promise.resolve();
  let revision = 0;
  let savedRevision = -1;
  return {
    async load() {
      if (loaded) return parseAssistantHistory(cached);
      loading ??= activeTransport.load().then((value) => {
        cached = parseAssistantHistory(value);
        loaded = true;
        return cached;
      }).finally(() => { loading = undefined; });
      return loading;
    },
    save(snapshot: AssistantHistorySnapshot) {
      if (!loaded) return Promise.reject(new Error("对话历史尚未读取，已阻止覆盖。"));
      cached = structuredClone(snapshot);
      revision += 1;
      // A failed write must not poison subsequent saves. Keep the latest memory
      // snapshot so docking/remounting cannot erase the conversation either.
      queue = queue.catch(() => {}).then(async () => {
        if (savedRevision === revision) return;
        const savingRevision = revision;
        await activeTransport.save(cached!);
        savedRevision = savingRevision;
      });
      return queue;
    },
    flush() { return queue; }
  };
}
export type AssistantHistoryPersistence = ReturnType<typeof createAssistantHistoryPersistence>;
