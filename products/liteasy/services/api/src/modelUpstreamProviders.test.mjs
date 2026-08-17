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

test("retries structured OpenAI Responses once without text.format on compatible gateway failures", async (t) => {
  for (const status of [400, 422, 500, 502]) {
    await t.test(String(status), async () => {
      const bodies = [];
      const providers = createModelUpstreamProviders(config(), {
        fetchImpl: async (_url, init) => {
          bodies.push(JSON.parse(init.body));
          return bodies.length === 1
            ? new Response("schema unsupported", { status })
            : new Response(JSON.stringify({ output_text: "{\"summary\":\"validated downstream\"}" }), { status: 200 });
        }
      });
      const answer = await providers.openai.generate({
        outputFormat: {
          name: "thin_reading",
          schema: { properties: { summary: { type: "string" } }, required: ["summary"], type: "object" },
          strict: true
        },
        prompt: "Return JSON",
        provider: "openai"
      });
      assert.equal(answer, "{\"summary\":\"validated downstream\"}");
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0].text.format.type, "json_schema");
      assert.equal("text" in bodies[1], false);
      assert.match(bodies[1].input, /Return exactly one JSON object/);
      assert.match(bodies[1].input, /thin_reading/);
      assert.match(bodies[1].input, /\"summary\"/);
      assert.ok(bodies[1].input.startsWith("Return JSON"));
    });
  }
});

test("does not remove structured output while retrying only transient failures", async (t) => {
  for (const status of [401, 403, 429]) {
    await t.test(String(status), async () => {
      let calls = 0;
      const bodies = [];
      const providers = createModelUpstreamProviders(config(), {
        fetchImpl: async (_url, init) => {
          calls += 1;
          bodies.push(JSON.parse(init.body));
          return new Response("denied", { status });
        },
        waitImpl: async () => {}
      });
      await assert.rejects(() => providers.openai.generate({
        outputFormat: { name: "result", schema: { type: "object" }, strict: true },
        prompt: "Return JSON",
        provider: "openai"
      }), ModelUpstreamError);
      assert.equal(calls, status === 429 ? 3 : 1);
      assert.equal(bodies.every((body) => body.text?.format?.type === "json_schema"), true);
    });
  }
});

test("retries once when the provider times out before returning a response", async () => {
  let calls = 0;
  const providers = createModelUpstreamProviders(config(), {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("gateway timeout", { status: 504 })
        : new Response(JSON.stringify({ output_text: "Recovered answer" }), { status: 200 });
    },
    waitImpl: async () => {}
  });

  const answer = await providers.openai.generate({
    prompt: "Explain the paper",
    provider: "openai"
  });

  assert.equal(answer, "Recovered answer");
  assert.equal(calls, 2);
});

test("recovers from temporary unavailable responses within the bounded retry budget", async () => {
  let calls = 0;
  const delays = [];
  const providers = createModelUpstreamProviders(config(), {
    fetchImpl: async () => {
      calls += 1;
      return calls < 3
        ? new Response("temporarily unavailable", { status: 503 })
        : new Response(JSON.stringify({ output_text: "Recovered answer" }), { status: 200 });
    },
    waitImpl: async (milliseconds) => delays.push(milliseconds)
  });

  const answer = await providers.openai.generate({ prompt: "Explain", provider: "openai" });

  assert.equal(answer, "Recovered answer");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 750]);
});

test("honors a bounded Retry-After hint while recovering from rate limits", async () => {
  let calls = 0;
  const delays = [];
  const providers = createModelUpstreamProviders(config(), {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("busy", { headers: { "retry-after": "9" }, status: 429 })
        : new Response(JSON.stringify({ output_text: "Recovered answer" }), { status: 200 });
    },
    waitImpl: async (milliseconds) => delays.push(milliseconds)
  });

  assert.equal(await providers.openai.generate({ prompt: "Explain", provider: "openai" }), "Recovered answer");
  assert.deepEqual(delays, [2_000]);
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
      model: "deepseek-chat",
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

test("sends structured DeepSeek requests with an explicit JSON schema", async () => {
  let observed;
  const providers = createModelUpstreamProviders(config({
    deepseek: {
      apiKey: "deployment-deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      provider: "deepseek"
    }
  }), {
    fetchImpl: async (url, init) => {
      observed = { body: JSON.parse(init.body), url };
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"summary\":\"ok\"}" } }] }), { status: 200 });
    }
  });
  const answer = await providers.deepseek.generate({
    outputFormat: {
      name: "thin_reading",
      schema: { properties: { summary: { type: "string" } }, required: ["summary"], type: "object" },
      strict: true
    },
    prompt: "Summarize the paper",
    provider: "deepseek"
  });
  assert.equal(answer, "{\"summary\":\"ok\"}");
  assert.equal(observed.url, "https://api.deepseek.com/chat/completions");
  assert.equal(observed.body.model, "deepseek-chat");
  assert.equal(observed.body.max_tokens, 8_192);
  assert.deepEqual(observed.body.response_format, { type: "json_object" });
  assert.match(observed.body.messages[0].content, /thin_reading/);
  assert.match(observed.body.messages[0].content, /\"summary\"/);
});

