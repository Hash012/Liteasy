import { createControlPlaneClient } from "../app/features/models/controlPlaneClient";

test("requests model policy snapshot with the desktop session", async () => {
  const requests: Array<{ headers: Record<string, string>; method: string; url: string }> = [];
  const client = createControlPlaneClient({
    endpoint: "https://liteasy.example.com/control-plane",
    sessionId: "desktop-session",
    transport: async (request) => {
      requests.push(request);

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
      headers: {
        Accept: "application/json",
        Authorization: "Bearer desktop-session"
      },
      method: "GET",
      url: "https://liteasy.example.com/control-plane/v1/model-policy"
    }
  ]);
});

test("preserves the stable cloud error when control plane sync fails", async () => {
  const client = createControlPlaneClient({
    endpoint: "https://liteasy.example.com/control-plane",
    sessionId: "desktop-session",
    transport: async () => ({
      json: async () => ({
        code: "model_policy_forbidden",
        message: "当前账号不能读取模型策略。",
        traceId: "trace_policy_1"
      }),
      ok: false,
      status: 403
    })
  });

  await expect(client()).rejects.toMatchObject({
    code: "model_policy_forbidden",
    message: "当前账号不能读取模型策略。",
    status: 403,
    traceId: "trace_policy_1"
  });
});
