import type { AgentRuntimeContextView } from "../agent-runtime/agentRuntime.types";
import type { AgentCoreCatalogEntry, AgentCoreConfig, AgentMemoryEntry } from "./agentCoreConfig";
import { buildAgentMd } from "./agentMd";

export type AgentCorePromptContext = {
  agentMd: string;
  budgetSummary: string;
  capabilitySummary: string;
  memorySummary: string;
  runtimeSummary: string;
};

function summarizeEntries(label: string, entries: AgentCoreCatalogEntry[]) {
  const body = entries
    .map((entry) => {
      const status = entry.status === "active" ? "active" : entry.status === "review" ? "review" : "planned";
      return `- ${entry.id} (${status}, risk=${entry.risk}): ${entry.description}`;
    })
    .join("\n");

  return [`## ${label}`, body || "- 暂无条目。"].join("\n");
}

function summarizeMemories(memories: AgentMemoryEntry[]) {
  if (memories.length === 0) {
    return "## Memory\n- 当前没有可注入的长期记忆。";
  }

  return [
    "## Memory",
    ...memories.map(
      (memory) =>
        `- [${memory.namespace}/${memory.type}/重要性:${memory.importance}] ${memory.summary}`
    )
  ].join("\n");
}

function summarizeRuntimeContext(contextView?: AgentRuntimeContextView) {
  if (!contextView) {
    return "## Runtime Context\n- 当前没有运行时上下文。";
  }

  return [
    "## Runtime Context",
    `- 选中文献：${contextView.selection.selectedCount} 篇，已导入 ${contextView.selection.importedCount} 篇。`,
    `- 选区锁定：${contextView.selection.locked ? "是" : "否"}。`,
    `- 云账号：${contextView.cloud.connected ? "已连接" : "未连接"}。`,
    `- 画像：${contextView.profile.enabled ? "开启" : "关闭"}。`,
    `- 工作区：${contextView.workspace.type}${contextView.workspace.rootPath ? ` (${contextView.workspace.rootPath})` : ""}。`,
    contextView.selection.issues.length
      ? `- 待补上下文：${contextView.selection.issues.join(", ")}。`
      : "- 当前文献上下文可用于受控规划。"
  ].join("\n");
}

export function buildAgentCorePromptContext(input: {
  config: AgentCoreConfig;
  memories: AgentMemoryEntry[];
  runtimeContext?: AgentRuntimeContextView;
}): AgentCorePromptContext {
  const { config, memories, runtimeContext } = input;

  /*
   * 这里把 Agent 的上下文拆成几个明确分区，而不是拼成一大段散文。
   * 原因和《Agent 开发指南》中的工具描述原则一致：LLM 更容易遵守边界清楚、
   * 优先级明确的信息结构；后续做压缩时也能按分区裁剪。
   */
  return {
    agentMd: buildAgentMd(config),
    budgetSummary: [
      "## Budget",
      `- 最大迭代：${config.budget.maxIterations}`,
      `- 最大工具调用：${config.budget.maxToolCalls}`,
      `- 超过 ${config.budget.staleObservationTurns} 轮的旧观察会被压缩。`
    ].join("\n"),
    capabilitySummary: [
      summarizeEntries("Skills", config.skills),
      summarizeEntries("Plugins", config.plugins),
      summarizeEntries("MCP Servers", config.mcpServers)
    ].join("\n\n"),
    memorySummary: summarizeMemories(memories),
    runtimeSummary: summarizeRuntimeContext(runtimeContext)
  };
}

export function formatAgentCorePromptContext(context: AgentCorePromptContext) {
  return [
    context.agentMd,
    context.runtimeSummary,
    context.memorySummary,
    context.capabilitySummary,
    context.budgetSummary
  ].join("\n\n");
}

