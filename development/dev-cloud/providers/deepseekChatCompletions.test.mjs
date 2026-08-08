import test from "node:test";
import assert from "node:assert/strict";
import {
  compactDeepSeekPrompt,
  createDeepSeekChatCompletionsProvider
} from "./deepseekChatCompletions.mjs";

test("compacts an oversized prompt while preserving its instructions and evidence tail", () => {
  const prompt = `instructions:${"a".repeat(90_000)}evidence-tail`;
  const compacted = compactDeepSeekPrompt(prompt, 10_000);

  assert.ok(compacted.length <= 10_000);
  assert.ok(compacted.startsWith("instructions:"));
  assert.ok(compacted.endsWith("evidence-tail"));
  assert.match(compacted, /middle evidence omitted/);
});

test("recovers a rejected long structured request with a bounded plain-JSON prompt", async () => {
  const requestBodies = [];
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async (_url, init) => {
      requestBodies.push(JSON.parse(init.body));
      if (requestBodies.length < 3) {
        return new Response(JSON.stringify({ error: { message: "request body rejected" } }), {
          headers: { "content-type": "application/json" },
          status: 400
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    }
  });
  const prompt = `instructions:${"x".repeat(120_000)}evidence-tail`;

  const answer = await provider({
    model: "deepseek-v4-flash",
    outputFormat: { name: "thin_reading", schema: { type: "object" }, strict: true },
    prompt
  });

  assert.equal(answer, "{}");
  assert.equal(requestBodies.length, 3);
  assert.deepEqual(requestBodies[0].response_format, { type: "json_object" });
  assert.equal(requestBodies[1].response_format, undefined);
  assert.equal(requestBodies[2].response_format, undefined);
  assert.ok(requestBodies[2].messages[0].content.length <= 80_000);
  assert.ok(requestBodies[2].messages[0].content.startsWith("instructions:"));
  assert.ok(requestBodies[2].messages[0].content.endsWith("evidence-tail"));
});

test("posts to the DeepSeek chat completions API and extracts assistant content", async () => {
  let capturedRequest;
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async (url, init) => {
      capturedRequest = { init, url };

      return {
        json: async () => ({
          choices: [
            {
              message: {
                content: "这是来自 DeepSeek 的回答",
                role: "assistant"
              }
            }
          ],
          id: "deepseek-response-1",
          model: "deepseek-v4-flash",
          object: "chat.completion"
        }),
        ok: true,
        status: 200
      };
    }
  });

  const answer = await provider({
    model: "deepseek-v4-flash",
    prompt: "问题：LiteasyClaw 的命令模式应该做什么？",
    provider: "deepseek",
    source: "cloud_proxy"
  });

  assert.equal(answer, "这是来自 DeepSeek 的回答");
  assert.deepEqual(capturedRequest, {
    init: {
      body: JSON.stringify({
        messages: [
          {
            content: "问题：LiteasyClaw 的命令模式应该做什么？",
            role: "user"
          }
        ],
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        stream: false
      }),
      headers: {
        Authorization: "Bearer sk-deepseek-test",
        "Content-Type": "application/json"
      },
      method: "POST"
    },
    url: "https://api.deepseek.com/chat/completions"
  });
});

test("requests JSON-object mode for structured artifacts", async () => {
  let requestBody;
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
        ok: true,
        status: 200
      };
    }
  });

  await provider({
    model: "deepseek-v4-flash",
    outputFormat: {
      name: "liteasy_thin_reading",
      schema: { type: "object" },
      strict: true
    },
    prompt: "Return JSON."
  });

  assert.deepEqual(requestBody.response_format, { type: "json_object" });
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
});

test("retries once without JSON-object mode when a compatible DeepSeek endpoint rejects it", async () => {
  const requestBodies = [];
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async (_url, init) => {
      requestBodies.push(JSON.parse(init.body));
      if (requestBodies.length === 1) {
        return {
          json: async () => ({ error: { message: "response_format is unsupported" } }),
          ok: false,
          status: 400
        };
      }
      return {
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
        ok: true,
        status: 200
      };
    }
  });

  const answer = await provider({
    model: "deepseek-v4-flash",
    outputFormat: { name: "thin_reading", schema: { type: "object" }, strict: true },
    prompt: "Return JSON."
  });

  assert.equal(answer, "{}");
  assert.equal(requestBodies.length, 2);
  assert.deepEqual(requestBodies[0].response_format, { type: "json_object" });
  assert.equal(requestBodies[1].response_format, undefined);
});

test("retries transient DeepSeek failures before returning a structured answer", async () => {
  let attempts = 0;
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          body: { cancel: async () => undefined },
          ok: false,
          status: 503
        };
      }
      return {
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
        ok: true,
        status: 200
      };
    }
  });

  const answer = await provider({
    model: "deepseek-v4-flash",
    outputFormat: { name: "thin_reading", schema: { type: "object" }, strict: true },
    prompt: "Return JSON."
  });

  assert.equal(answer, "{}");
  assert.equal(attempts, 2);
});

test("retries an otherwise successful empty completion before failing", async () => {
  let attempts = 0;
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async () => {
      attempts += 1;
      return {
        json: async () => attempts === 1
          ? { choices: [{ finish_reason: "insufficient_system_resource", message: { content: null } }] }
          : { choices: [{ message: { content: "{}" } }] },
        ok: true,
        status: 200
      };
    }
  });

  const answer = await provider({ model: "deepseek-v4-flash", prompt: "Return JSON." });

  assert.equal(answer, "{}");
  assert.equal(attempts, 2);
});

test("reports the DeepSeek finish reason when its completion stays empty", async () => {
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async () => ({
      json: async () => ({
        choices: [{
          finish_reason: "insufficient_system_resource",
          message: { content: null, reasoning_content: "partial reasoning" }
        }]
      }),
      ok: true,
      status: 200
    })
  });

  await assert.rejects(
    provider({ model: "deepseek-v4-flash", prompt: "Return JSON." }),
    /返回为空.*finish_reason=insufficient_system_resource.*reasoning_content=present/
  );
});

test("throws a readable error when the DeepSeek provider returns a non-ok status", async () => {
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async () => ({
      json: async () => ({
        error: {
          message: "insufficient balance"
        }
      }),
      ok: false,
      status: 402
    })
  });

  await assert.rejects(
    provider({
      model: "deepseek-v4-flash",
      prompt: "问题：LiteasyClaw 的命令模式应该做什么？",
      provider: "deepseek",
      source: "cloud_proxy"
    }),
    /DeepSeek Chat Completions API 请求失败.*402.*insufficient balance/
  );
});

test("preserves a non-JSON proxy error and safe request metadata", async () => {
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async () => new Response("proxy rejected request body", { status: 400 })
  });

  await assert.rejects(
    provider({
      model: "deepseek-v4-flash",
      prompt: "diagnostic prompt",
      provider: "deepseek"
    }),
    /proxy rejected request body.*model=deepseek-v4-flash.*promptChars=17.*jsonMode=false/
  );
});
