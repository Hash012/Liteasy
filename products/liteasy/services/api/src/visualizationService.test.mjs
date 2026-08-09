import assert from "node:assert/strict";
import test from "node:test";
import { VisualizationService } from "./visualizationService.mjs";

function serviceHarness(overrides = {}) {
  const calls = [];
  const repository = {
    async capability() {
      return {
        allowed: true,
        availableModalities: ["semantic_graph"],
        enabled: true,
        explicitRequestsAllowed: true,
        preference: { enabled: true },
        providerRoute: { routeId: "must-not-leak" },
        quota: {
          available: true,
          dailyUnits: 40,
          remainingBand: "available",
          usedUnits: 4
        },
        serviceAvailable: true
      };
    },
    async getEntitlement() {
      return {
        allowed: true,
        allowedModalities: ["semantic_graph"],
        explicitRequestsAllowed: true,
        revision: 3
      };
    },
    async getProviderRoute(routeId) {
      return { enabled: true, revision: 7, routeId };
    },
    async reserve(subjectId, input) {
      calls.push(["reserve", subjectId, input]);
      return { reservation: { reservationId: "reservation_1", reservedUnits: 4, state: "reserved" } };
    },
    async rollback(subjectId, input) {
      calls.push(["rollback", subjectId, input]);
      return { reservation: { reservationId: input.reservationId, state: "rolled_back" } };
    },
    async setPreference(subjectId, input) {
      calls.push(["setPreference", subjectId, input]);
      return { preference: { enabled: input.enabled, revision: 2 } };
    },
    async settle(subjectId, input) {
      calls.push(["settle", subjectId, input]);
      return { reservation: { reservationId: input.reservationId, state: "settled" } };
    },
    ...overrides.repository
  };
  const gateway = {
    async generateStructured(input) {
      calls.push(["generateStructured", input]);
      return { text: "{\"artifact\":true}" };
    },
    ...overrides.gateway
  };
  const authorizeDocument = overrides.authorizeDocument ?? (async (input) => {
    calls.push(["authorizeDocument", input]);
    return { allowed: true, sourceIdentityHash: "source_1" };
  });
  return {
    calls,
    service: new VisualizationService({ authorizeDocument, gateway, repository })
  };
}

test("account capability exposes only the fail-closed desktop projection", async () => {
  const instance = serviceHarness();
  assert.deepEqual(await instance.service.accountCapability("user_1"), {
    allowed: true,
    availableModalities: ["semantic_graph"],
    enabled: true,
    quota: { available: true, remainingBand: "available" },
    serviceAvailable: true
  });

  const unavailable = serviceHarness({ repository: {
    async capability() { throw new Error("private database detail"); }
  } });
  assert.deepEqual(await unavailable.service.accountCapability("user_1"), {
    allowed: false,
    availableModalities: [],
    enabled: false,
    quota: { available: false },
    serviceAvailable: false
  });
});

test("an unauthorized account cannot persist an enabled preference", async () => {
  const instance = serviceHarness({ repository: {
    async capability() { return { allowed: false }; },
    async getEntitlement() {
      return { allowed: false, allowedModalities: [], explicitRequestsAllowed: false, revision: 2 };
    }
  } });
  const result = await instance.service.setPreference("user_1", {
    enabled: true,
    idempotencyKey: "preference-0001",
    traceId: "trace_1"
  });
  assert.equal(result.enabled, false);
  assert.equal(instance.calls.some(([name]) => name === "setPreference"), false);
});

test("provider failure refunds the reservation with a stable reason", async () => {
  const instance = serviceHarness({ gateway: {
    async generateStructured() {
      throw Object.assign(new Error("upstream internals"), { code: "visualization_provider_timeout" });
    }
  } });
  await assert.rejects(() => instance.service.generate("user_1", {
    providerRequest: { dataClass: "paper", modality: "semantic_graph", routes: [] },
    reservation: {
      idempotencyKey: "generation-0001",
      modality: "semantic_graph",
      routeId: "route_1",
      traceId: "trace_2",
      units: 4
    }
  }, { traceId: "trace_2" }), (error) => (
    error.code === "visualization_provider_timeout" &&
    error.message === "visualization_provider_timeout"
  ));
  assert.deepEqual(instance.calls.map(([name]) => name), ["reserve", "rollback"]);
  assert.deepEqual(instance.calls[1].slice(1), ["user_1", {
    reasonCode: "provider_timeout",
    reservationId: "reservation_1",
    traceId: "trace_2"
  }]);
});

