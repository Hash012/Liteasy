import assert from "node:assert/strict";
import test from "node:test";
import {
  deepSeekVisualizationAdapter,
  openAiCompatibleVisualizationAdapter
} from "./visualizationStructuredProviderAdapter.mjs";

const route = {
  endpoint: "https://provider.example/v1/responses",
  model: "visual-model-1",
  operations: ["structured_generation", "validation"]
};
const payload = {
  prompt: "<evidence>bounded input</evidence>",
  schema: { additionalProperties: false, properties: { nodes: { type: "array" } }, required: ["nodes"], type: "object" },
  schemaName: "semantic_graph_proposal"
};

test("sends the exact strict Responses schema through the gateway request", async () => {
  const calls = [];
  const result = await openAiCompatibleVisualizationAdapter.generateStructured({
    payload,
    request: async (url, init) => {
      calls.push({ init, url });
      return new Response(JSON.stringify({ output_text: "{\"nodes\":[]}" }), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    },
    route
  });
  assert.deepEqual(result, { text: "{\"nodes\":[]}" });
  assert.equal(calls[0].url, route.endpoint);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    input: payload.prompt,
    model: route.model,
    text: { format: { name: payload.schemaName, schema: payload.schema, strict: true, type: "json_schema" } }
  });
  assert.deepEqual(calls[0].init.headers, { "content-type": "application/json" });
});

test("sends structured visualization schemas through DeepSeek chat completions", async () => {
  let observed;
  const result = await deepSeekVisualizationAdapter.generateStructured({
    payload,
    request: async (url, init) => {
      observed = { body: JSON.parse(init.body), url };
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"nodes\":[]}" } }] }), { status: 200 });
    },
    route: { ...route, endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" }
  });
  assert.deepEqual(result, { text: "{\"nodes\":[]}" });
  assert.equal(observed.url, "https://api.deepseek.com/chat/completions");
  assert.equal(observed.body.model, "deepseek-chat");
  assert.deepEqual(observed.body.response_format, { type: "json_object" });
  assert.equal(observed.body.stream, false);
  assert.match(observed.body.messages[0].content, /semantic_graph_proposal/);
  assert.match(observed.body.messages[0].content, /\"nodes\"/);
});

test("retries structured generation without text.format only for compatibility statuses", async (t) => {
  for (const status of [400, 422, 500, 502]) {
    await t.test(String(status), async () => {
      const bodies = [];
      const result = await openAiCompatibleVisualizationAdapter.generateStructured({
        payload,
        request: async (_url, init) => {
          bodies.push(JSON.parse(init.body));
          return bodies.length === 1
            ? new Response("schema unsupported", { status })
            : new Response(JSON.stringify({ output_text: "{\"nodes\":[]}" }), { status: 200 });
        },
        route
      });
      assert.deepEqual(result, { text: "{\"nodes\":[]}" });
      assert.equal(bodies[0].text.format.strict, true);
      assert.equal("text" in bodies[1], false);
      assert.match(bodies[1].input, /Return exactly one JSON object/);
      assert.match(bodies[1].input, /semantic_graph_proposal/);
      assert.match(bodies[1].input, /\"additionalProperties\":false/);
      assert.ok(bodies[1].input.startsWith(payload.prompt));
    });
  }
});

test("does not retry structured generation on authentication failures", async (t) => {
  for (const status of [401, 403]) {
    await t.test(String(status), async () => {
      let calls = 0;
      await assert.rejects(() => openAiCompatibleVisualizationAdapter.generateStructured({
        payload,
        request: async () => {
          calls += 1;
          return new Response("denied", { status });
        },
        route
      }), /visualization_provider_unavailable/);
      assert.equal(calls, 1);
    });
  }
});

test("recovers structured generation from temporary rate limits without dropping the schema", async () => {
  const bodies = [];
  const result = await openAiCompatibleVisualizationAdapter.generateStructured({
    payload,
    request: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length < 3
        ? new Response("busy", { headers: { "retry-after": "0" }, status: 429 })
        : new Response(JSON.stringify({ output_text: "{\"nodes\":[]}" }), { status: 200 });
    },
    route
  });

  assert.deepEqual(result, { text: "{\"nodes\":[]}" });
  assert.equal(bodies.length, 3);
  assert.equal(bodies.every((body) => body.text?.format?.type === "json_schema"), true);
});

