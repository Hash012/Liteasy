import type { SettingsState } from "../settings/settings.types";
import type { ModelPolicy } from "./modelGateway";

export function getDefaultModelForProvider(provider: string) {
  return provider === "deepseek" ? "deepseek-v4-flash" : "gpt-5-mini";
}

export function getModelPolicyFromSettings(settings: SettingsState): ModelPolicy {
  const provider = settings["models.default_provider"];

  return {
    allowedModels: [getDefaultModelForProvider(provider)],
    allowedProviders: [provider]
  };
}
