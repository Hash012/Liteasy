import {
  getDefaultModelForProvider,
  getModelPolicyFromSettings
} from "../app/features/models/modelPolicy";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("selects the official DeepSeek chat model for the DeepSeek provider", () => {
  expect(getDefaultModelForProvider("deepseek")).toBe("deepseek-v4-flash");
});

test("allows the active provider default model in desktop policy", () => {
  const settings = {
    ...createSettingsStore().getState(),
    "models.default_provider": "deepseek"
  };

  expect(getModelPolicyFromSettings(settings)).toEqual({
    allowedModels: ["deepseek-v4-flash"],
    allowedProviders: ["deepseek"]
  });
});
