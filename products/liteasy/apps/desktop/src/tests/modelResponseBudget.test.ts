import { describe, expect, test, vi } from "vitest";
import { createHttpModelClient } from "../app/features/models/modelHttpClient";
import { createDirectModelStream } from "../app/features/models/directModelClient";
import { MODEL_RESPONSE_LIMITS } from "../app/features/models/modelResponseBudget";

const encoder = new TextEncoder();
const input = { model: "test-model", provider: "openai", prompt: "测试", onDelta: vi.fn() };
function cloud(body: ReadableStream<Uint8Array>) {
  return createHttpModelClient({ endpoint: "https://example.org/models", source: "cloud_proxy", transport: async () => ({ body, ok: true, status: 200, json: async () => ({}) }) });
}
function repeatedBody(value: string, repetitions: number, end = '{"type":"completed","answer":"must not succeed"}\n') {
  let pulls = 0;
  const cancelled = vi.fn();
  const bytes = encoder.encode(value);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ < repetitions) controller.enqueue(bytes);
      else { controller.enqueue(encoder.encode(end)); controller.close(); }
    },
    cancel: cancelled
  });
  return { body, cancelled, pulls: () => pulls };
}

describe("bounded model response streams", () => {
  test("stops growing cloud answers at 2 MiB and cancels before reading the remaining stream", async () => {
    const stream = repeatedBody(JSON.stringify({ type: "delta", delta: "x".repeat(65_536) }) + "\n", 64);
    const onDelta = vi.fn();
    await expect(cloud(stream.body)({ ...input, onDelta })).rejects.toThrow("正文超出本次接收预算");
    expect(stream.cancelled).toHaveBeenCalledOnce();
    expect(stream.pulls()).toBeLessThan(40);
    expect(onDelta).toHaveBeenCalledTimes(32);
    expect(stream.body.locked).toBe(false);
  });

  test("bounds accumulated cloud reasoning by UTF-8 bytes before reporting an oversized delta", async () => {
    const stream = repeatedBody(JSON.stringify({ type: "reasoning_delta", delta: "界".repeat(25_000) }) + "\n", 8);
    const onReasoningDelta = vi.fn();
    await expect(cloud(stream.body)({ ...input, onReasoningDelta })).rejects.toThrow("推理内容超出本次接收预算");
    expect(onReasoningDelta).toHaveBeenCalledTimes(3);
    expect(stream.cancelled).toHaveBeenCalledOnce();
  });

  test("bounds both completed answer replacement and unterminated cloud frames", async () => {
    const final = repeatedBody(JSON.stringify({ type: "completed", answer: "x".repeat(MODEL_RESPONSE_LIMITS.answerBytes + 1) }) + "\n", 1);
    await expect(cloud(final.body)(input)).rejects.toThrow("正文超出本次接收预算");
    expect(final.cancelled).toHaveBeenCalledOnce();
    const residual = repeatedBody("x".repeat(65_536), 80);
    await expect(cloud(residual.body)(input)).rejects.toThrow("未完成响应帧超出本次接收预算");
    expect(residual.cancelled).toHaveBeenCalledOnce();
  });

  test("accepts a 600k-character CJK artifact completion and a final NDJSON frame without a newline", async () => {
    const answer = "文".repeat(600_000);
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: "completed", answer })));
      controller.close();
    } });
    expect((await cloud(body)(input)).answer).toBe(answer);
  });

  test("stops unlimited metadata events and oversized chunks even when no answer text is emitted", async () => {
    const events = repeatedBody("{}\n".repeat(1000), 60);
    await expect(cloud(events.body)(input)).rejects.toThrow("响应事件数量超出本次接收预算");
    expect(events.cancelled).toHaveBeenCalledOnce();
    const oversized = repeatedBody("x".repeat(MODEL_RESPONSE_LIMITS.wireBytes + 1), 1);
    await expect(cloud(oversized.body)(input)).rejects.toThrow("响应数据超出本次接收预算");
    expect(oversized.cancelled).toHaveBeenCalledOnce();
  });

  test("aborts a stalled cloud read and releases its reader", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const controller = new AbortController();
    const result = cloud(body)({ ...input, signal: controller.signal });
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await rejection;
    expect(cancelled).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  test("cancels a response returned after its request was already interrupted", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const client = createHttpModelClient({ endpoint: "https://example.org/models", source: "cloud_proxy", transport: async () => {
      controller.abort();
      return { body, ok: true, status: 200, json: async () => ({}) };
    } });
    await expect(client({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  test.each(["openai", "anthropic"] as const)("stops %s SSE answers and reasoning without accepting later completion", (protocol) => {
    const answer = createDirectModelStream(protocol, vi.fn());
    const event = protocol === "openai" ? { choices: [{ delta: { content: "x".repeat(65_536) } }] }
      : { type: "content_block_delta", delta: { type: "text_delta", text: "x".repeat(65_536) } };
    const frame = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    for (let index = 0; index < 32; index++) answer.push(frame);
    expect(() => answer.push(frame)).toThrow("正文超出本次接收预算");
    expect(() => answer.finish()).toThrow("正文超出本次接收预算");
    const reasoning = createDirectModelStream(protocol, vi.fn());
    const reasoningEvent = protocol === "openai" ? { choices: [{ delta: { reasoning_content: "界".repeat(90_000) } }] }
      : { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "界".repeat(90_000) } };
    expect(() => reasoning.push(encoder.encode(`data: ${JSON.stringify(reasoningEvent)}\n\n`))).toThrow("推理内容超出本次接收预算");
    expect(() => reasoning.finish()).toThrow("推理内容超出本次接收预算");
  });

  test("bounds unterminated SSE and ignores no oversized final result", () => {
    const stream = createDirectModelStream("openai", vi.fn());
    const block = encoder.encode("data: " + "x".repeat(MODEL_RESPONSE_LIMITS.sseFrameBytes));
    expect(() => stream.push(block)).toThrow("未完成响应帧超出本次接收预算");
    expect(() => stream.finish()).toThrow("未完成响应帧超出本次接收预算");
  });
});
