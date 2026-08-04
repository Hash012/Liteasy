import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderRegistry,
  createOpenAIModelFailoverProvider,
  createOpenAIModelFailoverStreamProvider,
  generateAnswer,
  openAIModelFailoverOrder
} from "./modelPayloads.mjs";

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

test("falls through tera, luna, then sol after explicitly retryable upstream failures", async () => {
  const attemptedModels = [];
  const provider = createOpenAIModelFailoverProvider(async ({ model }) => {
    attemptedModels.push(model);
    if (model !== "gpt-5.6-sol") {
      const error = new Error("upstream temporarily unavailable");
      error.status = 503;
      error.retryable = true;
      throw error;
    }
    return "sol recovered the request";
  });

  assert.equal(await provider({ model: "ignored-by-reliability-policy", prompt: "test" }), "sol recovered the request");
  assert.deepEqual(attemptedModels, openAIModelFailoverOrder);
});

test("does not hide permanent OpenAI errors behind model failover", async () => {
  const attemptedModels = [];
  const provider = createOpenAIModelFailoverProvider(async ({ model }) => {
    attemptedModels.push(model);
    const error = new Error("invalid API key");
    error.status = 401;
    error.retryable = false;
    throw error;
  });

  await assert.rejects(provider({ prompt: "test" }), /invalid API key/);
  assert.deepEqual(attemptedModels, ["gpt-5.6-terra"]);
});

test("switches stream models before any output but never mixes streamed answers", async () => {
  const attemptedModels = [];
  const provider = createOpenAIModelFailoverStreamProvider(async function* ({ model }) {
    attemptedModels.push(model);
    if (model === "gpt-5.6-terra") {
      const error = new Error("gateway timeout");
      error.status = 504;
      error.retryable = true;
      throw error;
    }
    yield "recovered stream";
  });

  const chunks = [];
  for await (const chunk of provider({ prompt: "test" })) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ["recovered stream"]);
  assert.deepEqual(attemptedModels, ["gpt-5.6-terra", "gpt-5.6-luna"]);
});
