import { Button } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toUserVisibleAgentActivityText } from "./agentActivity";
import type { AgentActivity } from "./assistant.types";

type AgentActivityCardProps = {
  activity: AgentActivity;
};

const entryKindLabels = {
  analysis: "分析",
  output: "输出",
  tool: "工具"
} as const;

export function AgentActivityCard({ activity }: AgentActivityCardProps) {
  const [expanded, setExpanded] = useState(activity.status === "working");
  const detailId = useId();
  const generatedContent = toUserVisibleAgentActivityText(activity.generatedContent);
  const entries = activity.entries.map((entry) => ({
    ...entry,
    content: entry.content ? toUserVisibleAgentActivityText(entry.content) : undefined,
    label: toUserVisibleAgentActivityText(entry.label) || entryKindLabels[entry.kind]
  }));
  const hasDetails = Boolean(generatedContent || entries.length);

  return (
    <section aria-label="Agent 工作状态" className={`assistant-agent-activity ${activity.status}`}>
      <div className="assistant-agent-activity-header">
        <span aria-hidden="true" className="assistant-agent-activity-status" />
        <div>
          <strong>{activity.statusText}</strong>
          {typeof activity.progress === "number" ? <span>{Math.round(activity.progress)}%</span> : null}
        </div>
        {hasDetails ? (
          <Button
            appearance="subtle"
            aria-controls={detailId}
            aria-expanded={expanded}
            className="assistant-agent-activity-toggle"
            icon={expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
            onClick={() => setExpanded((current) => !current)}
            size="small"
          >
            {expanded ? "收起工作详情" : "查看工作详情"}
          </Button>
        ) : null}
      </div>

      {hasDetails && expanded ? (
        <div className="assistant-agent-activity-details" id={detailId}>
          {generatedContent ? (
            <section aria-label="实时生成内容" className="assistant-agent-activity-stream">
              <h4>实时生成内容</h4>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{generatedContent}</ReactMarkdown>
            </section>
          ) : null}
          {entries.length ? (
            <section aria-label="工具调用和输出" className="assistant-agent-activity-log">
              <h4>工具调用和输出</h4>
              <ol>
                {entries.map((entry) => (
                  <li className={`${entry.kind} ${entry.status}`} key={entry.id}>
                    <span>{entryKindLabels[entry.kind]}</span>
                    <strong>{entry.label}</strong>
                    {entry.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
