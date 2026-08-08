import {
  createBearerModelTransport,
  createHttpModelClient
} from "../app/features/models/modelHttpClient";

test("adds the current Liteasy access token to model requests", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ answer: "ok" }), {
    headers: { "Content-Type": "application/json" },
    status: 200
  }));
  const transport = createBearerModelTransport({
    fetchImpl,
    getAccessToken: () => "desktop-access-token"
  });

  await transport({
    body: JSON.stringify({ prompt: "Explain BERT" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    url: "https://models.liteasy.example/v1/model/generate"
  });

  expect(fetchImpl).toHaveBeenCalledWith(
    "https://models.liteasy.example/v1/model/generate",
    expect.objectContaining({
      headers: {
        Authorization: "Bearer desktop-access-token",
        "Content-Type": "application/json"
      }
    })
  );
});

test("refuses an anonymous cloud model request before network access", async () => {
  const fetchImpl = vi.fn();
  const transport = createBearerModelTransport({
    fetchImpl,
    getAccessToken: () => null
  });

  await expect(transport({
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    url: "https://models.liteasy.example/v1/model/generate"
  })).rejects.toThrow("请先登录 Liteasy 账号");
  expect(fetchImpl).not.toHaveBeenCalled();
});

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

test("forwards an artifact's structured output contract to the backend", async () => {
  let requestBody = "";
  const client = createHttpModelClient({
    endpoint: "https://liteasy.example.com/model-proxy",
    source: "cloud_proxy",
    transport: async (request) => {
      requestBody = request.body;
      return {
        json: async () => ({ answer: "{}" }),
        ok: true,
        status: 200
      };
    }
  });

  await client({
    model: "gpt-5-mini",
    outputFormat: {
      name: "liteasy_thin_reading",
      schema: { type: "object" },
      strict: true
    },
    prompt: "Return JSON.",
    provider: "openai"
  });

  expect(JSON.parse(requestBody)).toMatchObject({
    outputFormat: {
      name: "liteasy_thin_reading",
      schema: { type: "object" },
      strict: true
    }
  });
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

test("shows the formal cloud stable message and trace id", async () => {
  const client = createHttpModelClient({
    endpoint: "https://liteasy.example.com/model-proxy",
    source: "cloud_proxy",
    transport: async () => ({
      json: async () => ({
        code: "model_provider_unavailable",
        message: "The model provider is temporarily unavailable.",
        traceId: "trace_model_1"
      }),
      ok: false,
      status: 503
    })
  });

  await expect(client({
    model: "gpt-5-mini",
    prompt: "Explain BERT",
    provider: "openai"
  })).rejects.toThrow("The model provider is temporarily unavailable.（trace_model_1）");
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

test("reports stable errors that occur after a model stream starts", async () => {
  const encoder = new TextEncoder();
  const client = createHttpModelClient({
    endpoint: "https://liteasy.example.com/model-proxy",
    source: "cloud_proxy",
    transport: async () => ({
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"delta":"partial","type":"delta"}\n'));
          controller.enqueue(encoder.encode(
            '{"code":"model_provider_timeout","message":"The model provider timed out.","traceId":"trace_stream_1","type":"error"}\n'
          ));
          controller.close();
        }
      }),
      json: async () => ({}),
      ok: true,
      status: 200
    })
  });

  await expect(client({
    model: "gpt-5-mini",
    onDelta: () => {},
    prompt: "stream",
    provider: "openai"
  })).rejects.toThrow("The model provider timed out.（trace_stream_1）");
});
