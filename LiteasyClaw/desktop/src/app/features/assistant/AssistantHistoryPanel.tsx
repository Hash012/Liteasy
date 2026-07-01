import { getModeLabel } from "./assistantPresentation";
import type { AssistantSessionHistoryItem } from "./assistantSessionHistory";

type AssistantHistoryPanelProps = {
  history: AssistantSessionHistoryItem[];
  onRestoreSession: (sessionId: string) => void;
};

export function AssistantHistoryPanel({ history, onRestoreSession }: AssistantHistoryPanelProps) {
  return (
    <div className="assistant-history-panel" aria-label="历史会话面板">
      <div className="assistant-history-title">历史会话</div>
      {history.length === 0 ? (
        <div className="assistant-history-empty">暂无历史会话。新建会话后，当前对话会进入这里。</div>
      ) : (
        <ul className="assistant-history-list">
          {history.map((session) => (
            <li className="assistant-history-item" key={session.id}>
              <button
                className="assistant-history-restore"
                onClick={() => onRestoreSession(session.id)}
                type="button"
              >
                恢复会话：{session.title}
              </button>
              <div className="assistant-history-item-meta">
                {session.messages.length} 条消息 · {getModeLabel(session.mode)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
