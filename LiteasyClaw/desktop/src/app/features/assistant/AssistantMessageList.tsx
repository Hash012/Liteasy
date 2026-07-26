import { formatModelExecutionLabel } from "../models/modelExecution";
import type {
  AssistantConfirmationRequest,
  AssistantMessage,
  AssistantMode
} from "./assistant.types";
import { getAuditVerdictLabel } from "./assistantPresentation";
import { DynamicCanvas } from "../generative-ui/DynamicCanvas";
import type { UIDslActionRef } from "../generative-ui/generativeUi.types";

function getPublicAuditStatusLabel(status: "blocked" | "passed" | "warning") {
  if (status === "passed") return "通过";
  if (status === "warning") return "注意";
  return "需复核";
}

type AssistantMessageListProps = {
  messages: AssistantMessage[];
  mode: AssistantMode;
  onConfirmRequest?: (confirmation: AssistantConfirmationRequest) => void;
  onDynamicAction?: (action: UIDslActionRef, traceId: string) => void;
  onEditMessage?: (messageId: string) => void;
  onModeChange: (mode: AssistantMode) => void;
  onRegenerateMessage?: (messageId: string) => void;
  onRejectRequest?: (confirmation: AssistantConfirmationRequest) => void;
  onRetryUserMessage?: (messageId: string) => void;
};

export function AssistantMessageList({
  messages,
  mode,
  onConfirmRequest,
  onDynamicAction,
  onEditMessage,
  onModeChange,
  onRegenerateMessage,
  onRejectRequest,
  onRetryUserMessage
}: AssistantMessageListProps) {
  if (messages.length === 0) {
    return (
      <div aria-label="AI助手初始消息区" className="assistant-messages assistant-messages-empty" />
    );
  }

  return (
    <div className="assistant-messages">
      {messages.map((message, index) => {
        return (
          <div className={`assistant-message ${message.role}`} key={message.id}>
            {message.contextTokens?.length ? (
              <div className="assistant-message-token-row">
                {message.contextTokens.map((token) => (
                  <span className={`assistant-message-token ${token.kind}`} key={token.id}>
                    <strong>{token.label}</strong>
                    {token.detail ? <span>{token.detail}</span> : null}
                  </span>
                ))}
              </div>
            ) : null}
            {message.content &&
            (!message.uiDsl || message.citations?.length || message.audit || message.executionTrace) ? (
              <div className="assistant-answer-text">{message.content}</div>
            ) : null}
            {message.uiDsl ? (
              <DynamicCanvas
                document={message.uiDsl}
                onAction={(action) => onDynamicAction?.(action, message.uiDsl?.audit.traceId ?? "")}
              />
            ) : null}
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
            {message.publicWorkflowAudits?.length ? (
              <div className={`assistant-public-audit-card ${message.publicWorkflowAudits[0].status}`}>
                <strong>公开审计过程</strong>
                {message.publicWorkflowAudits.map((audit, auditIndex) => (
                  <div className="assistant-public-audit-summary" key={`${message.id}-public-audit-${auditIndex}`}>
                    {audit.issueLabels.length ? (
                      <div className="assistant-public-audit-issues">
                        {audit.issueLabels.map((label) => (
                          <span key={label}>{label}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="assistant-public-audit-checks">
                      {audit.checks.map((check) => (
                        <div className="assistant-public-audit-check" key={check.label}>
                          <span>
                            {check.label}：{getPublicAuditStatusLabel(check.status)}
                          </span>
                          {check.summary ? <small>{check.summary}</small> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {message.executionTrace ? (
              <div className="assistant-execution-trace">
                模型链路：{formatModelExecutionLabel(message.executionTrace)}
              </div>
            ) : null}
            {message.confirmation ? (
              <div className="assistant-confirmation-actions">
                <button
                  className="assistant-message-action"
                  onClick={() => onConfirmRequest?.(message.confirmation!)}
                  type="button"
                >
                  确认执行
                </button>
                <button
                  className="assistant-message-action"
                  onClick={() => onRejectRequest?.(message.confirmation!)}
                  type="button"
                >
                  取消
                </button>
              </div>
            ) : null}
            <div className="assistant-message-actions">
              {message.role === "user" ? (
                <>
                  <button
                    aria-label={`复制：${message.content}`}
                    className="assistant-message-action"
                    onClick={() => {
                      const tokenText =
                        message.contextTokens?.map((token) => `[${token.label}]`).join(" ") ?? "";
                      void navigator.clipboard?.writeText(
                        [tokenText, message.content].filter(Boolean).join(" ")
                      );
                    }}
                    title="复制"
                    type="button"
                  >
                    ⧉
                  </button>
                  <button
                    aria-label={`编辑：${message.content}`}
                    className="assistant-message-action"
                    onClick={() => onEditMessage?.(message.id)}
                    title="编辑"
                    type="button"
                  >
                    ✎
                  </button>
                  <button
                    aria-label={`重试：${message.content}`}
                    className="assistant-message-action"
                    onClick={() => onRetryUserMessage?.(message.id)}
                    title="重试"
                    type="button"
                  >
                    ↻
                  </button>
                </>
              ) : null}
              {message.role === "assistant" && onRegenerateMessage ? (
                <button
                  aria-label="重新生成回复"
                  className="assistant-message-action"
                  onClick={() => onRegenerateMessage(message.id)}
                  title="重新生成"
                  type="button"
                >
                  ↻
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
