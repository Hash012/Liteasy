import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderRegistry, generateAnswer } from "./modelPayloads.mjs";

test("registers a DeepSeek provider when a DeepSeek api key is configured", () => {
  const providers = buildProviderRegistry({
    deepseekApiBaseUrl: "https://api.deepseek.com",
    deepseekApiKey: "sk-deepseek-test"
  });

  assert.equal(typeof providers.deepseek, "function");
});

test("does not register a DeepSeek provider when no DeepSeek api key is configured", () => {
  const providers = buildProviderRegistry({
    deepseekApiBaseUrl: "https://api.deepseek.com"
  });

  assert.equal(providers.deepseek, null);
});

test("rejects live-only generation instead of using the OpenAI mock fallback", async () => {
  await assert.rejects(
    generateAnswer({
      model: "gpt-5-mini",
      prompt: "thin reading",
      provider: "openai",
      requireLive: true
    }, buildProviderRegistry({})),
    /未配置真实 provider：openai/
  );
});
