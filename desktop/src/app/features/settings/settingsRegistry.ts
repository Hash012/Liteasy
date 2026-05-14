import type { SettingDefinition } from "./settings.types";

export const settingsRegistry: Record<string, SettingDefinition> = {
  "network.recommendation.enabled": {
    key: "network.recommendation.enabled",
    label: "联网推荐",
    description: "开启后，AI 可在需要时联网检索并推荐相关文献",
    type: "boolean",
    defaultValue: true,
  },
  "profile.enabled": {
    key: "profile.enabled",
    label: "用户画像",
    description: "开启后，系统将采集软件内行为数据以提供个性化服务",
    type: "boolean",
    defaultValue: true,
  },
  "assistant.default_output_mode": {
    key: "assistant.default_output_mode",
    label: "默认输出模式",
    description: "AI 助手的默认回答模式",
    type: "string",
    defaultValue: "qa",
  },
  "assistant.language": {
    key: "assistant.language",
    label: "助手语言",
    description: "AI 助手使用的回复语言",
    type: "string",
    defaultValue: "zh-CN",
  },
};

export function getSetting(key: string): SettingDefinition | undefined {
  return settingsRegistry[key];
}

export function isKnownSetting(key: string): boolean {
  return key in settingsRegistry;
}
