import { createModelGatewayFromSettings } from "../app/features/models/modelRuntime";
import {
  clearTrustedModelProxyEndpointsForTests,
  trustModelProxyEndpointFromPolicy
} from "../app/features/models/modelProxyTrust";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { beforeEach } from "vitest";

beforeEach(() => clearTrustedModelProxyEndpointsForTests());

test("uses the real local cloud endpoint by default with an injected test transport", async () => {
  const settings = createSettingsStore().getState();
  const gateway = createModelGatewayFromSettings(settings, {
    cloudTransport: async () => ({
      json: async () => ({
        answer: "test transport answer",
        execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
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

  expect(result.answer).toBe("test transport answer");
  expect(result.trace).toEqual({
    backend: "dev_cloud",
    endpoint: "http://127.0.0.1:8787",
    mode: "live",
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

test.each([
  "https://api.mosshubs.com/v1",
  "https://api.openai.com/v1",
  "https://nowcoding.ai/v1"
])("rejects a direct model upstream used as the cloud proxy endpoint: %s", (endpoint) => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: endpoint
  });

  expect(() => createModelGatewayFromSettings(store.getState())).toThrow(
    "已阻止前端直连模型上游"
  );
});

test("rejects credentials and query secrets in the cloud proxy endpoint", () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://user:secret@liteasy.example.com/model-proxy?token=secret"
  });

  expect(() => createModelGatewayFromSettings(store.getState())).toThrow(
    "不能包含凭据、查询参数或片段"
  );
});

test("rejects an arbitrary remote proxy until a control-plane policy trusts it", () => {
  const store = createSettingsStore();
  const endpoint = "https://models.customer.example/liteasy-proxy";
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: endpoint
  });

  expect(() => createModelGatewayFromSettings(store.getState())).toThrow(
    "尚未通过控制面策略验证"
  );

  trustModelProxyEndpointFromPolicy(endpoint);
  expect(() => createModelGatewayFromSettings(store.getState())).not.toThrow();
});