test("retries a DeepSeek success response that has no assistant content", async () => {
  let calls = 0;
  const delays = [];
  const providers = createModelUpstreamProviders(config({
    deepseek: {
      apiKey: "deployment-deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      provider: "deepseek"
    }
  }), {
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(calls === 1
        ? { choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "hidden" } }] }
        : { choices: [{ finish_reason: "stop", message: { content: "{\"summary\":\"recovered\"}" } }] }), { status: 200 });
    },
    waitImpl: async (milliseconds) => delays.push(milliseconds)
  });

  const answer = await providers.deepseek.generate({ prompt: "Return JSON", provider: "deepseek" });

  assert.equal(answer, "{\"summary\":\"recovered\"}");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
});

test("does not expose DeepSeek reasoning content when bounded empty-response retries are exhausted", async () => {
  let calls = 0;
  const delays = [];
  const providers = createModelUpstreamProviders(config({
    deepseek: {
      apiKey: "deployment-deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      provider: "deepseek"
    }
  }), {
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "private reasoning" } }]
      }), { status: 200 });
    },
    waitImpl: async (milliseconds) => delays.push(milliseconds)
  });

  await assert.rejects(
    () => providers.deepseek.generate({ prompt: "Return JSON", provider: "deepseek" }),
    (error) => {
      assert.equal(error instanceof ModelUpstreamError, true);
      assert.equal(error.code, "model_provider_response_invalid");
      assert.equal(error.retryable, true);
      assert.equal(error.internalDetail, "DeepSeek response has no assistant content finishReason=length hasReasoningContent=true");
      assert.doesNotMatch(error.internalDetail, /private reasoning/);
      return true;
    }
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 750]);
});

test("retries an empty DeepSeek stream before exposing any response to the client", async () => {
  let calls = 0;
  const delays = [];
  const encoder = new TextEncoder();
  const providers = createModelUpstreamProviders(config({
    deepseek: {
      apiKey: "deployment-deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      provider: "deepseek"
    }
  }), {
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(JSON.parse(init.body).max_tokens, 8_192);
      const payload = calls === 1
        ? 'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
        : 'data: {"choices":[{"delta":{"content":"Recovered"}}]}\n\ndata: [DONE]\n\n';
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(payload));
          controller.close();
        }
      }), { status: 200 });
    },
    waitImpl: async (milliseconds) => delays.push(milliseconds)
  });

  const deltas = [];
  for await (const delta of providers.deepseek.stream({ prompt: "Summarize", provider: "deepseek" })) {
    deltas.push(delta);
  }

  assert.deepEqual(deltas, ["Recovered"]);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
});

test("does not retry a DeepSeek stream after visible content has been emitted", async () => {
  let calls = 0;
  const encoder = new TextEncoder();
  const providers = createModelUpstreamProviders(config({
    deepseek: {
      apiKey: "deployment-deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      provider: "deepseek"
    }
  }), {
    fetchImpl: async () => {
      calls += 1;
      let pulls = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'));
            return;
          }
          controller.error(new DOMException("timed out", "AbortError"));
        }
      }), { status: 200 });
    },
    waitImpl: async () => assert.fail("a partially emitted stream must not be retried")
  });

  const deltas = [];
  await assert.rejects(async () => {
    for await (const delta of providers.deepseek.stream({ prompt: "Summarize", provider: "deepseek" })) {
      deltas.push(delta);
    }
  }, (error) => error instanceof ModelUpstreamError && error.code === "model_provider_timeout");
  assert.deepEqual(deltas, ["Partial"]);
  assert.equal(calls, 1);
});

test("keeps empty DeepSeek stream diagnostics content-free after retries are exhausted", async () => {
  let calls = 0;
  const encoder = new TextEncoder();
  const providers = createModelUpstreamProviders(config({
    deepseek: {
      apiKey: "deployment-deepseek-secret",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      provider: "deepseek"
    }
  }), {
    fetchImpl: async () => {
      calls += 1;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'data: {"choices":[{"delta":{"reasoning_content":"private stream reasoning"},"finish_reason":"length"}]}\n\n'
          ));
          controller.close();
        }
      }), { status: 200 });
    },
    waitImpl: async () => {}
  });

  await assert.rejects(async () => {
    for await (const _delta of providers.deepseek.stream({ prompt: "Summarize", provider: "deepseek" })) {
      // Consume the stream so empty-response validation runs.
    }
  }, (error) => {
    assert.equal(error instanceof ModelUpstreamError, true);
    assert.equal(error.internalDetail, "DeepSeek stream has no assistant content finishReason=length hasReasoningContent=true");
    assert.doesNotMatch(error.internalDetail, /private stream reasoning/);
    return true;
  });
  assert.equal(calls, 3);
});

test("reports an upstream timeout that occurs while reading the streaming response body", async () => {
  const providers = createModelUpstreamProviders(config(), {
    fetchImpl: async () => new Response(new ReadableStream({
      pull() {
        throw new DOMException("timed out", "AbortError");
      }
    }), { status: 200 })
  });

  await assert.rejects(async () => {
    for await (const _delta of providers.openai.stream({ prompt: "Summarize", provider: "openai" })) {
      // Consume the stream so response-body failures are observed.
    }
  }, (error) => {
    assert.equal(error instanceof ModelUpstreamError, true);
    assert.equal(error.code, "model_provider_timeout");
    assert.equal(error.status, 504);
    return true;
  });
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
