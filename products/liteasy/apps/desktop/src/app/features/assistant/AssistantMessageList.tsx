import { ContextualActions, IconAction } from "../../shared/ui/productPrimitives";
import { VisuallyHidden } from "../../shared/ui/VisuallyHidden";
import { copyAnswerWithEvidence } from "../evidence/evidenceCopy";
import { MessageEvidence } from "../evidence/components/MessageEvidence";
import { displayPath } from "../resource-filesystem/displayPath";
import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import { formatModelExecutionLabel } from "../models/modelExecution";
import type {
  AssistantConfirmationRequest,
  AssistantContextToken,
  AssistantMessage,
  AssistantMode
} from "./assistant.types";
import { compactContextLabel } from "./assistantPresentation";
import { DynamicCanvas } from "../generative-ui/DynamicCanvas";
import type { UIDslActionRef } from "../generative-ui/generativeUi.types";
import { AgentActivityCard } from "./AgentActivityCard";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { collectPaperAnchors, paperAnchorsFromCitations } from "../paper-anchors/paperAnchorEntity";
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
  SaveRegular,
  StarRegular
} from "@fluentui/react-icons";
import { Button, Tooltip, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem } from "@fluentui/react-components";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getAnswerDisplayText } from "./answerFormatter";
import type { Paper } from "../workspace/workspace.types";
import type { Citation } from "../retrieval/retrieval.types";
import { AssistantUserMarkdown } from "./AssistantUserMarkdown";

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
        <AssistantUserMarkdown value={value} tokens={contextTokens} />
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

