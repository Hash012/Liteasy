import { createHttpModelClient } from "../app/features/models/modelHttpClient";

test("posts a typed model request to the backend endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createHttpModelClient({
    endpoint: "https://liteasy.example.com/model-proxy",
    source: "cloud_proxy",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          answer: "server answer",
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  const result = await client({
    model: "gpt-5-mini",
    prompt: "Explain BERT",
    provider: "openai"
  });

  expect(result).toEqual({
    answer: "server answer",
    trace: {
      backend: "dev_cloud",
      endpoint: "https://liteasy.example.com/model-proxy",
      mode: "live",
      provider: "openai",
      source: "cloud_proxy"
    }
  });
  expect(requests).toEqual([
    {
      body: JSON.stringify({
        model: "gpt-5-mini",
        prompt: "Explain BERT",
        provider: "openai",
        source: "cloud_proxy"
      }),
      url: "https://liteasy.example.com/model-proxy/v1/model/generate"
    }
  ]);
});

test("throws a readable error when the backend returns a non-ok status", async () => {
  const client = createHttpModelClient({
    endpoint: "https://liteasy.example.com/model-proxy",
    source: "cloud_proxy",
    transport: async () => ({
      json: async () => ({
        error: "quota exceeded"
      }),
      ok: false,
      status: 503
    })
  });

  await expect(
    client({
      model: "gpt-5-mini",
      prompt: "Explain BERT",
      provider: "openai"
    })
  ).rejects.toThrow("模型服务请求失败（cloud_proxy 503）：quota exceeded");
});

test("throws a readable error when the backend response shape is invalid", async () => {
  const client = createHttpModelClient({
    endpoint: "https://liteasy.example.com/model-proxy",
    source: "cloud_proxy",
    transport: async () => ({
      json: async () => ({
        message: "missing answer field"
      }),
      ok: true,
      status: 200
    })
  });

  await expect(
    client({
      model: "gpt-5-mini",
      prompt: "Explain BERT",
      provider: "openai"
    })
  ).rejects.toThrow(/模型服务返回格式无效/);
});

test("passes abort signals through to the model transport", async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const client = createHttpModelClient({
    endpoint: "https://liteasy.example.com/model-proxy",
    source: "cloud_proxy",
    transport: async (request) => {
      observedSignal = request.signal;
      return {
        json: async () => ({
          answer: "abort-aware answer",
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  await client({
    model: "gpt-5-mini",
    prompt: "Explain cancellation",
    provider: "openai",
    signal: controller.signal
  });

  expect(observedSignal).toBe(controller.signal);
});

test("consumes NDJSON model deltas and reports accumulated output", async () => {
  const encoder = new TextEncoder();
  const onDelta = vi.fn();
  let requestedUrl = "";
  const client = createHttpModelClient({
    endpoint: "https://liteasy.example.com/model-proxy",
    source: "cloud_proxy",
    transport: async (request) => {
      requestedUrl = request.url;
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('{"delta":"Hello ","type":"delta"}\n'));
            controller.enqueue(encoder.encode('{"delta":"stream","type":"delta"}\n'));
            controller.enqueue(encoder.encode(
              '{"answer":"Hello stream","execution":{"backend":"dev_cloud","mode":"live","provider":"openai"},"type":"completed"}\n'
            ));
            controller.close();
          }
        }),
        json: async () => ({}),
        ok: true,
        status: 200
      };
    }
  });

  const result = await client({
    model: "gpt-5.5",
    onDelta,
    prompt: "stream",
    provider: "openai"
  });

  expect(requestedUrl).toBe("https://liteasy.example.com/model-proxy/v1/model/generate-stream");
  expect(onDelta).toHaveBeenNthCalledWith(1, "Hello ", "Hello ");
  expect(onDelta).toHaveBeenNthCalledWith(2, "stream", "Hello stream");
  expect(result.answer).toBe("Hello stream");
  expect(result.trace.mode).toBe("live");
});
