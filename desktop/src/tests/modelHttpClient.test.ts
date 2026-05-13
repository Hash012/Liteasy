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
  ).rejects.toThrow(/模型服务请求失败.*503/);
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
