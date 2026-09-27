import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderRegistry,
  createOpenAIModelFailoverProvider,
  createOpenAIModelFailoverStreamProvider,
  generateAnswer,
  generateAnswerStream,
  openAIModelFailoverOrder
} from "./modelPayloads.mjs";

test("rejects invalid, excessive, and unsupported image input before calling a provider", async () => {
  let calls = 0;
  const providers = { openai: async () => { calls += 1; return "answer"; }, deepseek: async () => { calls += 1; return "text-only answer"; } };
  const image = { mediaType: "image/png", label: "原图", base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64") };
  await assert.rejects(generateAnswer({ provider: "openai", images: Array(13).fill(image) }, providers), /最多读取 12/);
  await assert.rejects(generateAnswer({ provider: "openai", images: [{ ...image, base64: Buffer.from("not an image").toString("base64") }] }, providers), /内容与格式/);
  await assert.rejects(generateAnswer({ provider: "deepseek", images: [image] }, providers), /不支持图片/);
  await assert.rejects(generateAnswer({ provider: "openai", images: [{ ...image, base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }] }, providers), /超过 5 MB/);
  await assert.rejects(generateAnswer({ provider: "openai", images: [{ ...image, label: "x".repeat(1001) }] }, providers), /图片数据无效/);
  await assert.rejects(generateAnswer({ provider: "openai", images: [{ ...image, label: "图\u0000片" }] }, providers), /图片数据无效/);
  await assert.rejects(generateAnswer({ provider: "openai", images: [{ ...image, base64: "AA==" }] }, providers), /图片编码无效/);
  assert.equal(calls, 0);
});

test("keeps image inputs in streaming and non-streaming provider fallback paths", async () => {
  const image = { mediaType: "image/png", label: "原图", base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64") };
  const inputs = [];
  const body = { provider: "openai", prompt: "图片", images: [image] };
  for (const streaming of [true, false]) {
    const providers = { openai: async (input) => { inputs.push(input); return "图片回答"; } };
    const streamingProviders = streaming ? { openai: async function* (input) { inputs.push(input); yield "图片回答"; } } : {};
    const events = [];
    for await (const event of generateAnswerStream(body, providers, streamingProviders)) events.push(event);
    assert.equal(events.at(-1).type, "completed");
  }
  assert.deepEqual(inputs.map((input) => input.images), [[image], [image]]);
});

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

  assert.equal(await provider({ model: "gpt-5.6-terra", prompt: "test" }), "sol recovered the request");
  assert.deepEqual(attemptedModels, openAIModelFailoverOrder);
});

test("honors the configured model before bounded fallback candidates", async () => {
  const attemptedModels = [];
  const provider = createOpenAIModelFailoverProvider(async ({ model }) => {
    attemptedModels.push(model);
    return "configured model answer";
  });

  assert.equal(
    await provider({ model: "gpt-5.4-mini", prompt: "test" }),
    "configured model answer"
  );
  assert.deepEqual(attemptedModels, ["gpt-5.4-mini"]);
});

test("skips an unavailable fallback model and continues to the next candidate", async () => {
  const attemptedModels = [];
  const provider = createOpenAIModelFailoverProvider(async ({ model }) => {
    attemptedModels.push(model);
    if (model === "gpt-5.6-terra") {
      const error = new Error("upstream temporarily unavailable");
      error.status = 503;
      error.retryable = true;
      throw error;
    }
    if (model === "gpt-5.6-luna") {
      const error = new Error('Model "gpt-5.6-luna" is not supported');
      error.status = 404;
      error.retryable = false;
      throw error;
    }
    return "sol recovered the request";
  });

  assert.equal(
    await provider({ model: "gpt-5.6-terra", prompt: "test" }),
    "sol recovered the request"
  );
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

test("stream failover skips an unavailable model before emitting output", async () => {
  const attemptedModels = [];
  const provider = createOpenAIModelFailoverStreamProvider(async function* ({ model }) {
    attemptedModels.push(model);
    if (model === "gpt-5.6-terra") {
      const error = new Error("gateway unavailable");
      error.status = 503;
      error.retryable = true;
      throw error;
    }
    if (model === "gpt-5.6-luna") {
      const error = new Error('Model "gpt-5.6-luna" is not supported');
      error.status = 404;
      error.retryable = false;
      throw error;
    }
    yield "sol recovered stream";
  });

  const chunks = [];
  for await (const chunk of provider({ model: "gpt-5.6-terra", prompt: "test" })) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ["sol recovered stream"]);
  assert.deepEqual(attemptedModels, openAIModelFailoverOrder);
});
