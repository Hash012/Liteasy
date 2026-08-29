import { Button } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toUserVisibleAgentActivityText } from "./agentActivity";
import { isHighSalienceAgentEntry, previewAgentWorkText, summarizeAgentActivity } from "./agentActivityPresentation";
import type { AgentActivity, AgentActivityEntry } from "./assistant.types";

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
  const activitySummary = summarizeAgentActivity(activity);

  useEffect(() => {
    if (activity.status !== "working") {
      setExpanded(false);
    }
  }, [activity.status]);

  return (
    <section aria-label="Agent 工作状态" className={`assistant-agent-activity ${activity.status}`}>
      <div className="assistant-agent-activity-header">
        <span aria-hidden="true" className="assistant-agent-activity-status" />
        <div>
          <strong>{activity.statusText}</strong>
          {typeof activity.progress === "number" ? <span>{Math.round(activity.progress)}%</span> : null}
          <span className="assistant-agent-activity-summary">{activitySummary}</span>
        </div>
        {hasDetails ? (
          <Button
            appearance="subtle"
            aria-controls={detailId}
            aria-expanded={expanded}
            aria-label={expanded ? "收起工作详情" : "查看工作详情"}
            title={activitySummary}
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
              <AgentActivityDisclosure content={generatedContent} />
            </section>
          ) : null}
          {entries.length ? (
            <section aria-label="工具调用和输出" className="assistant-agent-activity-log">
              <h4>工具调用和输出</h4>
              <ol>
                {entries.map((entry) => (
                  <li className={`${entry.kind} ${entry.status}`} key={entry.id}>
                    <span>{entryKindLabels[entry.kind]}</span>
                    {entry.content ? (
                      <AgentEntryDisclosure entry={entry} />
                    ) : <strong>{entry.label}</strong>}
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

function AgentActivityDisclosure({ content }: { content: string }) {
  const preview = previewAgentWorkText(content);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = !preview.omittedLines;
  }, []);
  return (
    <details className="assistant-agent-activity-disclosure" ref={detailsRef}>
      <summary>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.text}</ReactMarkdown>
        {preview.omittedLines ? <span className="assistant-agent-activity-more">展开全部（省略 {preview.omittedLines} 行）</span> : null}
      </summary>
      {preview.omittedLines ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown> : null}
    </details>
  );
}

function AgentEntryDisclosure({ entry }: { entry: AgentActivityEntry }) {
  const content = entry.content ?? "";
  const preview = previewAgentWorkText(content);
  const open = isHighSalienceAgentEntry(entry) || !preview.omittedLines;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = open;
  }, []);
  return (
    <details ref={detailsRef}>
      <summary>
        <strong>{entry.label}</strong>
        {preview.omittedLines ? (
          <span className="assistant-agent-activity-entry-preview">{preview.text}</span>
        ) : null}
      </summary>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      {preview.omittedLines ? <span className="assistant-agent-activity-more">已展开全部内容（原先省略 {preview.omittedLines} 行）</span> : null}
    </details>
  );
}
