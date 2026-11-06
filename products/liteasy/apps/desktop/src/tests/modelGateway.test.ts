import { createModelGateway } from "../app/features/models/modelGateway";

test("uses the cloud model path when provider and model are allowed", async () => {
  const gateway = createModelGateway({
    cloudModel: async () => ({
      answer: "cloud answer",
      trace: {
        backend: "http_service",
        endpoint: "https://example.com/cloud",
        mode: "unknown",
        provider: "openai",
        source: "cloud_proxy"
      }
    }),
    policy: {
      allowedModels: ["gpt-6.1-terra"],
      allowedProviders: ["openai"]
    }
  });

  const result = await gateway.generateAnswer({
    model: "gpt-6.1-terra",
    prompt: "hello",
    provider: "openai"
  });

  expect(result.answer).toBe("cloud answer");
});

test("rejects a request when the model is not allowed by cloud policy", async () => {
  const gateway = createModelGateway({
    cloudModel: async () => ({
      answer: "cloud answer",
      trace: {
        backend: "http_service",
        endpoint: "https://example.com/cloud",
        mode: "unknown",
        provider: "openai",
        source: "cloud_proxy"
      }
    }),
    policy: {
      allowedModels: ["gpt-4.1"],
      allowedProviders: ["openai"]
    }
  });

  await expect(
    gateway.generateAnswer({
      model: "gpt-6.1-terra",
      prompt: "hello",
      provider: "openai"
    })
  ).rejects.toThrow(/云端策略未开放该模型/);
});
