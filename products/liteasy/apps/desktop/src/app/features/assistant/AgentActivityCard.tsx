import { Button, Tooltip } from "@fluentui/react-components";
import {
  CheckmarkCircleRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  CircleRegular,
  ErrorCircleRegular,
  PlugConnectedRegular
} from "@fluentui/react-icons";
import { useEffect, useId, useMemo, useState } from "react";
import { toUserVisibleAgentActivityText } from "./agentActivity";
import type { AgentActivity } from "./assistant.types";
import { AssistantMarkdown } from "./AssistantMarkdown";

type AgentActivityCardProps = {
  activity: AgentActivity;
};

const entryKindLabels = {
  analysis: "分析",
  connection: "连接",
  output: "输出",
  runtime: "链路",
  tool: "工具"
} as const;

function EntryStatusIcon({ status }: { status: AgentActivity["entries"][number]["status"] }) {
  if (status === "completed") return <CheckmarkCircleRegular aria-hidden="true" />;
  if (status === "failed") return <ErrorCircleRegular aria-hidden="true" />;
  return <CircleRegular aria-hidden="true" />;
}

export function AgentActivityCard({ activity }: AgentActivityCardProps) {
  const regionId = useId();
  const [expanded, setExpanded] = useState(true);
  const runningIds = useMemo(
    () => activity.entries.filter((entry) => entry.status === "running").map((entry) => entry.id),
    [activity.entries]
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(activity.status === "working" ? runningIds : [])
  );
  const entries = activity.entries.map((entry) => ({
    ...entry,
    content: entry.content ? toUserVisibleAgentActivityText(entry.content) : undefined,
    label: toUserVisibleAgentActivityText(entry.label) || entryKindLabels[entry.kind]
  }));

  useEffect(() => {
    if (activity.status !== "working") {
      setExpandedIds(new Set());
      return;
    }
    setExpandedIds(new Set(runningIds));
  }, [activity.status, runningIds.join("|")]);

  function toggleEntry(entryId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  return (
    <section aria-label="Agent 工作状态" className={`assistant-agent-activity ${activity.status}`}>
      <div className="assistant-agent-connection" role="status">
        <PlugConnectedRegular aria-hidden="true" />
        <span>{activity.connectionText ?? (
          activity.status === "working" ? "已连接 · 正在接收 Agent 事件" : "连接已结束"
        )}</span>
      </div>
      <Button
        appearance="subtle"
        aria-controls={regionId}
        aria-expanded={expanded}
        aria-label="查看 Agent 执行过程"
        className="assistant-agent-activity-header"
        icon={expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        onClick={() => setExpanded((current) => !current)}
        size="small"
      >
        <span aria-hidden="true" className="assistant-agent-activity-status" />
        <div>
          <strong>{activity.statusText}</strong>
        </div>
      </Button>

      <div hidden={!expanded} id={regionId}>
        {entries.length ? (
          <ol aria-label="Agent 执行步骤" className="assistant-agent-step-list">
            {entries.map((entry) => {
              const expanded = expandedIds.has(entry.id);
              const detailId = `${regionId}-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
              return (
                <li className={`${entry.kind} ${entry.status}`} key={entry.id}>
                  <Button
                    appearance="subtle"
                    aria-controls={entry.content ? detailId : undefined}
                    aria-expanded={entry.content ? expanded : undefined}
                    className="assistant-agent-step-toggle"
                    icon={entry.content
                      ? expanded ? <ChevronDownRegular /> : <ChevronRightRegular />
                      : <EntryStatusIcon status={entry.status} />}
                    onClick={() => entry.content && toggleEntry(entry.id)}
                    size="small"
                  >
                    <span className="assistant-agent-step-label">
                      <small>{entryKindLabels[entry.kind]}</small>
                      <strong>{entry.label}</strong>
                    </span>
                  </Button>
                  {entry.status === "running" ? (
                    <Tooltip content="当前正在执行" relationship="label">
                      <span aria-label="当前正在执行" className="assistant-agent-step-running" />
                    </Tooltip>
                  ) : null}
                  {entry.content && expanded ? (
                    <div className="assistant-agent-step-detail" id={detailId}>
                      <AssistantMarkdown value={entry.content} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : <p className="assistant-agent-step-detail">本次运行未返回可展示的过程摘要。</p>}
      </div>
    </section>
  );
}
