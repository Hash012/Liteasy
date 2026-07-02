import { useState } from "react";
import { formatAgentRuntimeContextSummary } from "../agent-runtime/contextView";
import type { AgentRuntimeContextView, RuntimeContextIssue } from "../agent-runtime/agentRuntime.types";

type AssistantContextPanelProps = {
  context: AgentRuntimeContextView;
};

function getWorkspaceLabel(context: AgentRuntimeContextView) {
  const typeLabel =
    context.workspace.type === "organization_shared"
      ? "组织共享文献库"
      : context.workspace.type === "local_library"
        ? "本地文献库"
        : "未知工作区";

  return context.workspace.rootPath ? `${typeLabel} · ${context.workspace.rootPath}` : typeLabel;
}

function getCloudLabel(context: AgentRuntimeContextView) {
  if (!context.cloud.connected) {
    return "未连接";
  }

  return context.cloud.organizationName ? `已连接 · ${context.cloud.organizationName}` : "已连接";
}

function getProfileLabel(context: AgentRuntimeContextView) {
  const enabledLabel = context.profile.enabled ? "画像开启" : "画像关闭";
  const confirmationLabel = context.profile.requiresConfirmation ? "命令需确认" : "命令可直接执行";

  return `${enabledLabel} · ${confirmationLabel}`;
}

function getIssueLabel(issue: RuntimeContextIssue) {
  const labels: Record<RuntimeContextIssue, string> = {
    documents_not_imported: "需导入",
    selection_empty: "未选择",
    selection_unlocked: "需锁定",
    workspace_unknown: "工作区未知"
  };

  return labels[issue];
}

export function AssistantContextPanel({ context }: AssistantContextPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = formatAgentRuntimeContextSummary(context);

  return (
    <section className="assistant-context-panel" aria-label="运行时上下文">
      <button
        aria-expanded={expanded}
        className="assistant-context-toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span>运行时上下文</span>
        <span className="assistant-context-summary">{summary}</span>
      </button>

      {expanded ? (
        <div aria-label="运行时上下文详情" className="assistant-context-details">
          <div className="assistant-context-group">
            <div className="assistant-context-heading">Selection</div>
            <div>
              {`${context.selection.selectedCount} 篇 · ${
                context.selection.locked ? "已锁定" : "未锁定"
              } · 已导入 ${context.selection.importedCount}/${context.selection.selectedCount}`}
            </div>
            {context.selection.issues.length > 0 ? (
              <div className="assistant-context-issues">
                {context.selection.issues.map((issue) => (
                  <span key={issue}>{getIssueLabel(issue)}</span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="assistant-context-group">
            <div className="assistant-context-heading">Workspace</div>
            <div>{getWorkspaceLabel(context)}</div>
          </div>
          <div className="assistant-context-group">
            <div className="assistant-context-heading">Cloud</div>
            <div>{getCloudLabel(context)}</div>
          </div>
          <div className="assistant-context-group">
            <div className="assistant-context-heading">Profile</div>
            <div>{getProfileLabel(context)}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
