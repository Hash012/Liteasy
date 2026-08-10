import assert from "node:assert/strict";
import test from "node:test";
import { openAiCompatibleVisualizationAdapter } from "./visualizationStructuredProviderAdapter.mjs";

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
