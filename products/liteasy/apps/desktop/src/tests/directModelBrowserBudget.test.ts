import { afterEach, expect, test, vi } from "vitest";
import { createDirectModelClient } from "../app/features/models/directModelClient";
import { directModelTransport } from "../app/features/models/directModelTransport";
import { getModelProvider } from "../app/features/models/modelProviders";
import { MODEL_RESPONSE_LIMITS } from "../app/features/models/modelResponseBudget";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), Channel: class {} }));
afterEach(() => vi.unstubAllGlobals());
const config = getModelProvider("ollama");

test("cancels the browser reader immediately when a direct SSE frame exceeds budget", async () => {
  const cancel = vi.fn();
  const bytes = new TextEncoder().encode("data: " + "x".repeat(MODEL_RESPONSE_LIMITS.sseFrameBytes));
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); }, cancel });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
  await expect(createDirectModelClient(config)({ model: config.model, provider: config.provider, prompt: "测试", onDelta: vi.fn() })).rejects.toThrow("接收预算");
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

test("cancels a stalled browser reader when generation is interrupted", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
  const controller = new AbortController();
  const promise = directModelTransport({ config, body: { stream: true }, signal: controller.signal, onChunk: vi.fn() });
  const rejection = expect(promise).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(body.locked).toBe(true));
  controller.abort();
  await rejection;
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

test("bounds a non-streaming direct HTTP body before JSON parsing", async () => {
  const cancel = vi.fn();
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(chunk); }, cancel });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
  await expect(directModelTransport({ config, body: { stream: false } })).rejects.toThrow("响应数据超出本次接收预算");
  expect(cancel).toHaveBeenCalledOnce();
});
