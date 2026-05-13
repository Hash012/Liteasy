import type { SkillInvocation } from "../skills/skillRegistry";

export function routeCommand(input: string): SkillInvocation | null {
  const normalized = input.trim();
  const setCloudProxyEndpoint = normalized.match(/^设置云代理端点为\s+(.+)$/);
  if (setCloudProxyEndpoint?.[1]) {
    return {
      skillId: "settings.adjust",
      input: {
        target: "models.cloud_proxy_endpoint",
        value: setCloudProxyEndpoint[1].trim()
      }
    };
  }

  const setControlPlaneEndpoint = normalized.match(/^设置云端控制平面端点为\s+(.+)$/);
  if (setControlPlaneEndpoint?.[1]) {
    return {
      skillId: "settings.adjust",
      input: {
        target: "models.control_plane_endpoint",
        value: setControlPlaneEndpoint[1].trim()
      }
    };
  }

  if (normalized.includes("思维导图")) {
    return {
      skillId: "artifact.generate",
      input: {
        artifactType: "mindmap",
        source: "selected_document_set"
      }
    };
  }

  if (normalized === "关闭联网推荐") {
    return {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.enabled",
        value: false
      }
    };
  }

  if (normalized === "开启联网推荐") {
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

  if (normalized === "允许本地直连") {
    return {
      skillId: "settings.adjust",
      input: {
        target: "models.local_direct_enabled",
        value: true
      }
    };
  }

  if (normalized === "禁止本地直连") {
    return {
      skillId: "settings.adjust",
      input: {
        target: "models.local_direct_enabled",
        value: false
      }
    };
  }

  if (normalized === "切换到本地直连") {
    return {
      skillId: "settings.adjust",
      input: {
        target: "models.access_mode",
        value: "local_direct"
      }
    };
  }

  if (normalized === "切换到云代理") {
    return {
      skillId: "settings.adjust",
      input: {
        target: "models.access_mode",
        value: "cloud_proxy"
      }
    };
  }

  if (normalized === "同步云端策略") {
    return {
      skillId: "settings.sync_policy",
      input: {
        source: "cloud_control_plane"
      }
    };
  }

  return null;
}
