import { formatModelExecutionLabel } from "../models/modelExecution";
import type { AssistantMessage, AssistantMode } from "./assistant.types";
import { getAuditVerdictLabel, modeLauncherItems } from "./assistantPresentation";

type AssistantMessageListProps = {
  messages: AssistantMessage[];
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
};

export function AssistantMessageList({ messages, mode, onModeChange }: AssistantMessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="assistant-messages assistant-messages-empty">
        <div
          className="assistant-launcher"
          aria-label="AI助手初始模式入口"
          title="选择一个入口开始会话。"
        >
          <div className="assistant-launcher-modes" aria-label="输入前模式选择">
            {modeLauncherItems.map((item) => (
              <button
                aria-label={`${item.label}模式`}
                className={item.id === mode ? "assistant-launcher-mode active" : "assistant-launcher-mode"}
                key={item.id}
                onClick={() => onModeChange(item.id)}
                title={item.summary}
                type="button"
              >
                <span>{item.label}模式</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="assistant-messages">
      {messages.map((message) => (
        <div className="assistant-message" key={message.id}>
          <div className="assistant-message-title">
            {message.role === "user" ? "你的输入" : "助手回复"}
          </div>
          <div className="assistant-answer-text">{message.content}</div>
          {message.citations?.length ? (
            <div className="assistant-citation-card">
              <strong>原文定位</strong>
              <span>
                {message.citations[0].paperId} · 第 {message.citations[0].page} 页
              </span>
              <span>{message.citations[0].snippet}</span>
              <span>可信度 {message.confidence?.toFixed(2)}</span>
            </div>
          ) : null}
          {message.audit ? (
            <div className={`assistant-audit-card ${message.audit.verdict}`}>
              <strong>模型审计</strong>
              <span>审计模型 {message.audit.model}</span>
              <span>
                审计评分 {message.audit.score.toFixed(2)} · {getAuditVerdictLabel(message.audit.verdict)}
              </span>
              <span>{message.audit.rationale}</span>
            </div>
          ) : null}
          {message.executionTrace ? (
            <div className="assistant-execution-trace">
              模型链路：{formatModelExecutionLabel(message.executionTrace)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
