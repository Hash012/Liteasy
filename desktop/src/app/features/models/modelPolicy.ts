import type { SettingsState } from "../settings/settings.types";
import type { ModelPolicy } from "./modelGateway";

export function getModelPolicyFromSettings(settings: SettingsState): ModelPolicy {
  return {
    allowedModels: ["gpt-5-mini"],
    allowedProviders: [settings["models.default_provider"]],
    localDirectEnabled: settings["models.local_direct_enabled"],
    modelAccessMode: settings["models.access_mode"]
  };
}