type AssistantMessageListProps = {
  targetId?: string;
  scrollAnchor?: { messageId: string; offset: number };
  onScrollAnchor?: (anchor: { messageId: string; offset: number }) => void;
  onOpenTask?: (taskId: string) => void;
  papers?: Paper[];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenAsset?: import("../resource-filesystem/assetNavigation").OpenAgentAsset;
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
  targetId,
  scrollAnchor,
  onScrollAnchor,
  onOpenTask,
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
  const listRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const anchors = useRef(new Map<string, { messageId: string; offset: number }>());
  const [newContent, setNewContent] = useState(false);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const anchor = anchors.current.get(targetId ?? "") ?? scrollAnchor;
    const message = anchor ? [...list.querySelectorAll<HTMLElement>("[data-message-id]")].find((item) => item.dataset.messageId === anchor.messageId) : undefined;
    if (message && anchor) list.scrollTop = message.offsetTop - list.offsetTop - anchor.offset;
    else list.scrollTop = list.scrollHeight;
    followingRef.current = list.scrollHeight - list.clientHeight - list.scrollTop < 32;
    setNewContent(false);
  }, [targetId]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (followingRef.current) list.scrollTop = list.scrollHeight;
    else setNewContent(true);
  }, [messages]);
  const workbench = useObjectWorkbench();
  const [actionMenu, setActionMenu] = useState<string>();
  const [captureStatus, setCaptureStatus] = useState("");
  const selectedText = useRef("");
  const selectedMessageId = useRef("");
  const captureInput = (message: AssistantMessage) => {
    const paperAnchors = collectPaperAnchors(message.paperAnchors ?? [], paperAnchorsFromCitations(message.citations ?? [], papers, message.id));
    const text = copyAnswerWithEvidence({ ...message, content: message.content || message.agentActivity?.generatedContent || "" }, paperAnchors, workbench?.scopeId);
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
    <div className="assistant-messages" ref={listRef} role="log" aria-label="对话消息" aria-live="off" onScroll={() => {
      const list = listRef.current;
      if (!list) return;
      followingRef.current = list.scrollHeight - list.clientHeight - list.scrollTop < 32;
      if (followingRef.current) setNewContent(false);
      const top = list.getBoundingClientRect().top;
      const message = [...list.querySelectorAll<HTMLElement>("[data-message-id]")].find((item) => item.getBoundingClientRect().bottom > top);
      if (message?.dataset.messageId) {
        const anchor = { messageId: message.dataset.messageId, offset: message.getBoundingClientRect().top - top };
        anchors.current.set(targetId ?? "", anchor); onScrollAnchor?.(anchor);
      }
    }} onMouseUp={(event) => {
      if ((event.target as Element).closest("button")) return;
      const selection = window.getSelection();
      selectedText.current = selection?.toString() ?? "";
      selectedMessageId.current = selection?.anchorNode?.parentElement?.closest("[data-message-id]")?.getAttribute("data-message-id") ?? "";
    }}>
      {newContent ? <Button className="assistant-new-content" size="small" onClick={() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; followingRef.current = true; setNewContent(false); }}>有新内容 · 返回底部</Button> : null}
      <VisuallyHidden role="status">{new Set(messages.filter((message) => message.role === "assistant" && !message.artifactTask && !message.confirmation && (!message.kind || message.kind === "assistant_message") && (message.agentActivity?.status === "completed" || message.turnOutcome === "completed")).map((message) => message.runId ?? message.id)).size} 条完整回复</VisuallyHidden>
      {captureStatus ? <p role="status">{captureStatus}</p> : null}
      {messages.map((message, index) => {
        if (message.kind === "task_reference" && message.taskReference) return <article key={message.id} data-message-id={message.id} className="assistant-task-reference" aria-label="任务引用">
          <strong>{message.taskReference.title}</strong><Button size="small" onClick={() => onOpenTask?.(message.taskReference!.taskId)}>查看任务</Button>
        </article>;
        const paperAnchors = collectPaperAnchors(message.paperAnchors ?? [], paperAnchorsFromCitations(message.citations ?? [], papers, message.id));
        return (
          <article
            aria-label={message.role === "user" ? "你的消息" : "AI 回复"}
            className={`assistant-message-wrap product-contextual-owner ${message.role}`}
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
                    <Menu><MenuTrigger disableButtonEnhancement><Button size="small" disabled={message.queuedDelivery.policy === "interrupt"}>更改执行方式</Button></MenuTrigger><MenuPopover><MenuList>
                      <MenuItem icon={<FlashRegular />} disabled={message.queuedDelivery.policy === "interrupt"} onClick={() => onInterruptForQueuedMessage?.(message.id)}>立即中断并执行</MenuItem>
                      <MenuItem icon={<ClockRegular />} disabled={message.queuedDelivery.policy === "after_run"} onClick={() => onWaitForRunForQueuedMessage?.(message.id)}>本轮完成后执行</MenuItem>
                    </MenuList></MenuPopover></Menu>
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
              {message.role === "assistant" ? <MessageEvidence message={message} papers={papers}
                onOpenAsset={onOpenAsset} onOpenCitation={onOpenCitation} /> : null}
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
            <ContextualActions label="消息操作" className="assistant-message-actions" menuOpen={actionMenu === message.id}>
              {message.role === "user" ? (
                <>
                  <IconAction density="compact"
                    label="复制消息"
                    className="assistant-message-action"
                    onClick={() => {
                      const tokenText =
                        message.contextTokens?.map((token) => `[${token.label}]`).join(" ") ?? "";
                      void navigator.clipboard?.writeText(
                        [tokenText, message.content].filter(Boolean).join(" ")
                      );
                    }}
                    description="复制"
                    type="button"
                   icon={<CopyRegular />} />
                  {!message.queuedDelivery ? <IconAction density="compact"
                    label="编辑消息"
                    className="assistant-message-action"
                    onClick={() => onEditMessage?.(message.id)}
                    description="编辑"
                    type="button"
                   icon={<EditRegular />} /> : null}
                  {!message.queuedDelivery ? <IconAction density="compact"
                    label="重试消息"
                    className="assistant-message-action"
                    onClick={() => onRetryUserMessage?.(message.id)}
                    description="重试"
                    type="button"
                   icon={<ArrowClockwiseRegular />} /> : null}
                </>
              ) : null}
              {message.role === "assistant" ? (
                <>
                  {workbench ? <Menu onOpenChange={(_, data) => setActionMenu(data.open ? message.id : undefined)}><MenuTrigger disableButtonEnhancement><IconAction label="保存到…" description="保存所选文字；未选中时保存整段回答。也可以拖入白板。" density="compact" icon={<SaveRegular />} draggable onDragStart={event => workbench.dragMessage(captureInput(message), event.dataTransfer)} /></MenuTrigger><MenuPopover><MenuList>
                    <MenuItem onClick={() => void workbench.captureMessage(captureInput(message), "board").then(() => setCaptureStatus("回答摘录已保存到白板。")).catch(e => setCaptureStatus(e.message))}>加入白板</MenuItem>
                    <MenuItem onClick={() => void workbench.captureMessage(captureInput(message), "tray").catch(e => setCaptureStatus(e.message))}>加入摘录对话</MenuItem>
                  </MenuList></MenuPopover></Menu> : null}
                  <Tooltip content="复制回复" relationship="description">
                    <button
                      aria-label="复制回复"
                      className="assistant-message-action"
                      onClick={() => void navigator.clipboard?.writeText(copyAnswerWithEvidence(message, paperAnchors, workbench?.scopeId))}
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
            </ContextualActions>
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
