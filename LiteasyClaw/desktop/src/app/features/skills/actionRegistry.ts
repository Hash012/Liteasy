import type { ArtifactType } from "../artifacts/artifact.types";
import type { ActionRiskLevel } from "../resources/resourceActionPolicy";
import { settingsRegistry } from "../settings/settingsRegistry";
import type { UpdateSettingCommand } from "../settings/settings.types";

export type SettingsStoreLike = {
  apply: (command: UpdateSettingCommand) => boolean | string;
  getState: () => Record<UpdateSettingCommand["target"], boolean | string>;
};

export type PanelActionTarget =
  | "bottom"
  | "left"
  | "library"
  | "organization"
  | "profile"
  | "right"
  | "settings";

export type ActionContext = {
  applyLayoutPreset?: (input: {
    preset?: "two_column" | "reading" | "focus";
  }) => string;
  applyPanelAction?: (input: {
    operation: "close" | "open" | "toggle";
    panel: PanelActionTarget;
  }) => string;
  applyThemePreset?: (input: {
    preset?: "playful" | "default";
    tone?: "cartoon" | "quiet";
  }) => string;
  importSelectedSet?: () => string | Promise<string>;
  openOrganizationSharedLibrary?: () => string | Promise<string>;
  profileUnlocked?: boolean;
  settingsStore?: SettingsStoreLike;
  startArtifactAnalysis?: (artifactType: ArtifactType) => string;
};

export type ActionResult = {
  message: string;
};

function formatSettingValue(
  target: UpdateSettingCommand["target"],
  value: UpdateSettingCommand["value"]
) {
  if (target === "network.recommendation.sort_mode") {
    return value === "retrieved_at" ? "按检索时间" : "按关联度";
  }

  return String(value);
}

export type ActionInvocation =
  | {
      actionId: "artifact.generate";
      input: {
        artifactType: ArtifactType;
        source: "selected_document_set";
      };
    }
  | {
      actionId: "layout.split_two" | "layout.reset";
      input: {
        preset?: "two_column" | "reading" | "focus";
      };
    }
  | {
      actionId: "theme.apply_preset" | "theme.reset";
      input: {
        preset?: "playful" | "default";
        tone?: "cartoon" | "quiet";
      };
    }
  | {
      actionId: "panel.open" | "panel.close" | "panel.toggle";
      input: {
        panel: PanelActionTarget;
      };
    }
  | {
      actionId: "settings.update";
      input: {
        target: UpdateSettingCommand["target"];
        value: UpdateSettingCommand["value"];
      };
    }
  | {
      actionId: "selected_set.import";
      input: {
        source: "selected_document_set";
      };
    }
  | {
      actionId: "artifact.start_analysis";
      input: {
        artifactType: ArtifactType;
        source: "selected_document_set";
      };
    }
  | {
      actionId: "organization.open_shared_library";
      input: {
        source: "organization_space";
      };
    }
  | {
      actionId: "workspace.delete_documents";
      input: {
        scope: "selected_document_set";
      };
    }
  | {
      actionId: "workspace.overwrite_documents";
      input: {
        scope: "selected_document_set";
      };
    }
  | {
      actionId: "workspace.batch_update_documents";
      input: {
        scope: "selected_document_set" | "current_workspace";
      };
    }
  | {
      actionId: "cloud.upload_documents";
      input: {
        scope: "selected_document_set" | "current_workspace";
      };
    }
  | {
      actionId: "cloud.sync_workspace";
      input: {
        scope: "current_workspace";
      };
    };

export type RegisteredActionMetadata = {
  actionId: ActionInvocation["actionId"];
  label: string;
  requiredContext: string[];
  requiresConfirmation: boolean;
  riskLevel: ActionRiskLevel;
};

const registeredActionMetadata: RegisteredActionMetadata[] = [
  {
    actionId: "artifact.generate",
    label: "生成多模态产物",
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "artifact.start_analysis",
    label: "启动产物分析",
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "layout.split_two",
    label: "切换双栏布局",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "layout.reset",
    label: "恢复默认布局",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "theme.apply_preset",
    label: "应用界面风格",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "theme.reset",
    label: "恢复默认界面风格",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "panel.open",
    label: "打开面板",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "panel.close",
    label: "关闭面板",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "panel.toggle",
    label: "切换面板",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "settings.update",
    label: "更新设置",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "selected_set.import",
    label: "导入当前选中文献集",
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "organization.open_shared_library",
    label: "打开组织共享文献库",
    requiredContext: ["organization"],
    requiresConfirmation: false,
    riskLevel: "low"
  },
  {
    actionId: "workspace.delete_documents",
    label: "删除文献",
    requiredContext: ["selected_document_set"],
    requiresConfirmation: true,
    riskLevel: "high"
  },
  {
    actionId: "workspace.overwrite_documents",
    label: "覆盖文献",
    requiredContext: ["selected_document_set"],
    requiresConfirmation: true,
    riskLevel: "high"
  },
  {
    actionId: "workspace.batch_update_documents",
    label: "批量修改文献",
    requiredContext: ["selected_document_set"],
    requiresConfirmation: true,
    riskLevel: "high"
  },
  {
    actionId: "cloud.upload_documents",
    label: "上传文献到云端",
    requiredContext: ["selected_document_set"],
    requiresConfirmation: true,
    riskLevel: "high"
  },
  {
    actionId: "cloud.sync_workspace",
    label: "同步工作区到云端",
    requiredContext: ["workspace"],
    requiresConfirmation: true,
    riskLevel: "high"
  }
];

