import type { ArtifactType } from "../artifacts/artifact.types";
import { settingsRegistry } from "../settings/settingsRegistry";
import type { UpdateSettingCommand } from "../settings/settings.types";

export type SettingsStoreLike = {
  apply: (command: UpdateSettingCommand) => boolean | string;
  getState: () => Record<UpdateSettingCommand["target"], boolean | string>;
};

export type ActionContext = {
  importSelectedSet?: () => string;
  openOrganizationSharedLibrary?: () => string | Promise<string>;
  profileUnlocked?: boolean;
  settingsStore?: SettingsStoreLike;
  startArtifactAnalysis?: (artifactType: ArtifactType) => string;
  syncCloudPolicy?: () => Promise<string>;
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
      actionId: "settings.sync_model_policy";
      input: {
        source: "cloud_control_plane";
      };
    }
  | {
      actionId: "organization.open_shared_library";
      input: {
        source: "organization_space";
      };
    };

export async function executeAction(
  invocation: ActionInvocation,
  context: ActionContext
): Promise<ActionResult> {
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

    if (
      invocation.input.target === "models.access_mode" &&
      invocation.input.value === "local_direct" &&
      context.settingsStore.getState()["models.local_direct_enabled"] !== true
    ) {
      return {
        message: "本地直连未开放。请先同步云端策略，或在设置中启用允许本地直连。"
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
      message: context.importSelectedSet()
    };
  }

  if (invocation.actionId === "settings.sync_model_policy") {
    if (!context.syncCloudPolicy) {
      throw new Error("settings.sync_model_policy requires a cloud policy sync handler");
    }

    return {
      message: await context.syncCloudPolicy()
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

  if (!context.startArtifactAnalysis) {
    throw new Error("artifact.start_analysis requires an artifact analysis handler");
  }

  return {
    message: context.startArtifactAnalysis(invocation.input.artifactType)
  };
}
