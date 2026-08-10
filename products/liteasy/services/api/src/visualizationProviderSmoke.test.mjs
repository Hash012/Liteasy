import assert from "node:assert/strict";
import test from "node:test";
import { EnvironmentVisualizationSecretStore } from "./visualizationSecretStore.mjs";
import { VisualizationProviderGateway } from "./visualizationProviderGateway.mjs";
import { productionVisualizationProviderAdapters } from "./visualizationStructuredProviderAdapter.mjs";

function parseHostnames(value, route) {
  if (value?.trim()) return [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
  return [new URL(route.endpoint).hostname.toLowerCase()];
}

function parseRoute(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("visualization_smoke_route_invalid");
  }
}

export async function runVisualizationProviderSmoke(env = process.env) {
  const rawRoute = env.LITEASY_VISUALIZATION_SMOKE_ROUTE?.trim();
  if (!rawRoute) {
    return Object.freeze({
      reason: "LITEASY_VISUALIZATION_SMOKE_ROUTE",
      status: "skipped_configuration"
    });
  }

  const route = parseRoute(rawRoute);
  const modality = env.LITEASY_VISUALIZATION_SMOKE_MODALITY?.trim() || route.modalities?.[0];
  const dataClass = env.LITEASY_VISUALIZATION_SMOKE_DATA_CLASS?.trim() || route.dataClasses?.[0];
  const gateway = new VisualizationProviderGateway({
    adapters: productionVisualizationProviderAdapters,
    egressPolicy: { allowedHostnames: parseHostnames(env.LITEASY_VISUALIZATION_EGRESS_HOSTNAMES, route) },
    secretStore: new EnvironmentVisualizationSecretStore(env)
  });
  const result = await gateway.testRoute({ dataClass, modality, route });
  return Object.freeze({
    capabilities: result.capabilities,
    providerId: route.providerId,
    routeId: route.routeId,
    status: "pass"
  });
}

test("visualization provider smoke runs only with explicit route configuration", async (t) => {
  const result = await runVisualizationProviderSmoke();
  t.diagnostic(JSON.stringify({
    status: result.status,
    test: "visualization_provider_smoke",
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.providerId ? { providerId: result.providerId, routeId: result.routeId } : {})
  }));

  if (result.status === "skipped_configuration") {
    assert.equal(result.reason, "LITEASY_VISUALIZATION_SMOKE_ROUTE");
    return;
  }

  assert.equal(result.status, "pass");
  assert.ok(result.capabilities.includes("validation"));
});
