import { createModelGatewayFromSettings } from "../app/features/models/modelRuntime";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("uses the mock cloud endpoint by default for the current desktop runtime", async () => {
  const settings = createSettingsStore().getState();
  const gateway = createModelGatewayFromSettings(settings);

  const result = await gateway.generateAnswer({
    model: "gpt-5-mini",
    prompt: "问题：这篇论文讲了什么？",
    provider: "openai"
  });

  expect(result.answer).toBe("云端回答：这篇论文讲了什么？");
  expect(result.trace).toEqual({
    backend: "desktop_mock",
    endpoint: "mock://cloud-proxy",
    mode: "mock",
    provider: "openai",
    source: "cloud_proxy"
  });
});

test("uses the injected http client when the cloud endpoint is a real url", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const gateway = createModelGatewayFromSettings(store.getState(), {
    cloudTransport: async () => ({
      json: async () => ({
        answer: "http cloud answer",
        execution: {
          backend: "dev_cloud",
          mode: "live",
          provider: "openai"
        }
      }),
      ok: true,
      status: 200
    })
  });

  const result = await gateway.generateAnswer({
    model: "gpt-5-mini",
    prompt: "问题：这篇论文讲了什么？",
    provider: "openai"
  });

  expect(result.answer).toBe("http cloud answer");
  expect(result.trace).toEqual({
    backend: "dev_cloud",
    endpoint: "https://liteasy.example.com/model-proxy",
    mode: "live",
    provider: "openai",
    source: "cloud_proxy"
  });
});
