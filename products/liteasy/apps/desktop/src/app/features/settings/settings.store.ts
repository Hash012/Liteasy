import type { SettingsState, UpdateSettingCommand } from "./settings.types";

const viewSettingsStorageKey = "liteasy.view-settings.v1";
const modelSettingsStorageKey = "liteasy.model-connection.v1";
const modelSettingKeys = ["thin_reading.mode", "papers.metadata_provider", "papers.metadata_endpoint", "papers.mineru_mode", "papers.mineru_endpoint", "models.connection_mode", "models.direct_provider", "models.direct_endpoint", "models.direct_model", "models.direct_protocol", "models.direct_output_format"] as const;

function loadPersistedModelSettings(): Partial<SettingsState> {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(modelSettingsStorageKey) ?? "{}");
    return Object.fromEntries(modelSettingKeys.filter((key) => typeof parsed?.[key] === "string").map((key) => [key, parsed[key]]));
  } catch { return {}; }
}

type DesktopRuntimeEnv = {
  VITE_FORUM_API_URL?: string;
  VITE_LITEASY_CLOUD_URL?: string;
  VITE_LITEASY_MODEL_PROVIDER?: string;
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
    "thin_reading.mode": "fast",
    "papers.metadata_provider": "crossref",
    "papers.metadata_endpoint": "https://api.crossref.org",
    "papers.mineru_mode": "local",
    "papers.mineru_endpoint": "https://mineru.net",
    "network.recommendation.enabled": true,
    "network.recommendation.sort_mode": "relevance",
    "assistant.public_audit.enabled": false,
    "profile.enabled": false,
    "assistant.default_output_mode": "mindmap",
    "assistant.language": "zh-CN",
    "import.ocr_language": "eng",
    "thin_reading.intuecho_endpoint": forumEndpoint,
    "models.default_provider": runtimeEnv.VITE_LITEASY_MODEL_PROVIDER === "deepseek"
      ? "deepseek"
      : "openai",
    "models.cloud_proxy_endpoint": cloudEndpoint,
    "models.control_plane_endpoint": cloudEndpoint,
    "models.connection_mode": "cloud",
    "models.direct_provider": "openai",
    "models.direct_endpoint": "https://api.openai.com/v1",
    "models.direct_model": "gpt-5-mini",
    "models.direct_protocol": "openai",
    "models.direct_output_format": "json_schema",
    ...loadPersistedModelSettings(),
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
      if (modelSettingKeys.includes(command.target as typeof modelSettingKeys[number])) {
        try {
          globalThis.localStorage?.setItem(modelSettingsStorageKey, JSON.stringify(Object.fromEntries(modelSettingKeys.map((key) => [key, state[key]]))));
        } catch { /* Settings remain active for this session when storage is unavailable. */ }
      }
      return state[command.target]!;
    },
    getState() {
      return state;
    }
  };
}

export type { DesktopRuntimeEnv };
