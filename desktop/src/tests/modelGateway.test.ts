import { createModelGateway } from "../app/features/models/modelGateway";

test("uses local direct model access when policy allows it", async () => {
  const gateway = createModelGateway({
    cloudProxy: async () => ({
      answer: "cloud answer",
      trace: {
        backend: "http_service",
        endpoint: "https://example.com/cloud",
        mode: "unknown",
        provider: "openai",
        source: "cloud_proxy"
      }
    }),
    localDirect: async () => ({
      answer: "local answer",
      trace: {
        backend: "http_service",
        endpoint: "https://example.com/local",
        mode: "unknown",
        provider: "openai",
        source: "local_direct"
      }
    }),
    policy: {
      allowedModels: ["gpt-5-mini"],
      allowedProviders: ["openai"],
      localDirectEnabled: true,
      modelAccessMode: "local_direct"
    }
  });

  const result = await gateway.generateAnswer({
    model: "gpt-5-mini",
    prompt: "hello",
    provider: "openai"
  });

  expect(result.answer).toBe("local answer");
});

test("rejects local direct mode when cloud policy disables it", async () => {
  const gateway = createModelGateway({
    cloudProxy: async () => ({
      answer: "cloud answer",
      trace: {
        backend: "http_service",
        endpoint: "https://example.com/cloud",
        mode: "unknown",
        provider: "openai",
        source: "cloud_proxy"
      }
    }),
    localDirect: async () => ({
      answer: "local answer",
      trace: {
        backend: "http_service",
        endpoint: "https://example.com/local",
        mode: "unknown",
        provider: "openai",
        source: "local_direct"
      }
    }),
    policy: {
      allowedModels: ["gpt-5-mini"],
      allowedProviders: ["openai"],
      localDirectEnabled: false,
      modelAccessMode: "local_direct"
    }
  });

  await expect(
    gateway.generateAnswer({
      model: "gpt-5-mini",
      prompt: "hello",
      provider: "openai"
    })
  ).rejects.toThrow(/云端策略未开放本地直连模型能力/);
});
