import type { SettingsState } from "../settings/settings.types";
import type { ModelPolicy } from "./modelGateway";
import { getDirectModelConfig, isDirectModelMode } from "./modelProviders";

export function getActiveModelProvider(settings: SettingsState) {
  return isDirectModelMode(settings) ? getDirectModelConfig(settings).provider : settings["models.default_provider"];
}

export function getModelForSettings(settings: SettingsState) {
  return isDirectModelMode(settings) ? getDirectModelConfig(settings).model : getDefaultModelForProvider(settings["models.default_provider"]);
}

export function getActiveModelEndpoint(settings: SettingsState) {
  return isDirectModelMode(settings) ? getDirectModelConfig(settings).endpoint : settings["models.cloud_proxy_endpoint"];
}

export function getDefaultModelForProvider(provider: string) {
  if (provider === "deepseek") {
    return "deepseek-v4-flash";
  }
  const injectedModel = import.meta.env.VITE_LITEASY_OPENAI_MODEL?.trim();
  return injectedModel || "gpt-5-mini";
}

export function getModelPolicyFromSettings(settings: SettingsState): ModelPolicy {
  const provider = getActiveModelProvider(settings);

  return {
    allowedModels: [getModelForSettings(settings)],
    allowedProviders: [provider]
  };
}
