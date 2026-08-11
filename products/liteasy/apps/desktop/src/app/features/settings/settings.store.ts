import type { SettingsState, UpdateSettingCommand } from "./settings.types";

const viewSettingsStorageKey = "liteasy.view-settings.v1";

type DesktopRuntimeEnv = {
  VITE_FORUM_API_URL?: string;
  VITE_LITEASY_CLOUD_URL?: string;
};

function releaseEndpoint(value: string | undefined, fallback: string) {
  if (!value?.trim()) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("desktop_runtime_endpoint_invalid");
  }
  const loopback = parsed.protocol === "http:" &&
    new Set(["127.0.0.1", "[::1]", "localhost"]).has(parsed.hostname);
  if (
    (!loopback && parsed.protocol !== "https:") || parsed.username || parsed.password ||
    parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error("desktop_runtime_endpoint_invalid");
  }
  return parsed.toString().replace(/\/$/, "");
}

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

export function createSettingsStore(runtimeEnv: DesktopRuntimeEnv = import.meta.env) {
  const cloudEndpoint = releaseEndpoint(runtimeEnv.VITE_LITEASY_CLOUD_URL, "http://127.0.0.1:8787");
  const forumEndpoint = releaseEndpoint(runtimeEnv.VITE_FORUM_API_URL, "");
  const state: SettingsState = {
    "network.recommendation.enabled": true,
    "network.recommendation.sort_mode": "relevance",
    "assistant.public_audit.enabled": false,
    "profile.enabled": false,
    "assistant.default_output_mode": "mindmap",
    "assistant.language": "zh-CN",
    "import.ocr_language": "eng",
    "thin_reading.intuecho_endpoint": forumEndpoint,
    "models.default_provider": "openai",
    "models.cloud_proxy_endpoint": cloudEndpoint,
    "models.control_plane_endpoint": cloudEndpoint,
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

export type { DesktopRuntimeEnv };
