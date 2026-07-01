import type { AgentRuntimeInput, AgentRuntimePlan } from "./agentRuntime.types";

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

export function routeAgentIntent(input: AgentRuntimeInput): AgentRuntimePlan {
  const normalized = input.message.trim();

  if (input.mode !== "command") {
    return {
      intentId: "unknown",
      kind: "unknown",
      message: "当前模式不执行受控命令。"
    };
  }

  if (normalized.includes("思维导图")) {
    return {
      artifact: {
        artifactType: "mindmap",
        payload: {
          source: "selected_document_set"
        }
      },
      intentId: "artifact.generate",
      kind: "artifact"
    };
  }

  if (isRecommendationDisableCommand(normalized)) {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "network.recommendation.enabled",
          value: false
        }
      }
    };
  }

  if (isRecommendationEnableCommand(normalized)) {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "network.recommendation.enabled",
          value: true
        }
      }
    };
  }

  if (normalized === "按关联度排序推荐") {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "network.recommendation.sort_mode",
          value: "relevance"
        }
      }
    };
  }

  if (normalized === "按检索时间排序推荐") {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "network.recommendation.sort_mode",
          value: "retrieved_at"
        }
      }
    };
  }

  if (normalized === "开启用户画像") {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "profile.enabled",
          value: true
        }
      }
    };
  }

  if (normalized === "关闭用户画像") {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "profile.enabled",
          value: false
        }
      }
    };
  }

  if (isOpenOrganizationSharedLibraryCommand(normalized)) {
    return {
      intentId: "organization.open_shared_library",
      kind: "skill",
      skill: {
        skillId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      }
    };
  }

  return {
    intentId: "unknown",
    kind: "unknown",
    message: "当前命令还没有注册到安全能力表中。"
  };
}
