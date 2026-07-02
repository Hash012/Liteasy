import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderRegistry } from "./modelPayloads.mjs";

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
