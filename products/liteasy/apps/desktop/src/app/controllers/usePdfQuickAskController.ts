import type { ModelTransport } from "../features/models/modelHttpClient";
import { getActiveModelProvider, getModelForSettings } from "../features/models/modelPolicy";
import { createModelGatewayFromSettings } from "../features/models/modelRuntime";
import type { createSettingsStore } from "../features/settings/settings.store";
import { buildQuickAskPrompt, type PdfQuickAskRequest } from "../features/pdf/pdfQuickAsk";

export function usePdfQuickAskController(input: {
  settingsStore: Pick<ReturnType<typeof createSettingsStore>, "getState">;
  modelTransport?: ModelTransport;
}) {
  return async (request: PdfQuickAskRequest): Promise<string> => {
    const settings = input.settingsStore.getState();
    const gateway = createModelGatewayFromSettings(settings, { cloudTransport: input.modelTransport });
    const result = await gateway.generateAnswer({
      model: getModelForSettings(settings), provider: getActiveModelProvider(settings),
      prompt: buildQuickAskPrompt(request), requireLive: true, signal: request.signal
    });
    if (!result.answer.trim()) throw new Error("未收到回答，请重试。");
    return result.answer;
  };
}
