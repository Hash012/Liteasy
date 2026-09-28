import { Button } from "@fluentui/react-components";
import {
  CheckmarkCircleRegular, ChevronDownRegular, ChevronRightRegular, CircleRegular,
  ClockRegular, DocumentEditRegular, DocumentSearchRegular, ErrorCircleRegular
} from "@fluentui/react-icons";
import { useEffect, useId, useState } from "react";
import { toUserVisibleAgentActivityText } from "./agentActivity";
import type { AgentActivity, AgentActivityEntry } from "./assistant.types";
import { AssistantMarkdown } from "./AssistantMarkdown";

function entryLabel(entry: AgentActivityEntry) {
  const label = toUserVisibleAgentActivityText(entry.label);
  return /^(模型公开推理|公开推理|模型分析)$/.test(label) ? "整理答复" : label || "工作进展";
}

function EntryIcon({ entry }: { entry: AgentActivityEntry }) {
  if (entry.status === "failed") return <ErrorCircleRegular aria-hidden="true" />;
  if (/写入|更新|创建|保存|编辑/.test(entry.label)) return <DocumentEditRegular aria-hidden="true" />;
  if (/读取|查找|搜索|检索/.test(entry.label)) return <DocumentSearchRegular aria-hidden="true" />;
  if (entry.status === "completed") return <CheckmarkCircleRegular aria-hidden="true" />;
  return <CircleRegular aria-hidden="true" />;
}

function elapsedLabel(activity: AgentActivity, now: number) {
  if (!activity.startedAt || (activity.status !== "working" && !activity.finishedAt)) return "";
  const start = Date.parse(activity.startedAt);
  const end = activity.finishedAt ? Date.parse(activity.finishedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/** A compact work summary; details are real public events, never an invented plan. */
export function AgentActivityCard({ activity }: { activity: AgentActivity }) {
  const regionId = useId();
  const [expanded, setExpanded] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (activity.status !== "working" || !activity.startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activity.status, activity.startedAt]);

  const entries = activity.entries.map((entry) => ({ ...entry, label: entryLabel(entry),
    content: entry.content ? toUserVisibleAgentActivityText(entry.content.replace(/(^|\n)liteasy:\/\/[^\n]+(?=\n|$)/g, "")) : undefined }));
  const current = [...entries].reverse().find((entry) => entry.status === "running");
  const duration = elapsedLabel(activity, now);
  const statusText = activity.status === "working" ? current?.label ?? "正在处理…"
    : ({ completed: "已完成", cancelled: "已停止", failed: "未能完成", waiting: "等待你的操作" } as const)[activity.status];
  const completedOperations = entries.filter((entry) => entry.status === "completed" && ["tool", "output"].includes(entry.kind));

  return <section aria-label="Agent 工作状态" className={`assistant-agent-activity ${activity.status}`}>
    <Button appearance="subtle" aria-controls={regionId} aria-expanded={expanded}
      aria-label="查看 Agent 执行过程" className="assistant-agent-activity-header"
      icon={activity.status === "working" ? <span className="assistant-agent-activity-status" /> : <ClockRegular />}
      onClick={() => setExpanded((value) => !value)} size="small">
      <span className="assistant-agent-summary" role="status">{statusText}{duration ? ` · ${duration}` : ""}</span>
      {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
    </Button>
    {!expanded && completedOperations.length > 0 ? <span className="assistant-agent-operation-summary">
      {completedOperations.slice(-2).map((entry) => entry.label).join(" · ")}
      {completedOperations.length > 2 ? ` · 共 ${completedOperations.length} 项操作` : ""}
    </span> : null}
    <div hidden={!expanded} id={regionId}>
      {entries.length ? <ol aria-label="Agent 执行步骤" className="assistant-agent-step-list">
        {entries.map((entry) => {
          const opened = expandedIds.has(entry.id);
          const detailId = `${regionId}-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          return <li className={`${entry.kind} ${entry.status}`} key={entry.id}>
            <Button appearance="subtle" aria-controls={entry.content ? detailId : undefined}
              aria-expanded={entry.content ? opened : undefined} className="assistant-agent-step-toggle"
              icon={<EntryIcon entry={entry} />} onClick={() => {
                if (!entry.content) return;
                setExpandedIds((previous) => {
                  const next = new Set(previous);
                  if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
                  return next;
                });
              }} size="small">
              <span className="assistant-agent-step-label">{entry.label}</span>
              {entry.content ? opened ? <ChevronDownRegular /> : <ChevronRightRegular /> : null}
            </Button>
            <span className="assistant-agent-step-state">{entry.status === "running" && activity.status !== "working"
              ? activity.status === "cancelled" ? "已停止" : "未完成"
              : { completed: "完成", failed: "失败", running: "进行中", waiting: "等待" }[entry.status]}</span>
            {entry.content && opened ? <div className="assistant-agent-step-detail" id={detailId}>
              <AssistantMarkdown streaming={entry.status === "running"} value={entry.content} />
            </div> : null}
          </li>;
        })}
      </ol> : <p className="assistant-agent-empty">本轮没有使用工具。</p>}
    </div>
  </section>;
}
