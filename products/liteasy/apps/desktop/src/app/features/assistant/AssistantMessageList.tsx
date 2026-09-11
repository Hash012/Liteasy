import { formatModelExecutionLabel } from "../models/modelExecution";
import type {
  AssistantConfirmationRequest,
  AssistantMessage,
  AssistantMode
} from "./assistant.types";
import { getAuditVerdictLabel } from "./assistantPresentation";
import { DynamicCanvas } from "../generative-ui/DynamicCanvas";
import type { UIDslActionRef } from "../generative-ui/generativeUi.types";
import { AgentActivityCard } from "./AgentActivityCard";
import { AssistantMarkdown } from "./AssistantMarkdown";
import {
  ArrowClockwiseRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  ClockRegular,
  CopyRegular,
  DismissRegular,
  EditRegular,
  FlashRegular,
  StarFilled,
  StarRegular
} from "@fluentui/react-icons";
import { Button, Tooltip } from "@fluentui/react-components";
import { useEffect, useRef, useState } from "react";
import { getAnswerDisplayText } from "./answerFormatter";
import type { Paper } from "../workspace/workspace.types";
import type { Citation } from "../retrieval/retrieval.types";

function ExpandableUserMessage({ value }: { value: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [foldable, setFoldable] = useState(
    () => value.split(/\r?\n/).length > 5 || value.length > 260
  );

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const updateFoldable = () => {
      const textIsLong = value.split(/\r?\n/).length > 5 || value.length > 260;
      setFoldable(textIsLong || content.scrollHeight > content.clientHeight + 1);
    };
    updateFoldable();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateFoldable);
    observer.observe(content);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div className="assistant-user-message">
      <div
        className={`assistant-answer-text assistant-user-message-content${foldable && !expanded ? " collapsed" : ""}`}
        ref={contentRef}
      >
        {value}
      </div>
      {foldable ? (
        <Button
          appearance="subtle"
          aria-expanded={expanded}
          className="assistant-user-message-toggle"
          icon={expanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
          onClick={() => setExpanded((current) => !current)}
          size="small"
        >
          {expanded ? "收起" : "展开完整消息"}
        </Button>
      ) : null}
    </div>
  );
}

function getPublicAuditStatusLabel(status: "blocked" | "passed" | "warning") {
  if (status === "passed") return "通过";
  if (status === "warning") return "注意";
  return "需复核";
}

type AssistantMessageListProps = {
  papers?: Paper[];
  onOpenCitation?: (citation: Citation) => void;
  messages: AssistantMessage[];
  mode: AssistantMode;
  onConfirmRequest?: (confirmation: AssistantConfirmationRequest) => void;
  onDynamicAction?: (action: UIDslActionRef, traceId: string) => void;
  onEditMessage?: (messageId: string) => void;
  onInterruptForQueuedMessage?: (messageId: string) => void;
  onModeChange: (mode: AssistantMode) => void;
  onRegenerateMessage?: (messageId: string) => void;
  onRejectRequest?: (confirmation: AssistantConfirmationRequest) => void;
  onRetryUserMessage?: (messageId: string) => void;
  onWaitForRunForQueuedMessage?: (messageId: string) => void;
  onWithdrawQueuedMessage?: (messageId: string) => void;
  onToggleFavoriteMessage?: (messageId: string) => void;
};

