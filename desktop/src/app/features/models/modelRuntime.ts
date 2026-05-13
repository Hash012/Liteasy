import type { SettingsState } from "../settings/settings.types";
import { createModelGateway, type GenerateAnswerInput, type ModelGenerationResult } from "./modelGateway";
import { createHttpModelClient, type ModelTransport } from "./modelHttpClient";
import { getModelPolicyFromSettings } from "./modelPolicy";
import { generateCloudProxyAnswer, generateLocalDirectAnswer } from "./mockProviders";

type ModelRuntimeDeps = {
  cloudTransport?: ModelTransport;
  localTransport?: ModelTransport;
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

function createDesktopMockClient(
  endpoint: string,
  source: "cloud_proxy" | "local_direct",
  generator: (input: GenerateAnswerInput) => Promise<string>
) {
  return async (input: GenerateAnswerInput): Promise<ModelGenerationResult> => {
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
    cloudProxy: isMockEndpoint(settings["models.cloud_proxy_endpoint"])
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
    localDirect: isMockEndpoint(settings["models.local_direct_endpoint"])
      ? createDesktopMockClient(
          settings["models.local_direct_endpoint"],
          "local_direct",
          generateLocalDirectAnswer
        )
      : createHttpModelClient({
          endpoint: settings["models.local_direct_endpoint"],
          source: "local_direct",
          transport: deps.localTransport
        }),
    policy: getModelPolicyFromSettings(settings)
  });
}
