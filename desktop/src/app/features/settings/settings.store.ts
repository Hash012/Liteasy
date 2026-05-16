import type { SettingsState, UpdateSettingCommand } from "./settings.types";

export function createSettingsStore() {
  const state: SettingsState = {
    "network.recommendation.enabled": true,
    "network.recommendation.sort_mode": "relevance",
    "profile.enabled": false,
    "assistant.default_output_mode": "mindmap",
    "assistant.language": "zh-CN",
    "models.default_provider": "openai",
    "models.cloud_proxy_endpoint": "mock://cloud-proxy",
    "models.control_plane_endpoint": "mock://control-plane"
  };

  return {
    apply(command: UpdateSettingCommand) {
      state[command.target] = command.value as never;
      return state[command.target];
    },
    getState() {
      return state;
    }
  };
}