export function AssistantMessageList({
  papers = [],
  onOpenCitation,
  messages,
  mode,
  onConfirmRequest,
  onDynamicAction,
  onEditMessage,
  onInterruptForQueuedMessage,
  onModeChange,
  onRegenerateMessage,
  onRejectRequest,
  onRetryUserMessage,
  onWaitForRunForQueuedMessage,
  onWithdrawQueuedMessage,
  onToggleFavoriteMessage
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
          <article
            aria-label={message.role === "user" ? "你的消息" : "AI 回复"}
            className={`assistant-message-wrap ${message.role}`}
            key={message.id}
          >
            <div className={`assistant-message ${message.role}`}>
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
              {message.agentActivity ? <AgentActivityCard activity={message.agentActivity} /> : null}
              {message.content &&
              (!message.uiDsl || message.citations?.length || message.audit || message.executionTrace) ? (
                message.role === "assistant" ? (
                  <AssistantMarkdown className="assistant-answer-text assistant-markdown" value={getAnswerDisplayText(message.content)} />
                ) : (
                  <ExpandableUserMessage value={message.content} />
                )
              ) : null}
              {message.role === "user" && message.queuedDelivery ? (
                <div className={`assistant-queued-message ${message.queuedDelivery.policy}`}>
                  <span>
                    {message.queuedDelivery.policy === "interrupt"
                      ? "正在中断当前运行，随后执行这条消息"
                      : message.queuedDelivery.policy === "after_run"
                        ? "已暂存 · 当前回复完成后执行"
                        : "已暂存 · 当前工具调用结束后生效"}
                  </span>
                  <div aria-label="暂存消息操作" className="assistant-queued-message-actions">
                    <Button
                      appearance="subtle"
                      disabled={message.queuedDelivery.policy === "interrupt"}
                      icon={<DismissRegular />}
                      onClick={() => onWithdrawQueuedMessage?.(message.id)}
                      size="small"
                    >
                      撤回
                    </Button>
                    <Button
                      appearance="subtle"
                      disabled={message.queuedDelivery.policy === "interrupt"}
                      icon={<FlashRegular />}
                      onClick={() => onInterruptForQueuedMessage?.(message.id)}
                      size="small"
                    >
                      立即中断并执行
                    </Button>
                    <Button
                      appearance="subtle"
                      disabled={message.queuedDelivery.policy === "after_run"}
                      icon={<ClockRegular />}
                      onClick={() => onWaitForRunForQueuedMessage?.(message.id)}
                      size="small"
                    >
                      本轮完成后执行
                    </Button>
                  </div>
                </div>
              ) : null}
              {message.uiDsl && !message.uiDsl.id.startsWith("ui-answer-") ? (
                <DynamicCanvas
                  document={message.uiDsl}
                  onAction={(action) => onDynamicAction?.(action, message.uiDsl?.audit.traceId ?? "")}
                />
              ) : null}
              {message.citations?.length ? (
                <details className="assistant-citation-card">
                  <summary>查看引用原文</summary>
                  {message.citations.filter((citation, index, citations) => citations.findIndex((other) =>
                    other.paperId === citation.paperId && other.page === citation.page && other.snippet === citation.snippet
                  ) === index).map((citation, citationIndex) => (
                    <div key={`${citation.paperId}-${citation.page}-${citationIndex}`}>
                      <Button appearance="subtle" disabled={!onOpenCitation} onClick={() => onOpenCitation?.(citation)} size="small">
                        {papers.find((paper) => paper.id === citation.paperId)?.title ?? "引用文献"} · 第 {citation.page} 页
                      </Button>
                      <blockquote>{citation.snippet}</blockquote>
                    </div>
                  ))}
                </details>
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
            </div>
            <div aria-label="消息操作" className="assistant-message-actions">
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
                    <CopyRegular aria-hidden="true" />
                  </button>
                  {!message.queuedDelivery ? <button
                    aria-label={`编辑：${message.content}`}
                    className="assistant-message-action"
                    onClick={() => onEditMessage?.(message.id)}
                    title="编辑"
                    type="button"
                  >
                    <EditRegular aria-hidden="true" />
                  </button> : null}
                  {!message.queuedDelivery ? <button
                    aria-label={`重试：${message.content}`}
                    className="assistant-message-action"
                    onClick={() => onRetryUserMessage?.(message.id)}
                    title="重试"
                    type="button"
                  >
                    <ArrowClockwiseRegular aria-hidden="true" />
                  </button> : null}
                </>
              ) : null}
              {message.role === "assistant" ? (
                <>
                  <Tooltip content="复制回复" relationship="description">
                    <button
                      aria-label="复制回复"
                      className="assistant-message-action"
                      onClick={() => void navigator.clipboard?.writeText(getAnswerDisplayText(message.content))}
                      title="复制回复"
                      type="button"
                    >
                      <CopyRegular aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <Tooltip
                    content={message.favorite ? "取消收藏回复" : "收藏回复"}
                    relationship="description"
                  >
                    <button
                      aria-label={message.favorite ? "取消收藏回复" : "收藏回复"}
                      aria-pressed={Boolean(message.favorite)}
                      className={`assistant-message-action${message.favorite ? " active" : ""}`}
                      onClick={() => onToggleFavoriteMessage?.(message.id)}
                      title={message.favorite ? "取消收藏回复" : "收藏回复"}
                      type="button"
                    >
                      {message.favorite
                        ? <StarFilled aria-hidden="true" />
                        : <StarRegular aria-hidden="true" />}
                    </button>
                  </Tooltip>
                  {onRegenerateMessage ? (
                    <Tooltip content="重新生成回复" relationship="description">
                      <button
                        aria-label="重新生成回复"
                        className="assistant-message-action"
                        onClick={() => onRegenerateMessage(message.id)}
                        title="重新生成回复"
                        type="button"
                      >
                        <ArrowClockwiseRegular aria-hidden="true" />
                      </button>
                    </Tooltip>
                  ) : null}
                </>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
