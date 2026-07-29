import type { SettingsState, UpdateSettingCommand } from "./settings.types";

const viewSettingsStorageKey = "liteasy.view-settings.v1";

function loadPersistedViewSettings(): Partial<SettingsState> {
  try {
    const value = globalThis.localStorage?.getItem(viewSettingsStorageKey);
    if (!value) return {};
    const parsed = JSON.parse(value) as Partial<SettingsState>;
    return {
      "view.font_family": typeof parsed["view.font_family"] === "string" ? parsed["view.font_family"] : undefined,
      "view.font_size": typeof parsed["view.font_size"] === "string" ? parsed["view.font_size"] : undefined,
      "view.pdf_background": ["paper", "warm", "mint", "custom"].includes(String(parsed["view.pdf_background"]))
        ? parsed["view.pdf_background"]
        : undefined,
      "view.pdf_custom_background": typeof parsed["view.pdf_custom_background"] === "string"
        ? parsed["view.pdf_custom_background"]
        : undefined
    };
  } catch {
    return {};
  }
}

function persistViewSettings(state: SettingsState) {
  try {
    globalThis.localStorage?.setItem(
      viewSettingsStorageKey,
      JSON.stringify({
        "view.font_family": state["view.font_family"],
        "view.font_size": state["view.font_size"],
        "view.pdf_background": state["view.pdf_background"],
        "view.pdf_custom_background": state["view.pdf_custom_background"]
      })
    );
  } catch {
    // 隐私模式或宿主禁用 storage 时，设置仍在当前会话生效。
  }
}

export function createSettingsStore() {
  const state: SettingsState = {
    "network.recommendation.enabled": true,
    "network.recommendation.sort_mode": "relevance",
    "assistant.public_audit.enabled": false,
    "profile.enabled": false,
    "assistant.default_output_mode": "mindmap",
    "assistant.language": "zh-CN",
    "import.ocr_language": "eng",
    "thin_reading.intuecho_endpoint": "",
    "thin_reading.openalex_api_key": "",
    "models.default_provider": "openai",
    "models.cloud_proxy_endpoint": "mock://cloud-proxy",
    "models.control_plane_endpoint": "mock://control-plane",
    "view.font_family": '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
    "view.font_size": "14",
    "view.pdf_background": "paper",
    "view.pdf_custom_background": "#ffffff",
    ...loadPersistedViewSettings()
  };

  return {
    apply(command: UpdateSettingCommand) {
      state[command.target] = command.value as never;
      if (command.target.startsWith("view.")) {
        persistViewSettings(state);
      }
      return state[command.target];
    },
    getState() {
      return state;
    }
  };
}
