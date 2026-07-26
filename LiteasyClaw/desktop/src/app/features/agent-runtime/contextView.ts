import type {
  AgentRecommendationContextItem,
  AgentRuntimeContextView,
  RuntimeContextIssue
} from "./agentRuntime.types";
import type { WorkspaceSource } from "../workspace/workspace.types";

export type AgentRuntimeContextViewInput = {
  importedCount: number;
  organizationName?: string;
  profileEnabled?: boolean;
  profilePersonalizationSummary?: string;
  profileUnlocked: boolean;
  recommendations?: AgentRecommendationContextItem[];
  selectedCount: number;
  selectionLocked: boolean;
  workspace?: Partial<WorkspaceSource>;
};

function getSelectionIssues(input: AgentRuntimeContextViewInput): RuntimeContextIssue[] {
  const issues: RuntimeContextIssue[] = [];

  if (input.selectedCount === 0) {
    issues.push("selection_empty");
  }

  if (!input.selectionLocked) {
    issues.push("selection_unlocked");
  }

  if (input.selectedCount > 0 && input.importedCount < input.selectedCount) {
    issues.push("documents_not_imported");
  }

  return issues;
}

export function buildAgentRuntimeContextView(input: AgentRuntimeContextViewInput): AgentRuntimeContextView {
  const issues = getSelectionIssues(input);
  const workspaceType = input.workspace?.type ?? "unknown";
  const recommendations = input.recommendations ?? [];

  return {
    cloud: {
      connected: input.profileUnlocked,
      ...(input.organizationName ? { organizationName: input.organizationName } : {})
    },
    profile: {
      enabled: Boolean(input.profileEnabled),
      requiresConfirmation: true,
      ...(input.profileEnabled && input.profilePersonalizationSummary
        ? { personalizationSummary: input.profilePersonalizationSummary }
        : {})
    },
    recommendations: {
      items: recommendations.slice(0, 3).map((recommendation) => ({ ...recommendation })),
      totalCount: recommendations.length
    },
    selection: {
      importedCount: input.importedCount,
      issues,
      locked: input.selectionLocked,
      ready: issues.length === 0,
      selectedCount: input.selectedCount
    },
    workspace: {
      ...(input.workspace?.rootPath ? { rootPath: input.workspace.rootPath } : {}),
      type: workspaceType
    }
  };
}

export function formatAgentRuntimeContextSummary(context: AgentRuntimeContextView) {
  const lockLabel = context.selection.locked ? "已锁定" : "未锁定";
  const cloudLabel = context.cloud.connected ? "云账号已连接" : "云账号未连接";
  const profileLabel = !context.profile.enabled
    ? "用户画像已关闭"
    : context.profile.personalizationSummary
      ? "学术档案已应用"
      : "学术档案待补充";

  return [
    "上下文",
    `选中 ${context.selection.selectedCount} 篇`,
    lockLabel,
    `已导入 ${context.selection.importedCount}/${context.selection.selectedCount}`,
    cloudLabel,
    profileLabel
  ].join(" · ");
}
