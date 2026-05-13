import type { SettingKey } from "./settings.types";

export const settingsRegistry: Record<SettingKey, { label: string }> = {
  "network.recommendation.enabled": { label: "联网推荐" },
  "network.recommendation.sort_mode": { label: "推荐排序" },
  "profile.enabled": { label: "用户画像" },
  "assistant.default_output_mode": { label: "默认输出模式" },
  "assistant.language": { label: "回答语言" },
  "models.access_mode": { label: "模型接入方式" },
  "models.local_direct_enabled": { label: "本地直连模型" },
  "models.default_provider": { label: "默认模型服务商" },
  "models.cloud_proxy_endpoint": { label: "云代理模型端点" },
  "models.local_direct_endpoint": { label: "本地直连模型端点" },
  "models.control_plane_endpoint": { label: "云端控制平面端点" }
};
