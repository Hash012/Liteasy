import { createModelGatewayFromSettings } from "../models/modelRuntime";
import { getActiveModelProvider, getModelForSettings } from "../models/modelPolicy";
import type { ModelTransport } from "../models/modelHttpClient";
import type { SettingsState } from "../settings/settings.types";
import type { ProfileMemoryGenerator } from "./useProfileMemory";
export function createProfileMemoryGenerator(getSettings: () => SettingsState, cloudTransport?: ModelTransport): ProfileMemoryGenerator {
  return async ({ prompt, signal, outputFormat }) => {
    const settings = getSettings();
    const gateway = createModelGatewayFromSettings(settings, { cloudTransport });
    const result = await gateway.generateAnswer({ prompt, signal, outputFormat, requireLive: true,
      model: getModelForSettings(settings), provider: getActiveModelProvider(settings) });
    return result.answer;
  };
}
