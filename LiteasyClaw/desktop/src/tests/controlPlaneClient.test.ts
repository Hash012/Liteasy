import { createControlPlaneClient } from "../app/features/models/controlPlaneClient";

test("requests model policy snapshot from the control plane endpoint", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const client = createControlPlaneClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ method: request.method, url: request.url });

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          policyVersion: "policy-2026-05-14",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    }
  });

  const result = await client();

  expect(result).toEqual({
    policyVersion: "policy-2026-05-14",
    snapshot: {
      "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy",
      "models.default_provider": "openai"
    },
    syncedAt: "2026-05-14T09:30:00Z"
  });
  expect(requests).toEqual([
    {
      method: "GET",
      url: "https://liteasy.example.com/control-plane/v1/admin/model-policy"
    }
  ]);
});

test("throws a readable error when control plane sync fails", async () => {
  const client = createControlPlaneClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async () => ({
      json: async () => ({
        error: "forbidden"
      }),
      ok: false,
      status: 403
    })
  });

  await expect(client()).rejects.toThrow(/云端策略同步失败.*403/);
});
