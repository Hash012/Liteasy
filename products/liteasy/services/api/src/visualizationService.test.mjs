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
      return {
        dataClasses: ["paper"],
        enabled: true,
        modalities: ["semantic_graph"],
        operations: ["structured_generation"],
        providerId: "provider-1",
        revision: 7,
        routeId
      };
    },
    async reserve(subjectId, input) {
      calls.push(["reserve", subjectId, input]);
      return { reservation: {
        modality: "semantic_graph",
        reservationId: "reservation_1",
        reservedUnits: 4,
        routeId: "route_1",
        routeRevision: 7,
        state: "reserved"
      } };
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
    async publish(subjectId, input) {
      calls.push(["publish", subjectId, input]);
      return {
        artifact: input.artifact,
        reservation: { reservationId: input.reservationId, state: "settled" }
      };
    },
    async recordProviderCost(input) {
      calls.push(["recordProviderCost", input]);
      return input;
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
    return {
      allowed: true,
      scopeId: "user_1",
      scopeType: "user",
      sourceIdentityHash: "source_1"
    };
  });
  const validateArtifact = overrides.validateArtifact ?? (async (input) => {
    calls.push(["validateArtifact", input]);
    return { outcome: "pass", validatorVersions: { schema: "1" } };
  });
  return {
    calls,
    service: new VisualizationService({ authorizeDocument, gateway, repository, validateArtifact })
  };
}

