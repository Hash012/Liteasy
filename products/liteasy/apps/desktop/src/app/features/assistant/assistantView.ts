import type { AssistantSessionDraft, AssistantSessionHistoryItem } from "./assistantSessionHistory";

/** A projection only: the existing session owner continues executing hidden runs. */
export type AssistantView =
  | { kind: "home" }
  | { kind: "conversation"; conversationId: string }
  | { kind: "history"; filter: "conversations" | "archived" }
  | { kind: "task-list" }
  | { kind: "task-detail"; taskId: string; runId?: string };

export function hasAssistantContent(session: AssistantSessionHistoryItem) {
  return session.kind === "artifact_generation" || !!session.messages.length || !!session.messageCount ||
    !!session.draft?.input.trim() || !!session.draft?.tokens.length || !!session.draft?.readerContexts.length;
}

/** Equality of the persisted semantic content; opaque revisions are never ordered. */
export function assistantContentRevision(session: AssistantSessionHistoryItem, draft: AssistantSessionDraft | undefined = session.draft) {
  const { readAt: _readAt, scrollAnchor: _scroll, updatedAt: _updated, messagesLoaded: _loaded, ...content } = session;
  return JSON.stringify({ ...content, draft });
}
