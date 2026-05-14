import type { SettingChange, SettingKey } from "../settings/settings.types";
import { isKnownSetting } from "../settings/settingsRegistry";

type CommandResult =
  | { ok: true; change: SettingChange; message: string }
  | { ok: false; message: string };

const commandMap: Array<{ pattern: RegExp; target: SettingKey; value: boolean | string }> = [
  { pattern: /关闭.*联网推荐/, target: "network.recommendation.enabled", value: false },
  { pattern: /开启.*联网推荐/, target: "network.recommendation.enabled", value: true },
  { pattern: /停用.*联网搜索/, target: "network.recommendation.enabled", value: false },
  { pattern: /打开.*联网搜索/, target: "network.recommendation.enabled", value: true },
  { pattern: /关闭.*用户画像/, target: "profile.enabled", value: false },
  { pattern: /开启.*用户画像/, target: "profile.enabled", value: true },
  { pattern: /默认.*输出.*(名词解释|解释)/, target: "assistant.default_output_mode", value: "explain" },
  { pattern: /默认.*输出.*(问答|qa)/i, target: "assistant.default_output_mode", value: "qa" },
  { pattern: /默认.*输出.*(命令|command)/i, target: "assistant.default_output_mode", value: "command" },
  { pattern: /(?<!不)使用中文/, target: "assistant.language", value: "zh-CN" },
  { pattern: /使用英文/, target: "assistant.language", value: "en" },
];

export function routeCommand(input: string): CommandResult {
  for (const { pattern, target, value } of commandMap) {
    if (pattern.test(input)) {
      return {
        ok: true,
        change: { intent: "update_setting", target, value },
        message: `已执行：${describeChange({ intent: "update_setting", target, value })}`,
      };
    }
  }

  return {
    ok: false,
    message: `无法识别指令"${input}"。你可以尝试：关闭/开启联网推荐、开启/关闭用户画像、默认输出模式为问答/名词解释等。`,
  };
}

function describeChange(change: SettingChange): string {
  const labels: Record<string, string> = {
    "network.recommendation.enabled": "联网推荐",
    "profile.enabled": "用户画像",
    "assistant.default_output_mode": "默认输出模式",
    "assistant.language": "助手语言",
  };
  const label = labels[change.target] ?? change.target;
  const valueStr = typeof change.value === "boolean"
    ? (change.value ? "开启" : "关闭")
    : String(change.value);
  return `${label} → ${valueStr}`;
}