test("account capability exposes only the fail-closed desktop projection", async () => {
  const instance = serviceHarness();
  assert.deepEqual(await instance.service.accountCapability("user_1"), {
    allowed: true,
    availableModalities: ["semantic_graph"],
    enabled: true,
    explicitRequestsAllowed: true,
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
    explicitRequestsAllowed: false,
    quota: { available: false },
    serviceAvailable: false
  });

  const missingGovernance = serviceHarness({ repository: {
    async capability() {
      return {
        allowed: true,
        availableModalities: [],
        enabled: true,
        quota: { available: false },
        serviceAvailable: false
      };
    }
  } });
  assert.deepEqual(await missingGovernance.service.accountCapability("user_1"), {
    allowed: true,
    availableModalities: [],
    enabled: false,
    explicitRequestsAllowed: false,
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

test("missing provider cost policy is surfaced before provider work", async () => {
  const calls = [];
  const instance = serviceHarness({ repository: {
    async reserve() {
      calls.push("reserve");
      throw new Error("visualization_cost_policy_unconfigured");
    }
  }, gateway: {
    async generateStructured() { calls.push("provider"); throw new Error("provider_must_not_be_contacted"); }
  } });
  await assert.rejects(() => instance.service.generate("user_1", {
    providerRequest: { dataClass: "paper", operation: "structured_generation" },
    reservation: { idempotencyKey: "policy-missing-1", modality: "semantic_graph", routeId: "route-new" }
  }), (error) => error.code === "visualization_cost_policy_unconfigured" && error.status === 503);
  assert.deepEqual(calls, ["reserve"]);
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
  const artifact = {
    artifactId: "artifact_1",
    body: { artifactVersion: "liteasy.visualization/v1" },
    contentHash: null,
    evidenceHash: "a".repeat(64),
    modality: "semantic_graph",
    nodeId: "node_1",
    specHash: "b".repeat(64),
    state: "ready"
  };
  await instance.service.submit("user_1", {
    artifact,
    document: { documentId: "document_1", sourceIdentityHash: "source_1" },
    modality: "semantic_graph",
    reservationId: "reservation_1",
    routeId: "route_1",
    routeRevision: 7,
    settledUnits: 2
  }, { traceId: "trace_4" });
  assert.deepEqual(instance.calls.map(([name]) => name), ["validateArtifact", "authorizeDocument", "publish"]);
  assert.deepEqual(instance.calls[2][2], {
    access: {
      allowed: true,
      scopeId: "user_1",
      scopeType: "user",
      sourceIdentityHash: "source_1"
    },
    artifact,
    document: { documentId: "document_1", sourceIdentityHash: "source_1" },
    reservationId: "reservation_1",
    routeId: "route_1",
    routeRevision: 7,
    traceId: "trace_4",
    validation: { outcome: "pass", validatorVersions: { schema: "1" } }
  });
});

test("entitlement revocation immediately before submission refunds and blocks publication", async () => {
  const instance = serviceHarness({ repository: {
    async publish() {
      throw new Error("visualization_entitlement_revoked");
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
  }, { traceId: "trace_5" }), (error) => (
    error.code === "visualization_entitlement_revoked" && error.status === 403
  ));
  assert.deepEqual(instance.calls.map(([name]) => name), ["validateArtifact", "authorizeDocument", "rollback"]);
  assert.equal(instance.calls.at(-1)[2].reasonCode, "entitlement_revoked");
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

test("normalizes bounded visualization audit filters before querying the repository", async () => {
  const calls = [];
  const instance = serviceHarness({ repository: {
    async listAudit(input) {
      calls.push(input);
      return { rows: [] };
    }
  } });
  const principal = { roles: ["platform_admin"], subjectId: "admin_1" };
  await instance.service.listAudit(principal, {
    action: "visualization_entitlement_updated",
    from: "2026-08-01",
    limit: "50",
    subjectId: "user-1",
    to: "2026-08-09"
  });
  assert.deepEqual(calls, [{
    action: "visualization_entitlement_updated",
    from: "2026-08-01",
    limit: 50,
    subjectId: "user-1",
    to: "2026-08-09"
  }]);
  await assert.rejects(() => instance.service.listAudit(principal, {
    from: "2026-08-10",
    to: "2026-08-09"
  }), (error) => error.code === "visualization_audit_date_range_invalid");
  assert.equal(calls.length, 1);
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

test("generation ignores caller routes and enforces the reserved stored route revision", async () => {
  const instance = serviceHarness();
  await instance.service.generate("user_1", {
    providerRequest: {
      dataClass: "paper",
      modality: "semantic_graph",
      routes: [{ routeId: "attacker-route" }]
    },
    reservation: {
      idempotencyKey: "generation-0003",
      modality: "semantic_graph",
      routeId: "route_1",
      traceId: "trace_7",
      units: 4
    }
  }, { traceId: "trace_7" });
  const providerCall = instance.calls.find(([name]) => name === "generateStructured")[1];
  assert.equal(providerCall.route.routeId, "route_1");
  assert.equal(providerCall.routes, undefined);
  assert.equal(instance.calls.some(([name]) => name === "validateArtifact"), true);
});

test("generation validation failure refunds before publication", async () => {
  const instance = serviceHarness({
    validateArtifact: async () => ({ outcome: "fail", reasonCode: "schema_invalid" })
  });
  await assert.rejects(() => instance.service.generate("user_1", {
    providerRequest: { dataClass: "paper", modality: "semantic_graph" },
    reservation: {
      idempotencyKey: "generation-0004",
      modality: "semantic_graph",
      routeId: "route_1",
      traceId: "trace_8",
      units: 4
    }
  }, { traceId: "trace_8" }), /visualization_validation_failed/);
  assert.equal(instance.calls.at(-1)[0], "rollback");
  assert.equal(instance.calls.at(-1)[2].reasonCode, "validation_failed");
});

test("generation records available provider cost metadata outside user usage", async () => {
  const instance = serviceHarness({ gateway: {
    async generateStructured(input) {
      return {
        cost: {
          amount: 0.02,
          currency: "USD",
          invocationId: "invocation_1",
          providerRequestId: "provider-request-1",
          units: 2
        },
        text: "{\"artifact\":true}"
      };
    }
  }, repository: {
    async startProviderInvocation() { return { invocation_id: "persisted-invocation" }; }
  } });
  await instance.service.generate("user_1", {
    providerRequest: { dataClass: "paper", modality: "semantic_graph" },
    reservation: {
      idempotencyKey: "generation-0005",
      modality: "semantic_graph",
      routeId: "route_1",
      traceId: "trace_9",
      units: 4
    }
  }, { traceId: "trace_9" });
  const cost = instance.calls.find(([name]) => name === "recordProviderCost")[1];
  assert.deepEqual(cost, {
    amount: 0.02,
    currency: "USD",
    invocationId: "persisted-invocation",
    metadata: { outcome: "succeeded", traceId: "trace_9" },
    providerId: "provider-1",
    providerRequestId: "provider-request-1",
    reasonCode: "provider_succeeded",
    routeId: "route_1",
    units: 2
  });
});
