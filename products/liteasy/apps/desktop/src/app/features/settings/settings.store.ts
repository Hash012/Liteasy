import { agentContextLimit } from "../context/modelContextBudget";
import { defaultReadingFontFamily, normalizeReadingFontFamily } from "./readingFonts";
import type { SettingsState, UpdateSettingCommand } from "./settings.types";
import { normalizeDisplayScale, normalizeViewFontSize } from "./viewSettings";
import { isRecommendationStyle, normalizeRecommendationStyle } from "../recommendations/recommendationStyle";
import { isAppearancePreference, normalizeAppearancePreference, notifyAppearancePreference, viewSettingsStorageKey } from "../theme/appearancePreference";

const modelSettingsStorageKey = "liteasy.model-connection.v1";
const recommendationSettingsStorageKey = "liteasy.recommendation-settings.v1";
const modelSettingKeys = ["assistant.context_window","thin_reading.mode", "papers.metadata_provider", "papers.metadata_endpoint", "papers.mineru_mode", "papers.mineru_endpoint", "models.connection_mode", "models.direct_provider", "models.direct_endpoint", "models.direct_model", "models.direct_protocol", "models.direct_output_format"] as const;

function loadPersistedModelSettings(): Partial<SettingsState> {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(modelSettingsStorageKey) ?? "{}");
    return Object.fromEntries(modelSettingKeys.filter((key) => typeof parsed?.[key] === "string").map((key) => [key, parsed[key]]));
  } catch { return {}; }
}

function loadLocalSetting(key: string) {
  try { return JSON.parse(globalThis.localStorage?.getItem("liteasy.local-literature.v1") ?? "{}")[key] === true; } catch { return false; }
}
function loadRecommendationStyle() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(recommendationSettingsStorageKey) ?? "{}");
    return normalizeRecommendationStyle(parsed?.["network.recommendation.style"]);
  } catch {
    return "balanced" as const;
  }
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
    return Object.fromEntries(Object.entries({
      "view.theme": normalizeAppearancePreference(parsed["view.theme"]),
      "view.font_family": typeof parsed["view.font_family"] === "string" ? parsed["view.font_family"] : undefined,
      "view.reader_font_family": normalizeReadingFontFamily(parsed["view.reader_font_family"]),
      "view.font_size": normalizeViewFontSize(parsed["view.font_size"]),
      "view.display_scale": normalizeDisplayScale(parsed["view.display_scale"]),
      "view.pdf_background": ["paper", "warm", "mint", "custom"].includes(String(parsed["view.pdf_background"]))
        ? parsed["view.pdf_background"]
        : undefined,
      "view.pdf_custom_background": typeof parsed["view.pdf_custom_background"] === "string"
        ? parsed["view.pdf_custom_background"]
        : undefined
    }).filter(([, setting]) => setting !== undefined));
  } catch {
    return {};
  }
}

function persistViewSettings(state: SettingsState) {
  try {
    globalThis.localStorage?.setItem(
      viewSettingsStorageKey,
      JSON.stringify({
        "view.theme": state["view.theme"],
        "view.font_family": state["view.font_family"],
        "view.reader_font_family": state["view.reader_font_family"],
        "view.font_size": state["view.font_size"],
        "view.display_scale": state["view.display_scale"],
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
  const state: SettingsState & { "assistant.context_window": string } = {
    "thin_reading.mode": "fast",
    "papers.metadata_provider": "crossref",
    "papers.metadata_endpoint": "https://api.crossref.org",
    "papers.mineru_mode": "local",
    "papers.mineru_endpoint": "https://mineru.net",
    "network.recommendation.enabled": true,
    "network.recommendation.sort_mode": "relevance",
    "network.recommendation.style": loadRecommendationStyle(),
    "assistant.public_audit.enabled": false,
    "profile.enabled": false,
    "papers.local_mode": loadLocalSetting("papers.local_mode"),
    "profile.local_enabled": loadLocalSetting("profile.local_enabled"),
    "assistant.default_output_mode": "mindmap",
    "assistant.language": "zh-CN",
    "assistant.context_window": "32768",
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
    "view.theme": "system",
    "view.font_family": '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
    "view.reader_font_family": defaultReadingFontFamily,
    "view.font_size": "14",
    "view.display_scale": "100",
    "view.pdf_background": "paper",
    "view.pdf_custom_background": "#ffffff",
    ...loadPersistedViewSettings()
  };

  state["assistant.context_window"] = String(agentContextLimit(state["assistant.context_window"]));

  return {
    apply(command: UpdateSettingCommand) {
      if (command.target === "assistant.context_window" &&
        (!Number.isInteger(Number(command.value)) || Number(command.value) < 4096 || Number(command.value) > 262144)) {
        throw new Error("上下文上限应为 4096 至 262144 之间的整数。");
      }
      if (command.target === "view.theme" && !isAppearancePreference(command.value)) {
        throw new Error("invalid_appearance_preference");
      }
      if (command.target === "network.recommendation.style" && !isRecommendationStyle(command.value)) {
        throw new Error("invalid_recommendation_style");
      }
      state[command.target] = (command.target === "view.reader_font_family"
        ? normalizeReadingFontFamily(command.value)
        : command.target === "view.display_scale"
        ? normalizeDisplayScale(command.value)
        : command.target === "view.font_size"
          ? normalizeViewFontSize(command.value)
          : command.value) as never;
      if (command.target.startsWith("view.")) {
        persistViewSettings(state);
      }
      if (command.target === "view.theme") {
        notifyAppearancePreference(state["view.theme"]);
      }
      if (command.target === "papers.local_mode" || command.target === "profile.local_enabled") {
        try { localStorage.setItem("liteasy.local-literature.v1", JSON.stringify({ "papers.local_mode": state["papers.local_mode"], "profile.local_enabled": state["profile.local_enabled"] })); } catch { /* Keep this session usable. */ }
      }
      if (command.target === "network.recommendation.style") {
        try {
          globalThis.localStorage?.setItem(recommendationSettingsStorageKey, JSON.stringify({
            "network.recommendation.style": state["network.recommendation.style"]
          }));
        } catch { /* The preference remains active for this session when storage is unavailable. */ }
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
