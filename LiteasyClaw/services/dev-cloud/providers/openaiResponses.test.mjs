import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  createOpenAIResponsesProvider,
  createOpenAIResponsesStreamProvider
} from "./openaiResponses.mjs";

test("posts to the OpenAI Responses API and extracts text output", async () => {
  let capturedRequest;
  const provider = createOpenAIResponsesProvider({
    apiKey: "sk-test",
    fetchImpl: async (url, init) => {
      capturedRequest = { init, url };

      return {
        json: async () => ({
          output: [
            {
              content: [
                {
                  text: "这是来自真实 provider 的回答",
                  type: "output_text"
                }
              ],
              type: "message"
            }
          ]
        }),
        ok: true,
        status: 200
      };
    }
  });

  const answer = await provider({
    model: "gpt-5-mini",
    prompt: "问题：BERT 的核心方法是什么？",
    provider: "openai",
    source: "cloud_proxy"
  });

  assert.equal(answer, "这是来自真实 provider 的回答");
  assert.deepEqual(capturedRequest, {
    init: {
      body: JSON.stringify({
        input: "问题：BERT 的核心方法是什么？",
        model: "gpt-5-mini"
      }),
      headers: {
        Authorization: "Bearer sk-test",
        "Content-Type": "application/json"
      },
      method: "POST"
    },
    url: "https://api.openai.com/v1/responses"
  });
});

test("requests strict JSON Schema output when an artifact supplies an output format", async () => {
  let requestBody;
  const provider = createOpenAIResponsesProvider({
    apiKey: "sk-test",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {
        json: async () => ({ output_text: "{}" }),
        ok: true,
        status: 200
      };
    }
  });

  await provider({
    model: "gpt-5-mini",
    outputFormat: {
      name: "liteasy_thin_reading",
      schema: { additionalProperties: false, type: "object" },
      strict: true
    },
    prompt: "Return a thin reading JSON object."
  });

  assert.deepEqual(requestBody.text, {
    format: {
      name: "liteasy_thin_reading",
      schema: { additionalProperties: false, type: "object" },
      strict: true,
      type: "json_schema"
    }
  });
});

test("retries once without schema fields when an OpenAI-compatible endpoint rejects them", async () => {
  const requestBodies = [];
  const provider = createOpenAIResponsesProvider({
    apiKey: "sk-test",
    fetchImpl: async (_url, init) => {
      requestBodies.push(JSON.parse(init.body));
      if (requestBodies.length === 1) {
        return {
          json: async () => ({ error: { message: "unknown parameter: text.format" } }),
          ok: false,
          status: 400
        };
      }
      return {
        json: async () => ({ output_text: "{}" }),
        ok: true,
        status: 200
      };
    }
  });

  const answer = await provider({
    model: "gpt-5-mini",
    outputFormat: { name: "thin_reading", schema: { type: "object" }, strict: true },
    prompt: "Return JSON."
  });

  assert.equal(answer, "{}");
  assert.equal(requestBodies.length, 2);
  assert.ok(requestBodies[0].text?.format);
  assert.equal(requestBodies[1].text, undefined);
});

test("throws a readable error when the OpenAI provider returns a non-ok status", async () => {
  const provider = createOpenAIResponsesProvider({
    apiKey: "sk-test",
    fetchImpl: async () => ({
      json: async () => ({
        error: {
          message: "quota exceeded"
        }
      }),
      ok: false,
      status: 429
    })
  });

  await assert.rejects(
    provider({
      model: "gpt-5-mini",
      prompt: "问题：BERT 的核心方法是什么？",
      provider: "openai",
      source: "cloud_proxy"
    }),
    /OpenAI Responses API 请求失败.*429.*quota exceeded/
  );
});

test("preserves string error payloads returned by OpenAI-compatible proxies", async () => {
  const provider = createOpenAIResponsesProvider({
    apiKey: "sk-test",
    fetchImpl: async () => ({
      json: async () => ({ error: "model gpt-5.5 is unavailable" }),
      ok: false,
      status: 404
    })
  });

  await assert.rejects(
    provider({ model: "gpt-5.5", prompt: "test" }),
    /404.*model gpt-5.5 is unavailable/
  );
});

test("adds a sanitized endpoint and network cause to connection failures", async () => {
  const provider = createOpenAIResponsesProvider({
    apiBaseUrl: "https://proxy.example.test/v1?token=secret",
    apiKey: "sk-test",
    fetchImpl: async () => {
      const error = new Error("fetch failed");
      error.cause = { code: "ECONNRESET" };
      throw error;
    }
  });

  await assert.rejects(
    provider({ model: "gpt-5.5", prompt: "test" }),
    (error) => {
      assert.match(error.message, /endpoint=https:\/\/proxy\.example\.test\/v1/);
      assert.match(error.message, /ECONNRESET/);
      assert.doesNotMatch(error.message, /token=secret/);
      return true;
    }
  );
});

test("retries transient 503 responses before returning a live answer", async () => {
  let attempts = 0;
  const provider = createOpenAIResponsesProvider({
    apiKey: "sk-test",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return {
          body: { cancel: async () => undefined },
          json: async () => ({ error: { message: "temporarily unavailable" } }),
          ok: false,
          status: 503
        };
      }
      return {
        json: async () => ({ output_text: "recovered" }),
        ok: true,
        status: 200
      };
    }
  });

  assert.equal(await provider({ model: "gpt-5.5", prompt: "test" }), "recovered");
  assert.equal(attempts, 3);
});

test("yields output_text deltas from the OpenAI Responses SSE stream", async () => {
  let capturedBody;
  const provider = createOpenAIResponsesStreamProvider({
    apiKey: "sk-test",
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        body: Readable.from([
          Buffer.from('data: {"type":"response.output_text.delta","delta":"Hello "}\n\n'),
          Buffer.from('data: {"type":"response.output_text.delta","delta":"stream"}\n\n'),
          Buffer.from('data: {"type":"response.completed"}\n\n')
        ]),
        ok: true,
        status: 200
      };
    }
  });
  const deltas = [];

  for await (const delta of provider({ model: "gpt-5.5", prompt: "test" })) {
    deltas.push(delta);
  }

  assert.deepEqual(deltas, ["Hello ", "stream"]);
  assert.equal(capturedBody.stream, true);
});

test("extracts full text from response.completed when a proxy omits deltas", async () => {
  const provider = createOpenAIResponsesStreamProvider({
    apiKey: "sk-test",
    fetchImpl: async () => ({
      body: Readable.from([
        Buffer.from('data: {"type":"response.completed","response":{"output_text":"completed text"}}\n\n')
      ]),
      ok: true,
      status: 200
    })
  });
  const deltas = [];

  for await (const delta of provider({ model: "gpt-5.5", prompt: "test" })) {
    deltas.push(delta);
  }

  assert.deepEqual(deltas, ["completed text"]);
});

test("reopens the stream once when an upstream response contains no text", async () => {
  let attempts = 0;
  const provider = createOpenAIResponsesStreamProvider({
    apiKey: "sk-test",
    fetchImpl: async () => {
      attempts += 1;
      return {
        body: Readable.from([
          attempts === 1
            ? Buffer.from('data: {"type":"response.completed"}\n\n')
            : Buffer.from('data: {"type":"response.output_text.delta","delta":"recovered"}\n\n')
        ]),
        ok: true,
        status: 200
      };
    }
  });
  const deltas = [];

  for await (const delta of provider({ model: "gpt-5.5", prompt: "test" })) {
    deltas.push(delta);
  }

  assert.deepEqual(deltas, ["recovered"]);
  assert.equal(attempts, 2);
});
