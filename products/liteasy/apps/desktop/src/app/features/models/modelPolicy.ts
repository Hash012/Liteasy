import type { SettingsState } from "../settings/settings.types";
import type { ModelPolicy } from "./modelGateway";

export function getDefaultModelForProvider(provider: string) {
  if (provider === "deepseek") {
    return "deepseek-chat";
  }
  const injectedModel = import.meta.env.VITE_LITEASY_OPENAI_MODEL?.trim();
  return injectedModel || "gpt-5-mini";
}

export function getModelPolicyFromSettings(settings: SettingsState): ModelPolicy {
  const provider = settings["models.default_provider"];

  return {
    allowedModels: [getDefaultModelForProvider(provider)],
    allowedProviders: [provider]
  };
}
