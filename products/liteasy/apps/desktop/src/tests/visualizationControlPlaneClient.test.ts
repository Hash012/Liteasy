import { expect, test, vi } from "vitest";
import { setMultimodalVisualizationPreference } from "../app/features/visualization/visualizationControlPlaneClient";

test("sets the authenticated multimodal preference with an idempotency key", async () => {
  const transport = vi.fn(async () => ({
    json: async () => ({
      allowed: true, enabled: true, serviceAvailable: true, explicitRequestsAllowed: false,
      quota: { available: true }, availableModalities: ["semantic_graph"]
    }),
    ok: true,
    status: 200
  }));

  await expect(setMultimodalVisualizationPreference({
    enabled: true,
    endpoint: "https://api.liteasy.example/",
    sessionId: "desktop-access-token",
    transport
  })).resolves.toMatchObject({ enabled: true });

  expect(transport).toHaveBeenCalledWith(expect.objectContaining({
    headers: {
      Accept: "application/json",
      Authorization: "Bearer desktop-access-token",
      "Content-Type": "application/json"
    },
    method: "POST",
    url: "https://api.liteasy.example/v1/account/preferences/multimodal-visualization/set"
  }));
  const body = JSON.parse(transport.mock.calls[0][0].body);
  expect(body.enabled).toBe(true);
  expect(body.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
});

test("surfaces preference mutation failures", async () => {
  await expect(setMultimodalVisualizationPreference({
    enabled: false,
    endpoint: "https://api.liteasy.example",
    sessionId: "desktop-access-token",
    transport: async () => ({
      json: async () => ({}),
      ok: false,
      status: 403
    })
  })).rejects.toThrow("multimodal_visualization_preference_unavailable:403");
});

test("returns the typed capability projection after a preference mutation", async () => {
  await expect(setMultimodalVisualizationPreference({
    enabled: true,
    endpoint: "https://api.liteasy.example",
    sessionId: "desktop-access-token",
    transport: async () => ({
      json: async () => ({
        allowed: true,
        enabled: true,
        serviceAvailable: true,
        explicitRequestsAllowed: false,
        quota: { available: true },
        availableModalities: ["semantic_graph"]
      }),
      ok: true,
      status: 200
    })
  })).resolves.toMatchObject({ enabled: true });
});
