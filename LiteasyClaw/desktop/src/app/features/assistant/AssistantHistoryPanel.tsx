import { getModeLabel } from "./assistantPresentation";
import type { AssistantSessionHistoryItem } from "./assistantSessionHistory";

type AssistantHistoryPanelProps = {
  activeSessionId?: string;
  history: AssistantSessionHistoryItem[];
  onOpenSession?: (sessionId: string) => void;
  onRestoreSession?: (sessionId: string) => void;
};

const kindLabels = {
  artifact_generation: "产物生成",
  conversation: "普通对话"
} as const;

const statusLabels = {
  cancelled: "已终止",
  completed: "已完成",
  failed: "失败",
  idle: "可继续",
  running: "运行中"
} as const;

export function AssistantHistoryPanel({
  activeSessionId,
  history,
  onOpenSession,
  onRestoreSession
}: AssistantHistoryPanelProps) {
  const openSession = onOpenSession ?? onRestoreSession;

  return (
    <div className="assistant-history-panel" aria-label="历史会话面板">
      <div className="assistant-history-title">历史会话</div>
      {history.length === 0 ? (
        <div className="assistant-history-empty">暂无历史会话。新建会话后，当前对话会进入这里。</div>
      ) : (
        <ul className="assistant-history-list">
          {history.map((session) => (
            <li
              className={`assistant-history-item${session.id === activeSessionId ? " active" : ""}`}
              key={session.id}
            >
              <button
                className="assistant-history-restore"
                onClick={() => openSession?.(session.id)}
                type="button"
              >
                {session.id === activeSessionId
                  ? "当前会话："
                  : onOpenSession
                    ? "打开会话："
                    : "恢复会话："}
                {session.title}
              </button>
              <div className="assistant-history-item-meta">
                <span>{session.messages.length} 条消息 · {getModeLabel(session.mode)}</span>
                <span className="assistant-history-item-kind">
                  {kindLabels[session.kind ?? "conversation"]} · {statusLabels[session.status ?? "idle"]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
