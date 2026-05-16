import { createModelGateway } from "../app/features/models/modelGateway";

test("uses cloud proxy path by default when policy is cloud-governed", async () => {
  const calls: string[] = [];
  const gateway = createModelGateway({
    cloudModel: async ({ prompt }) => {
      calls.push(`cloud:${prompt}`);
      return {
        answer: "cloud answer",
        trace: {
          backend: "http_service",
          endpoint: "https://example.com/cloud",
          mode: "unknown",
          provider: "openai",
          source: "cloud_proxy"
        }
      };
    },
    policy: {
      allowedModels: ["gpt-5-mini"],
      allowedProviders: ["openai"]
    }
  });

  const result = await gateway.generateAnswer({
    model: "gpt-5-mini",
    prompt: "Explain BERT pretraining",
    provider: "openai"
  });

  expect(result.answer).toBe("cloud answer");
  expect(calls).toEqual(["cloud:Explain BERT pretraining"]);
});
