import type { SkillInvocation } from "../skills/skillRegistry";

function includesAny(input: string, phrases: string[]) {
  return phrases.some((phrase) => input.includes(phrase));
}

function isRecommendationDisableCommand(input: string) {
  return (
    includesAny(input, [
      "关闭联网推荐",
      "停用联网推荐",
      "禁用联网推荐",
      "关闭联网文献推荐",
      "停用联网文献推荐",
      "禁用联网文献推荐"
    ]) ||
    (includesAny(input, ["联网推荐", "联网文献推荐"]) && includesAny(input, ["关闭", "停用", "禁用", "不要", "别再"]))
  );
}

function isRecommendationEnableCommand(input: string) {
  return (
    includesAny(input, [
      "开启联网推荐",
      "打开联网推荐",
      "启用联网推荐",
      "开启联网文献推荐",
      "打开联网文献推荐",
      "启用联网文献推荐"
    ]) ||
    (includesAny(input, ["联网推荐", "联网文献推荐"]) && includesAny(input, ["开启", "打开", "启用", "恢复", "重新开启"]))
  );
}

function isOpenOrganizationSharedLibraryCommand(input: string) {
  return input.includes("打开") && input.includes("组织") && input.includes("共享文献库");
}

function isEnableLocalDirectCommand(input: string) {
  return includesAny(input, [
    "允许本地直连",
    "开启本地直连",
    "启用本地直连",
    "打开本地直连"
  ]);
}

function isSwitchToLocalDirectCommand(input: string) {
  return includesAny(input, [
    "切换到本地直连",
    "改用本地直连",
    "使用本地直连"
  ]);
}

function isSwitchToCloudProxyCommand(input: string) {
  return includesAny(input, [
    "切换到云代理",
    "改用云代理",
    "使用云代理"
  ]);
}

function isSyncCloudPolicyCommand(input: string) {
  return input.includes("同步") && input.includes("云端") && input.includes("策略");
}

export function routeCommand(input: string): SkillInvocation | null {
  const normalized = input.trim();
  if (normalized.includes("思维导图")) {
    return {
      skillId: "artifact.generate",
      input: {
        artifactType: "mindmap",
        source: "selected_document_set"
      }
    };
  }

  if (isRecommendationDisableCommand(normalized)) {
    return {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.enabled",
        value: false
      }
    };
  }

  if (isRecommendationEnableCommand(normalized)) {
    return {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.enabled",
        value: true
      }
    };
  }

  if (normalized === "按关联度排序推荐") {
    return {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.sort_mode",
        value: "relevance"
      }
    };
  }

  if (normalized === "按检索时间排序推荐") {
    return {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.sort_mode",
        value: "retrieved_at"
      }
    };
  }

  if (normalized === "开启用户画像") {
    return {
      skillId: "settings.adjust",
      input: {
        target: "profile.enabled",
        value: true
      }
    };
  }

  if (normalized === "关闭用户画像") {
    return {
      skillId: "settings.adjust",
      input: {
        target: "profile.enabled",
        value: false
      }
    };
  }

  if (isEnableLocalDirectCommand(normalized)) {
    return {
      skillId: "settings.adjust",
      input: {
        target: "models.local_direct_enabled",
        value: true
      }
    };
  }

  if (isSwitchToLocalDirectCommand(normalized)) {
    return {
      skillId: "settings.adjust",
      input: {
        target: "models.access_mode",
        value: "local_direct"
      }
    };
  }

  if (isSwitchToCloudProxyCommand(normalized)) {
    return {
      skillId: "settings.adjust",
      input: {
        target: "models.access_mode",
        value: "cloud_proxy"
      }
    };
  }

  if (isSyncCloudPolicyCommand(normalized)) {
    return {
      skillId: "settings.sync_policy",
      input: {
        source: "cloud_control_plane"
      }
    };
  }

  if (isOpenOrganizationSharedLibraryCommand(normalized)) {
    return {
      skillId: "organization.open_shared_library",
      input: {
        source: "organization_space"
      }
    };
  }

  return null;
}
