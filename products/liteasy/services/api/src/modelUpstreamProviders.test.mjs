import assert from "node:assert/strict";
import test from "node:test";
import {
  createModelUpstreamProviders,
  ModelUpstreamError
} from "./modelUpstreamProviders.mjs";

function config(overrides = {}) {
  return {
    providers: {
      openai: {
        apiKey: "deployment-openai-secret",
        baseUrl: "https://api.openai.example/v1",
        model: "gpt-5-mini",
        provider: "openai"
      },
      ...overrides
    },
    timeoutMs: 1000
  };
}

test("uses only the deployment model and credential for OpenAI Responses", async () => {
  let observed;
  const providers = createModelUpstreamProviders(config(), {
    fetchImpl: async (url, init) => {
      observed = { body: JSON.parse(init.body), headers: init.headers, url };
      return new Response(JSON.stringify({ output_text: "Grounded answer" }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      });
    }
  });

  const answer = await providers.openai.generate({
    model: "client-value-is-not-forwarded",
    prompt: "Explain the paper",
    provider: "openai"
  });

  assert.equal(answer, "Grounded answer");
  assert.equal(observed.url, "https://api.openai.example/v1/responses");
  assert.equal(observed.body.model, "gpt-5-mini");
  assert.equal(observed.body.input, "Explain the paper");
  assert.equal(observed.headers.Authorization, "Bearer deployment-openai-secret");
});

test("parses fragmented DeepSeek SSE without returning reasoning fields", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"hidden","content":"Hel"}}]}\n'));
      controller.enqueue(encoder.encode('\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  const providers = createModelUpstreamProviders(config({
    deepseek: {
      apiKey: "deployment-deepseek-secret",
      baseUrl: "https://api.deepseek.example",
      model: "deepseek-v4-flash",
      provider: "deepseek"
    }
  }), {
    fetchImpl: async () => new Response(stream, { status: 200 })
  });

  const deltas = [];
  for await (const delta of providers.deepseek.stream({ prompt: "Summarize", provider: "deepseek" })) {
    deltas.push(delta);
  }
  assert.deepEqual(deltas, ["Hel", "lo"]);
});

test("keeps raw upstream errors inside the server boundary", async () => {
  const providers = createModelUpstreamProviders(config(), {
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: "invalid deployment key sk-private-detail" }
    }), { status: 401 })
  });

  await assert.rejects(
    () => providers.openai.generate({ prompt: "Private paper text", provider: "openai" }),
    (error) => {
      assert.equal(error instanceof ModelUpstreamError, true);
      assert.equal(error.code, "model_provider_unavailable");
      assert.equal(error.message.includes("sk-private-detail"), false);
      assert.equal(error.internalDetail.includes("sk-private-detail"), false);
      assert.match(error.internalDetail, /upstream status=401 errorBodyBytes=/);
      return true;
    }
  );
});
