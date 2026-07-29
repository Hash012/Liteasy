import type {
  AgentRecommendationContextItem,
  AgentRuntimeContextView,
  RuntimeContextIssue
} from "./agentRuntime.types";
import type { AcademicProfile } from "../profile/profile.types";
import type { WorkspaceSource } from "../workspace/workspace.types";

export type AgentRuntimeContextViewInput = {
  academicProfile?: AcademicProfile;
  importedCount: number;
  organizationName?: string;
  profilePersonalizationSummary?: string;
  profileUnlocked: boolean;
  recommendations?: AgentRecommendationContextItem[];
  selectedCount: number;
  selectionLocked: boolean;
  workspace?: Partial<WorkspaceSource>;
};

function hasAcademicProfile(profile: AcademicProfile | undefined): profile is AcademicProfile {
  if (!profile) {
    return false;
  }
  return (
    profile.stage !== "未设置" ||
    (profile.disciplines?.length ?? 0) > 0 ||
    Boolean(
      profile.researchTopics ||
        profile.researchMethods ||
        profile.researchDatasets ||
        profile.preferredLanguages
    )
  );
}

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
  const recommendations = input.recommendations ?? [];

  return {
    cloud: {
      connected: input.profileUnlocked,
      ...(input.organizationName ? { organizationName: input.organizationName } : {})
    },
    profile: {
      ...(hasAcademicProfile(input.academicProfile)
        ? {
            academic: {
              ...input.academicProfile,
              disciplines: (input.academicProfile.disciplines ?? []).map((discipline) => ({ ...discipline }))
            }
          }
        : {}),
      ...(input.profilePersonalizationSummary
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
      type: input.workspace?.type ?? "unknown"
    }
  };
}

export function formatAgentRuntimeContextSummary(context: AgentRuntimeContextView) {
  const lockLabel = context.selection.locked ? "已锁定" : "未锁定";
  const cloudLabel = context.cloud.connected ? "云账号已连接" : "云账号未连接";
  const profileLabel = context.profile.personalizationSummary || context.profile.academic
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
