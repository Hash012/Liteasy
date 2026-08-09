import { expect, test, vi } from "vitest";
import { loadAccountCapabilities } from "../app/features/account/accountCapabilitiesClient";

const unavailableMultimodalCapability = {
  allowed: false,
  enabled: false,
  serviceAvailable: false,
  quota: { available: false },
  availableModalities: []
};

test("loads capabilities with the authenticated desktop bearer session", async () => {
  const transport = vi.fn(async () => ({
    json: async () => ({
      developerDiagnostics: true,
      multimodalVisualization: {
        allowed: true,
        enabled: true,
        serviceAvailable: true,
        quota: { available: true },
        availableModalities: ["semantic_graph"]
      }
    }),
    ok: true,
    status: 200
  }));

  await expect(loadAccountCapabilities({
    endpoint: "https://api.liteasy.example/",
    sessionId: "desktop-access-token",
    transport
  })).resolves.toEqual({
    developerDiagnostics: true,
    multimodalVisualization: {
      allowed: true,
      enabled: true,
      serviceAvailable: true,
      quota: { available: true },
      availableModalities: ["semantic_graph"]
    }
  });
  expect(transport).toHaveBeenCalledWith({
    headers: {
      Accept: "application/json",
      Authorization: "Bearer desktop-access-token"
    },
    method: "GET",
    url: "https://api.liteasy.example/v1/account/capabilities"
  });
});

test("treats an old capability response as generation unavailable", async () => {
  await expect(loadAccountCapabilities({
    endpoint: "https://api.liteasy.example",
    sessionId: "desktop-access-token",
    transport: async () => ({
      json: async () => ({ developerDiagnostics: false }),
      ok: true,
      status: 200
    })
  })).resolves.toEqual({
    developerDiagnostics: false,
    multimodalVisualization: unavailableMultimodalCapability
  });
});

test("fails closed for invalid nested multimodal fields while retaining diagnostics", async () => {
  await expect(loadAccountCapabilities({
    endpoint: "https://api.liteasy.example",
    sessionId: "desktop-access-token",
    transport: async () => ({
      json: async () => ({
        developerDiagnostics: true,
        multimodalVisualization: {
          allowed: true,
          enabled: true,
          serviceAvailable: true,
          quota: { available: true, units: 4 },
          availableModalities: ["semantic_graph"]
        }
      }),
      ok: true,
      status: 200
    })
  })).resolves.toEqual({
    developerDiagnostics: true,
    multimodalVisualization: unavailableMultimodalCapability
  });
});

test("fails closed for contradictory multimodal capability combinations", async () => {
  await expect(loadAccountCapabilities({
    endpoint: "https://api.liteasy.example",
    sessionId: "desktop-access-token",
    transport: async () => ({
      json: async () => ({
        developerDiagnostics: true,
        multimodalVisualization: {
          allowed: false,
          enabled: true,
          serviceAvailable: true,
          quota: { available: true },
          availableModalities: ["semantic_graph"]
        }
      }),
      ok: true,
      status: 200
    })
  })).resolves.toMatchObject({
    developerDiagnostics: true,
    multimodalVisualization: unavailableMultimodalCapability
  });
});

test("rejects missing or non-boolean server authorization results", async () => {
  await expect(loadAccountCapabilities({
    endpoint: "https://api.liteasy.example",
    sessionId: "desktop-access-token",
    transport: async () => ({
      json: async () => ({ developerDiagnostics: "yes" }),
      ok: true,
      status: 200
    })
  })).rejects.toThrow("account_capabilities_invalid");
});