test("recovers image generation from a temporary provider outage", async () => {
  let calls = 0;
  const bytes = Buffer.from("png bytes");
  const imageRoute = { ...route, endpoint: "https://provider.example/v1/images/generations", operations: ["image_generation"] };
  const result = await openAiCompatibleVisualizationAdapter.generateImage({
    payload: { height: 1024, prompt: "A typed scientific diagram", width: 1024 },
    request: async () => {
      calls += 1;
      return calls === 1
        ? new Response("unavailable", { headers: { "retry-after": "0" }, status: 503 })
        : new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }), { status: 200 });
    },
    route: imageRoute
  });

  assert.deepEqual(result, { bytes, mimeType: "image/png" });
  assert.equal(calls, 2);
});

test("normalizes explicit price metadata but never fabricates price from token usage", async () => {
  const priced = await openAiCompatibleVisualizationAdapter.generateStructured({
    payload,
    request: async () => new Response(JSON.stringify({
      cost: { amount: 0.012, currency: "USD" },
      id: "response-1",
      output: [{ content: [{ text: "{\"nodes\":[]}" }] }],
      usage: { total_tokens: 42 }
    }), { status: 200 }),
    route
  });
  assert.deepEqual(priced.cost, {
    amount: 0.012,
    currency: "USD",
    providerRequestId: "response-1",
    units: 42
  });

  const unpriced = await openAiCompatibleVisualizationAdapter.generateStructured({
    payload,
    request: async () => new Response(JSON.stringify({
      id: "response-2",
      output_text: "{\"nodes\":[]}",
      usage: { total_tokens: 24 }
    }), { status: 200 }),
    route
  });
  assert.equal("cost" in unpriced, false);
});

test("requests a bounded PNG from an OpenAI-compatible image endpoint", async () => {
  const calls = [];
  const bytes = Buffer.from("png bytes");
  const imageRoute = { ...route, endpoint: "https://provider.example/v1/images/generations", operations: ["image_generation"] };
  const result = await openAiCompatibleVisualizationAdapter.generateImage({
    payload: { height: 1024, prompt: "A typed scientific diagram", width: 1024 },
    request: async (url, init) => {
      calls.push({ init, url });
      return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }), { status: 200 });
    },
    route: imageRoute
  });

  assert.deepEqual(result, { bytes, mimeType: "image/png" });
  assert.equal(calls[0].url, imageRoute.endpoint);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: imageRoute.model,
    output_format: "png",
    prompt: "A typed scientific diagram",
    quality: "medium",
    size: "1024x1024"
  });
  assert.equal(calls[0].init.responseMaxBytes, 16 * 1024 * 1024);
});

test("rejects non-success, invalid JSON, and missing structured output", async (t) => {
  const cases = [
    ["non-success", new Response("unavailable", { status: 503 }), /visualization_provider_unavailable/],
    ["invalid json", new Response("not-json", { status: 200 }), /visualization_provider_response_invalid/],
    ["missing output", new Response(JSON.stringify({ id: "response-3" }), { status: 200 }), /visualization_provider_response_invalid/]
  ];
  for (const [name, response, pattern] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        () => openAiCompatibleVisualizationAdapter.generateStructured({ payload, request: async () => response, route }),
        pattern
      );
    });
  }
});

test("probes without paper content and declares only implemented operations", async () => {
  let requestBody;
  const result = await openAiCompatibleVisualizationAdapter.probe({
    request: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ output_text: "{}" }), { status: 200 });
    },
    route
  });
  assert.deepEqual(result, {
    authenticated: true,
    capabilities: ["structured_generation", "validation"],
    reachable: true
  });
  assert.equal(JSON.stringify(requestBody).includes("paper"), false);
});