function cloneActionMetadata(metadata: RegisteredActionMetadata): RegisteredActionMetadata {
  return {
    ...metadata,
    requiredContext: [...metadata.requiredContext]
  };
}

export function getRegisteredActionMetadata(): RegisteredActionMetadata[] {
  return registeredActionMetadata.map(cloneActionMetadata);
}

export function getRuntimeActionPolicy(invocation: ActionInvocation): RegisteredActionMetadata {
  const metadata = registeredActionMetadata.find((action) => action.actionId === invocation.actionId);
  if (!metadata) {
    throw new Error(`Unknown action metadata: ${invocation.actionId}`);
  }

  if (invocation.actionId === "settings.update" && invocation.input.target === "profile.enabled") {
    return {
      ...cloneActionMetadata(metadata),
      requiresConfirmation: true,
      riskLevel: "medium"
    };
  }

  return cloneActionMetadata(metadata);
}

export async function executeAction(
  invocation: ActionInvocation,
  context: ActionContext
): Promise<ActionResult> {
  if (invocation.actionId === "layout.split_two" || invocation.actionId === "layout.reset") {
    if (!context.applyLayoutPreset) {
      throw new Error(`${invocation.actionId} requires a layout handler`);
    }

    return {
      message: context.applyLayoutPreset(invocation.input)
    };
  }

  if (invocation.actionId === "theme.apply_preset" || invocation.actionId === "theme.reset") {
    if (!context.applyThemePreset) {
      throw new Error(`${invocation.actionId} requires a theme handler`);
    }

    return {
      message: context.applyThemePreset(invocation.input)
    };
  }

  if (
    invocation.actionId === "panel.open" ||
    invocation.actionId === "panel.close" ||
    invocation.actionId === "panel.toggle"
  ) {
    if (!context.applyPanelAction) {
      throw new Error(`${invocation.actionId} requires a panel handler`);
    }

    const operation =
      invocation.actionId === "panel.open"
        ? "open"
        : invocation.actionId === "panel.close"
          ? "close"
          : "toggle";

    return {
      message: context.applyPanelAction({
        ...invocation.input,
        operation
      })
    };
  }

  if (invocation.actionId === "settings.update") {
    if (!context.settingsStore) {
      throw new Error("settings.update requires a settings store");
    }

    if (
      invocation.input.target === "profile.enabled" &&
      context.profileUnlocked !== true
    ) {
      return {
        message: "请先登录云账号后再使用个人画像能力。"
      };
    }

    context.settingsStore.apply({
      intent: "update_setting",
      target: invocation.input.target,
      value: invocation.input.value
    });

    return {
      message: `已更新 ${settingsRegistry[invocation.input.target].label}：${formatSettingValue(
        invocation.input.target,
        invocation.input.value
      )}`
    };
  }

  if (invocation.actionId === "selected_set.import") {
    if (!context.importSelectedSet) {
      throw new Error("selected_set.import requires an import handler");
    }

    return {
      message: await context.importSelectedSet()
    };
  }

  if (invocation.actionId === "organization.open_shared_library") {
    if (!context.openOrganizationSharedLibrary) {
      throw new Error("organization.open_shared_library requires an organization shared-library handler");
    }

    return {
      message: await context.openOrganizationSharedLibrary()
    };
  }

  if (invocation.actionId === "artifact.generate" || invocation.actionId === "artifact.start_analysis") {
    if (!context.startArtifactAnalysis) {
      throw new Error(`${invocation.actionId} requires an artifact analysis handler`);
    }

    return {
      message: context.startArtifactAnalysis(invocation.input.artifactType)
    };
  }

  if (
    invocation.actionId === "workspace.delete_documents" ||
    invocation.actionId === "workspace.overwrite_documents" ||
    invocation.actionId === "workspace.batch_update_documents" ||
    invocation.actionId === "cloud.upload_documents" ||
    invocation.actionId === "cloud.sync_workspace"
  ) {
    throw new Error(`${invocation.actionId} requires an approved high-risk action handler`);
  }

  throw new Error(`Unknown action: ${(invocation as { actionId: string }).actionId}`);
}
