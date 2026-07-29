import type { SettingsState } from "../settings/settings.types";
import { createModelGateway, type GenerateAnswerInput, type ModelGenerationResult } from "./modelGateway";
import { createHttpModelClient, type ModelTransport } from "./modelHttpClient";
import { getModelPolicyFromSettings } from "./modelPolicy";
import { generateCloudProxyAnswer } from "./mockProviders";

type ModelRuntimeDeps = {
  cloudTransport?: ModelTransport;
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

function createDesktopMockClient(
  endpoint: string,
  source: "cloud_proxy",
  generator: (input: GenerateAnswerInput) => Promise<string>
) {
  return async (input: GenerateAnswerInput): Promise<ModelGenerationResult> => {
    if (input.requireLive) {
      throw new Error("该任务必须使用真实模型链路；当前 endpoint 是 mock，本次生成已停止。");
    }
    const answer = await generator(input);

    return {
      answer,
      trace: {
        backend: "desktop_mock",
        endpoint,
        mode: "mock",
        provider: input.provider,
        source
      }
    };
  };
}

export function createModelGatewayFromSettings(
  settings: SettingsState,
  deps: ModelRuntimeDeps = {}
) {
  return createModelGateway({
    cloudModel: isMockEndpoint(settings["models.cloud_proxy_endpoint"])
      ? createDesktopMockClient(
          settings["models.cloud_proxy_endpoint"],
          "cloud_proxy",
          generateCloudProxyAnswer
        )
      : createHttpModelClient({
          endpoint: settings["models.cloud_proxy_endpoint"],
          source: "cloud_proxy",
          transport: deps.cloudTransport
        }),
    policy: getModelPolicyFromSettings(settings)
  });
}
