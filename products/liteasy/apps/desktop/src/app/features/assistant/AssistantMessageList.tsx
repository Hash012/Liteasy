import { displayPath } from "../resource-filesystem/displayPath";
import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import { formatModelExecutionLabel } from "../models/modelExecution";
import type {
  AssistantConfirmationRequest,
  AssistantContextToken,
  AssistantMessage,
  AssistantMode
} from "./assistant.types";
import { compactContextLabel, getAuditVerdictLabel } from "./assistantPresentation";
import { DynamicCanvas } from "../generative-ui/DynamicCanvas";
import type { UIDslActionRef } from "../generative-ui/generativeUi.types";
import { AgentActivityCard } from "./AgentActivityCard";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { PaperAnchorReferences } from "../paper-anchors/PaperAnchorReferences";
import { collectPaperAnchors, formatPaperAnchorText, paperAnchorsFromCitations } from "../paper-anchors/paperAnchorEntity";
import {
  ArrowClockwiseRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  ClockRegular,
  CopyRegular,
  DismissRegular,
  DocumentEditRegular,
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
import { inlineContextParts } from "./inlineContext";

function ExpandableUserMessage({ value, contextTokens = [] }: { value: string; contextTokens?: AssistantContextToken[] }) {
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
        {inlineContextParts(value, contextTokens).map((part, index) => part.token
          ? <strong className="assistant-inline-context" aria-label={part.token.label} title={contextTokenTitle(part.token)} key={index}>{compactContextLabel(part.text)}</strong>
          : part.text)}
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

function contextTokenTitle(token: AssistantContextToken) {
  const detail = token.detail && displayPath(token.detail);
  return detail && detail !== token.label ? `${token.label}\n${detail}` : token.label;
}

function getPublicAuditStatusLabel(status: "blocked" | "passed" | "warning") {
  if (status === "passed") return "通过";
  if (status === "warning") return "注意";
  return "需复核";
}

type AssistantMessageListProps = {
  papers?: Paper[];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenAsset?: (path: string) => void | Promise<void>;
  onResumeArtifactTask?: (taskId: string) => Promise<void>;
  onCancelArtifactTask?: (taskId: string) => void;
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
  onOpenArtifact,
  onOpenAsset,
  onResumeArtifactTask,
  onCancelArtifactTask,
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
  const workbench = useObjectWorkbench();
  const [captureStatus, setCaptureStatus] = useState("");
  const selectedText = useRef("");
  const selectedMessageId = useRef("");
  const captureInput = (message: AssistantMessage) => {
    const paperAnchors = collectPaperAnchors(message.paperAnchors ?? [], paperAnchorsFromCitations(message.citations ?? [], papers, message.id));
    const text = formatPaperAnchorText(getAnswerDisplayText(message.content || message.agentActivity?.generatedContent || ""), paperAnchors);
    const excerpt = selectedMessageId.current === message.id && selectedText.current && text.includes(selectedText.current)
      ? selectedText.current : text;
    return { messageId: message.id, text, excerpt, paperAnchors,
      partial: !!message.agentActivity && message.agentActivity.status !== "completed" };
  };
  if (messages.length === 0) {
    return (
      <div aria-label="AI助手初始消息区" className="assistant-messages assistant-messages-empty" />
    );
  }

  return (
    <div className="assistant-messages" onMouseUp={(event) => {
      if ((event.target as Element).closest("button")) return;
      const selection = window.getSelection();
      selectedText.current = selection?.toString() ?? "";
      selectedMessageId.current = selection?.anchorNode?.parentElement?.closest("[data-message-id]")?.getAttribute("data-message-id") ?? "";
    }}>
      {captureStatus ? <p role="status">{captureStatus}</p> : null}
      {messages.map((message, index) => {
        const paperAnchors = collectPaperAnchors(message.paperAnchors ?? [], paperAnchorsFromCitations(message.citations ?? [], papers, message.id));
        return (
          <article
            aria-label={message.role === "user" ? "你的消息" : "AI 回复"}
            className={`assistant-message-wrap ${message.role}`}
            key={message.id}
            data-message-id={message.id}
          >
            <div className={`assistant-message ${message.role}`}>
              {message.contextTokens?.length ? (
                <div className="assistant-message-token-row">
                  {message.contextTokens.map((token) => (
                    <span className={`assistant-message-token ${token.kind}`} key={token.id} aria-label={token.label} title={contextTokenTitle(token)} tabIndex={0}>
                      <strong>{compactContextLabel(token.label)}</strong>
                    </span>
                  ))}
                </div>
              ) : null}
              {message.agentActivity ? <AgentActivityCard activity={message.agentActivity} onOpenAsset={onOpenAsset} /> : null}
              {message.artifactTask?.artifactId && message.artifactTask.status === "completed" ? (
                <Button onClick={() => onOpenArtifact?.(message.artifactTask!.artifactId!)} size="small">打开薄读</Button>
              ) : message.artifactTask && ["queued", "running"].includes(message.artifactTask.status) ? (
                <Button onClick={() => onCancelArtifactTask?.(message.artifactTask!.id)} size="small">中断薄读</Button>
              ) : message.artifactTask && ["failed", "cancelled"].includes(message.artifactTask.status) && onResumeArtifactTask ? (
                <ResumeReadingButton onResume={() => onResumeArtifactTask(message.artifactTask!.id)} />
              ) : null}
              {message.content &&
              (!message.uiDsl || message.citations?.length || message.audit || message.executionTrace) ? (
                message.role === "assistant" ? (
                  <AssistantMarkdown className="assistant-answer-text assistant-markdown"
                    onOpenLiteasyPath={onOpenAsset}
                    liteasyLinkTitles={new Map(message.assetWrites?.map((asset) => [asset.path, asset.title]))}
                    paperAnchors={paperAnchors}
                    streaming={message.agentActivity?.status === "working"}
                    value={getAnswerDisplayText(message.content)} />
                ) : (
                  <ExpandableUserMessage value={message.content} contextTokens={message.contextTokens} />
                )
              ) : null}
              {message.contextCoverage ? <details className="assistant-context-coverage">
                <summary>本轮读取范围：{message.contextCoverage.full} 项完整读取{message.contextCoverage.partial ? `，${message.contextCoverage.partial} 项选段` : ""}{message.contextCoverage.omitted ? `，${message.contextCoverage.omitted} 项未覆盖` : ""}</summary>
                {message.contextCoverage.partial || message.contextCoverage.omitted ? <p>本轮回答基于已读取内容，不能视为对全部资料的完整审阅。可选择具体页面或缩小范围继续提问。</p> : null}
                <ul>{message.contextCoverage.items.map((item, index) => <li key={index}>{item.title} · {{ full: "完整", partial: "部分", omitted: "未读取" }[item.status]}（{item.includedCharacters.toLocaleString()} / {item.totalCharacters.toLocaleString()} 字符）</li>)}</ul>
              </details> : null}
              {message.assetWrites?.length ? <div className="assistant-asset-writes" aria-label="已保存的资产修改">
                {message.assetWrites.map((write, writeIndex) => <div className="assistant-asset-write" key={`${write.path}-${writeIndex}`}>
                  <DocumentEditRegular aria-hidden="true" />
                  <div className="assistant-asset-write-description">
                    <strong>{write.changed ? "已更新" : "已核对"} {write.title}</strong>
                    <span className="assistant-asset-write-counts"><span>+{write.addedLines}</span><span>−{write.removedLines}</span><small>行</small></span>
                    {write.warnings?.map((warning, warningIndex) => <small key={warningIndex}>{warning}</small>)}
                  </div>
                  {onOpenAsset ? <Button appearance="subtle" size="small" onClick={() => {
                    void Promise.resolve().then(() => onOpenAsset(write.path)).catch((error) =>
                      setCaptureStatus(error instanceof Error ? error.message : "暂时无法打开此资产。"));
                  }}>查看</Button> : null}
                </div>)}
              </div> : null}
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
                  paperAnchors={paperAnchors}
                  onOpenPaperAnchor={onOpenCitation ? (anchor) => {
                    const citation = message.citations?.find((entry) => entry.paperId === anchor.source.paperId &&
                      entry.page === anchor.locator.page && entry.snippet === anchor.snapshot.quote);
                    if (citation) onOpenCitation(citation);
                  } : undefined}
                  onAction={(action) => onDynamicAction?.(action, message.uiDsl?.audit.traceId ?? "")}
                />
              ) : null}
              <PaperAnchorReferences anchors={paperAnchors} className="assistant-citation-card"
                onOpen={onOpenCitation ? (anchor) => {
                  const citation = message.citations?.find((entry) => entry.paperId === anchor.source.paperId &&
                    entry.page === anchor.locator.page && entry.snippet === anchor.snapshot.quote);
                  if (citation) onOpenCitation(citation);
                } : undefined} />
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
                <details className="assistant-execution-trace"><summary>生成信息</summary>
                  使用模型：{formatModelExecutionLabel(message.executionTrace)}
                </details>
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
                  {workbench ? <>
                    <Tooltip content="保存所选文字；未选中时保存整段回答。也可以拖入白板。" relationship="description">
                      <Button size="small" draggable
                        onDragStart={(event) => workbench.dragMessage(captureInput(message), event.dataTransfer)}
                        onClick={() => void workbench.captureMessage(captureInput(message), "board")
                          .then(() => setCaptureStatus("回答摘录已保存到白板。"))
                          .catch((e) => setCaptureStatus(e.message))}>
                        加入白板
                      </Button>
                    </Tooltip>
                    <Button size="small"
                      onClick={() => void workbench.captureMessage(captureInput(message), "tray")
                        .catch((e) => setCaptureStatus(e.message))}>
                      加入摘录对话
                    </Button>
                  </> : null}
                  <Tooltip content="复制回复" relationship="description">
                    <button
                      aria-label="复制回复"
                      className="assistant-message-action"
                      onClick={() => void navigator.clipboard?.writeText(formatPaperAnchorText(getAnswerDisplayText(message.content), paperAnchors))}
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

function ResumeReadingButton({ onResume }: { onResume: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div><Button disabled={busy} size="small" onClick={() => {
    setBusy(true); setError("");
    void onResume().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(false));
  }}>继续薄读</Button>{error ? <p role="alert">{error}</p> : null}</div>;
}
