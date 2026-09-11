import { afterEach, expect, test, vi } from "vitest";
import { buildDirectModelBody, createDirectModelClient, createDirectModelStream } from "../app/features/models/directModelClient";
import { createModelGatewayFromSettings } from "../app/features/models/modelRuntime";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { getActiveModelProvider, getModelForSettings } from "../app/features/models/modelPolicy";
import { getModelProvider, modelProviders, validateDirectModelConfig } from "../app/features/models/modelProviders";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const openai = getModelProvider("openai");
const format = { name: "answer", schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }, strict: true };
const input = { provider: "openai", model: "gpt-5-mini", prompt: "Test", outputFormat: format };

test("uses the configured personal model without calling the account transport or trusting a cloud endpoint", async () => {
  const store = createSettingsStore();
  for (const [target, value] of Object.entries({
    "models.connection_mode": "direct", "models.direct_provider": "deepseek", "models.direct_model": "my-enabled-model",
    "models.direct_endpoint": "https://api.deepseek.com", "models.direct_output_format": "json_object"
  })) store.apply({ intent: "update_setting", target: target as keyof ReturnType<typeof store.getState>, value });
  const cloudTransport = vi.fn(() => { throw new Error("Account login must not be used"); });
  const directTransport = vi.fn(async (_request: import("../app/features/models/directModelTransport").DirectModelRequest) => JSON.stringify({ choices: [{ message: { content: "模型回答" } }] }));
  const settings = store.getState();
  const gateway = createModelGatewayFromSettings(settings, { cloudTransport, directTransport });
  const result = await gateway.generateAnswer({ provider: getActiveModelProvider(settings), model: getModelForSettings(settings), prompt: "问题" });
  expect(result.answer).toBe("模型回答");
  expect(result.trace).toMatchObject({ source: "direct_api", provider: "deepseek", mode: "live" });
  expect(cloudTransport).not.toHaveBeenCalled();
  expect(directTransport.mock.calls[0][0]).toMatchObject({ config: { model: "my-enabled-model" }, body: { model: "my-enabled-model" } });
});

test("persists non-secret configuration across application restarts", () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "models.connection_mode", value: "direct" });
  store.apply({ intent: "update_setting", target: "models.direct_model", value: "custom-model" });
  expect(createSettingsStore().getState()).toMatchObject({ "models.connection_mode": "direct", "models.direct_model": "custom-model" });
  expect(localStorage.getItem("liteasy.model-connection.v1")).not.toMatch(/apiKey|api_key|password/);
});

test("builds strict OpenAI, JSON mode and prompt-only requests without silently changing protocols", () => {
  expect(buildDirectModelBody(openai, input)).toMatchObject({ response_format: { type: "json_schema", json_schema: format } });
  expect(buildDirectModelBody({ ...openai, outputFormat: "json_object" }, input)).toMatchObject({ response_format: { type: "json_object" } });
  const body = buildDirectModelBody({ ...openai, outputFormat: "prompt" }, input);
  expect(body).not.toHaveProperty("response_format");
  expect(JSON.stringify(body)).toContain("Return only JSON matching this schema");
  const claude = buildDirectModelBody(getModelProvider("anthropic"), input);
  expect(claude).toHaveProperty("max_tokens", 8192);
  expect(claude).not.toHaveProperty("response_format");
});

test.each(modelProviders.filter((preset) => preset.endpoint && preset.model))("validates the $label preset", (preset) => {
  expect(validateDirectModelConfig(preset).endpoint).toBe(preset.endpoint);
});

test.each(["http://api.example.test/v1", "https://user:secret@api.example.test/v1", "https://api.example.test/v1?api_key=secret"])("rejects unsafe credential destinations: %s", (endpoint) => {
  expect(() => validateDirectModelConfig({ ...openai, endpoint })).toThrow();
});

test("decodes split UTF-8 characters and CRLF-delimited OpenAI SSE with usage-only events", () => {
  const onDelta = vi.fn();
  const stream = createDirectModelStream("openai", onDelta);
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[],"usage":{}}\r\n\r\ndata: [DONE]\r\n\r\n');
  for (const byte of bytes) stream.push(new Uint8Array([byte]));
  expect(stream.finish()).toBe("你好");
  expect(onDelta).toHaveBeenCalledWith("你好", "你好");
});

test("streams Anthropic text while excluding thinking blocks", () => {
  const stream = createDirectModelStream("anthropic", vi.fn());
  const events = [
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "Claude answer" } },
    { type: "message_stop" }
  ];
  stream.push(new TextEncoder().encode(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")));
  expect(stream.finish()).toBe("Claude answer");
});

test.each([
  'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
  'data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
  'data: {"error":{"message":"upstream error"}}\n\n',
  'data: not-json\n\n'
])("rejects incomplete, truncated or failed generation instead of returning success", (events) => {
  const stream = createDirectModelStream("openai", vi.fn());
  stream.push(new TextEncoder().encode(events));
  expect(() => stream.finish()).toThrow();
});

test("passes cancellation through and never sends an already cancelled request", async () => {
  const controller = new AbortController();
  const transport = vi.fn(async () => "");
  controller.abort();
  await expect(createDirectModelClient(openai, transport)({ ...input, signal: controller.signal })).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

test("reads a non-streaming Anthropic response", async () => {
  const result = await createDirectModelClient(getModelProvider("anthropic"), async () => JSON.stringify({
    content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "实际回答" }], stop_reason: "end_turn"
  }))(input);
  expect(result.answer).toBe("实际回答");
});
