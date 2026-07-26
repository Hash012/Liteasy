import type { AgentRuntimeContextView, RuntimeContextIssue } from "./agentRuntime.types";
import type { AcademicProfile } from "../profile/profile.types";
import type { WorkspaceSource } from "../workspace/workspace.types";

export type AgentRuntimeContextViewInput = {
  academicProfile?: AcademicProfile;
  importedCount: number;
  organizationName?: string;
  profileEnabled: boolean;
  profileUnlocked: boolean;
  selectedCount: number;
  selectionLocked: boolean;
  workspace?: Partial<WorkspaceSource>;
};

function hasAcademicProfile(profile: AcademicProfile | undefined): profile is AcademicProfile {
  if (!profile) {
    return false;
  }
  return profile.age !== "未设置" || profile.gender !== "未设置" || profile.stage !== "未设置";
}

function formatAcademicProfileBrief(profile: AcademicProfile) {
  return `${profile.gender}/${profile.age}/${profile.stage}`;
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
  const workspaceType = input.workspace?.type ?? "unknown";

  return {
    cloud: {
      connected: input.profileUnlocked,
      ...(input.organizationName ? { organizationName: input.organizationName } : {})
    },
    profile: {
      ...(input.profileEnabled && hasAcademicProfile(input.academicProfile)
        ? { academic: { ...input.academicProfile } }
        : {}),
      enabled: input.profileEnabled,
      requiresConfirmation: true
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
  const profileLabel = context.profile.enabled
    ? context.profile.academic
      ? `画像开启（${formatAcademicProfileBrief(context.profile.academic)}）`
      : "画像开启"
    : "画像关闭";

  return [
    "上下文",
    `选中 ${context.selection.selectedCount} 篇`,
    lockLabel,
    `已导入 ${context.selection.importedCount}/${context.selection.selectedCount}`,
    cloudLabel,
    profileLabel
  ].join(" · ");
}