test("late provider completion after cancellation is discarded and refunded", async () => {
  const controller = new AbortController();
  const instance = serviceHarness({ gateway: {
    async generateStructured() {
      controller.abort();
      return { text: "late result" };
    }
  } });
  await assert.rejects(() => instance.service.generate("user_1", {
    providerRequest: { dataClass: "paper", modality: "semantic_graph", routes: [] },
    reservation: {
      idempotencyKey: "generation-0002",
      modality: "semantic_graph",
      routeId: "route_1",
      traceId: "trace_3",
      units: 4
    }
  }, { signal: controller.signal, traceId: "trace_3" }), /visualization_request_aborted/);
  assert.equal(instance.calls.at(-1)[0], "rollback");
  assert.equal(instance.calls.at(-1)[2].reasonCode, "cancelled");
});

test("submission rechecks all publication gates before settling", async () => {
  const instance = serviceHarness();
  const artifact = { artifactId: "artifact_1", modality: "semantic_graph" };
  await instance.service.submit("user_1", {
    artifact,
    document: { documentId: "document_1", sourceIdentityHash: "source_1" },
    modality: "semantic_graph",
    reservationId: "reservation_1",
    routeId: "route_1",
    routeRevision: 7,
    settledUnits: 2
  }, { traceId: "trace_4" });
  assert.deepEqual(instance.calls.map(([name]) => name), ["authorizeDocument", "settle"]);
  assert.deepEqual(instance.calls[1][2], {
    artifact,
    document: { documentId: "document_1", sourceIdentityHash: "source_1" },
    reasonCode: "completed",
    reservationId: "reservation_1",
    routeId: "route_1",
    routeRevision: 7,
    settledUnits: 2,
    traceId: "trace_4"
  });
});

test("entitlement revocation immediately before submission refunds and blocks publication", async () => {
  const instance = serviceHarness({ repository: {
    async getEntitlement() {
      return { allowed: false, allowedModalities: [], explicitRequestsAllowed: false, revision: 4 };
    }
  } });
  await assert.rejects(() => instance.service.submit("user_1", {
    artifact: { artifactId: "artifact_1", modality: "semantic_graph" },
    document: { documentId: "document_1", sourceIdentityHash: "source_1" },
    modality: "semantic_graph",
    reservationId: "reservation_1",
    routeId: "route_1",
    routeRevision: 7,
    settledUnits: 2
  }, { traceId: "trace_5" }), /visualization_entitlement_revoked/);
  assert.deepEqual(instance.calls.map(([name]) => name), ["rollback"]);
  assert.equal(instance.calls[0][2].reasonCode, "entitlement_revoked");
});

test("administrator mutations reject short idempotency keys before persistence", async () => {
  const instance = serviceHarness({ repository: {
    async setEntitlement() {
      throw new Error("persistence_must_not_be_reached");
    }
  } });
  await assert.rejects(() => instance.service.setEntitlement({
    roles: ["platform_admin"],
    subjectId: "admin_1"
  }, {
    allowed: true,
    allowedModalities: ["semantic_graph"],
    expectedRevision: 0,
    explicitRequestsAllowed: true,
    idempotencyKey: "short",
    reason: "Approved for this account",
    subjectId: "user_1",
    traceId: "trace_6"
  }), /idempotency_key_invalid/);
});

test("provider route saves use gateway normalization before repository persistence", async () => {
  const calls = [];
  const route = { routeId: "route-1" };
  const instance = serviceHarness({
    gateway: {
      validateRoute(input) {
        calls.push(["validate", input]);
        return { ...input, endpoint: "https://visual.example/v1" };
      }
    },
    repository: {
      async saveProviderRoute(input) {
        calls.push(["save", input]);
        return { route: input.route };
      }
    }
  });
  await instance.service.saveProviderRoute({ roles: ["platform_admin"], subjectId: "admin_1" }, {
    expectedRevision: 0,
    idempotencyKey: "provider-save-0001",
    reason: "Approved provider route",
    route,
    traceId: "trace-provider-1"
  });
  assert.deepEqual(calls.map(([name]) => name), ["validate", "save"]);
  assert.equal(calls[1][1].route.endpoint, "https://visual.example/v1");
  assert.equal(calls[1][1].updatedBy, "admin_1");
});
