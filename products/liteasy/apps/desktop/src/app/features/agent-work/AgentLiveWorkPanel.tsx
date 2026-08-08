import { Button } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toUserVisibleAgentWorkMarkdown } from "../agent-runtime/agentWorkPresentation";
import "./agentLiveWorkPanel.css";

type AgentLiveWorkPanelProps = {
  className?: string;
  floating?: boolean;
  markdown?: string;
  message: string;
  progress?: number | null;
  progressLabel?: string;
  runKey?: string;
  stageLabel?: string;
};

export function AgentLiveWorkPanel({
  className = "",
  floating = false,
  markdown = "",
  message,
  progress,
  progressLabel = "Agent 工作进度",
  runKey,
  stageLabel
}: AgentLiveWorkPanelProps) {
  const [open, setOpen] = useState(true);
  const detailId = useId();
  const visibleMarkdown = toUserVisibleAgentWorkMarkdown(markdown);

  useEffect(() => setOpen(true), [runKey]);

  return (
    <aside
      aria-label="LLM 实时工作窗口"
      aria-live="polite"
      className={`agent-live-work ${floating ? "is-floating" : ""} ${className}`.trim()}
    >
      <div className="agent-live-work__header">
        <span aria-hidden="true" className="agent-live-work__pulse" />
        <div className="agent-live-work__heading">
          <strong>{stageLabel ?? "正在生成"}</strong>
          {message ? <span>{message}</span> : null}
        </div>
        <Button
          appearance="subtle"
          aria-controls={detailId}
          aria-expanded={open}
          aria-label={open ? "收起实时生成内容" : "查看实时生成内容"}
          icon={open ? <ChevronDownRegular /> : <ChevronRightRegular />}
          onClick={() => setOpen((current) => !current)}
          size="small"
        />
      </div>
      {typeof progress === "number" ? (
        <div
          aria-label={progressLabel}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.max(0, Math.min(100, progress))}
          className="agent-live-work__progress"
          role="progressbar"
        >
          <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      ) : null}
      {open ? (
        <div aria-label="实时生成内容" className="agent-live-work__body" id={detailId}>
          {visibleMarkdown ? (
            <ReactMarkdown
              components={{
                a: ({ children }) => <span>{children}</span>
              }}
              remarkPlugins={[remarkGfm]}
            >
              {visibleMarkdown}
            </ReactMarkdown>
          ) : (
            <p>模型正在整理上下文和结构化内容，新的可读片段会显示在这里。</p>
          )}
          <small>仅展示模型主动返回的工作草稿；内部标识、原始结构化载荷与敏感字段已隐藏。</small>
        </div>
      ) : null}
    </aside>
  );
}
