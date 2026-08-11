import assert from "node:assert/strict";
import test from "node:test";
import { VisualizationService } from "./visualizationService.mjs";

const sourceIdentityHash = "c".repeat(64);

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
      sourceIdentityHash
    };
  });
  const validateArtifact = overrides.validateArtifact ?? (async (input) => {
    calls.push(["validateArtifact", input]);
    return { outcome: "pass", validatorVersions: { schema: "1" } };
  });
  return {
    calls,
    service: new VisualizationService({
      authorizeDocument,
      gateway,
      objectStore: overrides.objectStore,
      repository,
      validateArtifact
    })
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

test("opens only an owned generated raster whose S3 metadata matches the artifact", async () => {
  const sha256 = "a".repeat(64);
  const body = Buffer.from([137, 80, 78, 71]);
  const instance = serviceHarness({
    objectStore: {
      objectKey(value) {
        assert.equal(value, sha256);
        return `private/objects/${value}`;
      },
      async openObject(storageKey) {
        assert.equal(storageKey, `private/objects/${sha256}`);
        return {
          body,
          byteLength: body.byteLength,
          mediaType: "image/png",
          metadata: {
            "asset-kind": "generated-raster",
            "byte-length": String(body.byteLength),
            sha256
          }
        };
      }
    },
    repository: {
      async getPublishedRasterAsset(subjectId, digest) {
        assert.equal(subjectId, "user_1");
        assert.equal(digest, sha256);
        return {
          artifactId: "artifact-raster-1",
          asset: {
            assetRef: `raster:${sha256}`,
            byteLength: body.byteLength,
            mimeType: "image/png",
            sha256
          }
        };
      }
    }
  });

  const opened = await instance.service.openRasterAsset("user_1", sha256);
  assert.equal(opened.artifactId, "artifact-raster-1");
  assert.equal(opened.body, body);

  instance.service.objectStore.openObject = async () => ({
    body,
    byteLength: body.byteLength,
    mediaType: "image/png",
    metadata: { sha256 }
  });
  await assert.rejects(
    () => instance.service.openRasterAsset("user_1", sha256),
    /visualization_raster_asset_integrity_mismatch/
  );
});

test("reloads and strictly validates subject-bound published artifact bodies", async () => {
  const artifact = {
    artifactId: "artifact_1",
    body: { artifactId: "artifact_1", artifactVersion: "liteasy.visualization/v1" },
    contentHash: null,
    evidenceHash: "a".repeat(64),
    modality: "semantic_graph",
    nodeId: "node_1",
    specHash: "b".repeat(64),
    state: "ready"
  };
  const instance = serviceHarness({ repository: {
    async getPublishedArtifacts(subjectId, artifactIds) {
      instance.calls.push(["getPublishedArtifacts", subjectId, artifactIds]);
      return [artifact];
    }
  } });
  assert.deepEqual(await instance.service.publishedArtifacts("user_1", ["artifact_1"]), [artifact.body]);
  assert.deepEqual(instance.calls.map(([name]) => name), ["getPublishedArtifacts", "validateArtifact"]);

  const invalid = serviceHarness({
    repository: { async getPublishedArtifacts() { return [artifact]; } },
    validateArtifact: async () => ({ outcome: "fail" })
  });
  await assert.rejects(
    () => invalid.service.publishedArtifacts("user_1", ["artifact_1"]),
    /visualization_validation_failed/
  );
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
    document: { documentId: "document_1", sourceIdentityHash },
    modality: "semantic_graph",
    reservationId: "reservation_1",
    routeId: "route_1",
    routeRevision: 7,
    settledUnits: 2
  }, { traceId: "trace_4" });
  assert.deepEqual(instance.calls.map(([name]) => name), ["validateArtifact", "authorizeDocument", "publish"]);
  assert.deepEqual(instance.calls[2][2], {
    artifact,
    documents: [{
      access: {
        allowed: true,
        scopeId: "user_1",
        scopeType: "user",
        sourceIdentityHash
      },
      documentId: "document_1",
      isPrimary: true,
      sourceIdentityHash
    }],
    reservationId: "reservation_1",
    routeId: "route_1",
    routeRevision: 7,
    traceId: "trace_4",
    validation: { outcome: "pass", validatorVersions: { schema: "1" } }
  });
});

test("submission passes both raster reservations to publication and rolls both back on failure", async () => {
  const instance = serviceHarness({ repository: {
    async publish() {
      throw new Error("visualization_route_revision_changed");
    }
  } });
  await assert.rejects(() => instance.service.submit("user_1", {
    artifact: { artifactId: "artifact-raster-1", modality: "raster_illustration" },
    auxiliaryReservationIds: ["reservation-structured"],
    document: { documentId: "document_1", sourceIdentityHash },
    modality: "raster_illustration",
    reservationId: "reservation-image",
    routeId: "route-image",
    routeRevision: 3
  }, { traceId: "trace-raster-submit" }), /visualization_route_revision_changed/);

  assert.deepEqual(
    instance.calls.filter(([name]) => name === "rollback").map(([, , input]) => input.reservationId).sort(),
    ["reservation-image", "reservation-structured"]
  );
});

test("submission authorizes every unique source before publishing once", async () => {
  const hashes = new Map([
    ["document_1", "c".repeat(64)],
    ["document_2", "d".repeat(64)]
  ]);
  const instance = serviceHarness({
    authorizeDocument: async (input) => {
      instance.calls.push(["authorizeDocument", input]);
      return {
        allowed: true,
        scopeId: "user_1",
        scopeType: "user",
        sourceIdentityHash: hashes.get(input.document.documentId)
      };
    }
  });
  await instance.service.submit("user_1", {
    artifact: { artifactId: "artifact_1", modality: "semantic_graph" },
    documents: [
      { documentId: "document_1", isPrimary: true, sourceIdentityHash: "c".repeat(64) },
      { documentId: "document_2", isPrimary: false, sourceIdentityHash: "d".repeat(64) }
    ],
    modality: "semantic_graph",
    reservationId: "reservation_1",
    routeId: "route_1",
    routeRevision: 7
  }, { traceId: "trace_multi_source" });

  assert.deepEqual(instance.calls.map(([name]) => name), [
    "validateArtifact", "authorizeDocument", "authorizeDocument", "publish"
  ]);
  assert.equal(instance.calls.at(-1)[2].documents.length, 2);
  assert.equal(instance.calls.at(-1)[2].documents.filter(({ isPrimary }) => isPrimary).length, 1);
});

test("submission rolls back before publication when any source hash changed", async () => {
  const instance = serviceHarness({
    authorizeDocument: async (input) => {
      instance.calls.push(["authorizeDocument", input]);
      return {
        allowed: true,
        scopeId: "user_1",
        scopeType: "user",
        sourceIdentityHash: input.document.documentId === "document_2"
          ? "e".repeat(64)
          : input.document.sourceIdentityHash
      };
    }
  });
  await assert.rejects(
    () => instance.service.submit("user_1", {
      artifact: { artifactId: "artifact_1", modality: "semantic_graph" },
      documents: [
        { documentId: "document_1", isPrimary: true, sourceIdentityHash: "c".repeat(64) },
        { documentId: "document_2", isPrimary: false, sourceIdentityHash: "d".repeat(64) }
      ],
      reservationId: "reservation_1",
      routeId: "route_1",
      routeRevision: 7
    }, { traceId: "trace_changed_source" }),
    /visualization_source_access_revoked/
  );
  assert.deepEqual(instance.calls.map(([name]) => name), [
    "validateArtifact", "authorizeDocument", "authorizeDocument", "rollback"
  ]);
});

test("entitlement revocation immediately before submission refunds and blocks publication", async () => {
  const instance = serviceHarness({ repository: {
    async publish() {
      throw new Error("visualization_entitlement_revoked");
    }
  } });
  await assert.rejects(() => instance.service.submit("user_1", {
    artifact: { artifactId: "artifact_1", modality: "semantic_graph" },
    document: { documentId: "document_1", sourceIdentityHash },
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

test("a failed provider probe finalizes its claim and replays without a second provider call", async () => {
  let calls = 0;
  const records = new Map();
  const route = { routeId: "route-1", revision: 3, modalities: ["semantic_graph"], dataClasses: ["paper"] };
  const input = {
    routeId: "route-1",
    expectedRevision: 3,
    idempotencyKey: "probe-failure-1",
    reason: "verify provider route",
    traceId: "trace-1",
    providerRequest: { modality: "semantic_graph", dataClass: "paper" }
  };
  const instance = serviceHarness({
    gateway: {
      async testRoute() {
        calls += 1;
        throw new Error("provider down");
      }
    },
    repository: {
      async claimProviderProbe(probeInput) {
        const prior = records.get(probeInput.idempotencyKey);
        if (prior) return { ...prior, replayed: true };
        records.set(probeInput.idempotencyKey, { pending: true });
        return { claimed: true, route };
      },
      async getProviderProbeReplay(probeInput) {
        const prior = records.get(probeInput.idempotencyKey);
        return prior?.pending ? null : { ...prior, replayed: true };
      },
      async recordProviderProbe(probeInput) {
        records.set(probeInput.idempotencyKey, {
          routeId: probeInput.routeId,
          routeRevision: probeInput.expectedRevision,
          error: { code: "visualization_provider_unavailable", status: 503 }
        });
        return records.get(probeInput.idempotencyKey);
      }
    }
  });

  await assert.rejects(() => instance.service.testProviderRoute(
    { subjectId: "admin-1", roles: ["platform_admin"], authentication: { fresh: true } }, input
  ), (error) => error.code === "visualization_provider_unavailable" && error.status === 503);
  const replay = await instance.service.testProviderRoute(
    { subjectId: "admin-1", roles: ["platform_admin"], authentication: { fresh: true } }, input
  );
  assert.equal(calls, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.error.code, "visualization_provider_unavailable");
});

test("a cancelled provider probe finalizes a replayable 499 error", async () => {
  const records = [];
  const controller = new AbortController();
  const instance = serviceHarness({
    gateway: {
      async testRoute() {
        controller.abort();
        throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      }
    },
    repository: {
      async claimProviderProbe() { return { claimed: true, route: { routeId: "route-1", revision: 3, modalities: ["semantic_graph"], dataClasses: ["paper"] } }; },
      async recordProviderProbe(input) { records.push(input); return { cancelled: true }; }
    }
  });
  await assert.rejects(() => instance.service.testProviderRoute(
    { subjectId: "admin-1", roles: ["platform_admin"], authentication: { fresh: true } },
    {
      routeId: "route-1", expectedRevision: 3, idempotencyKey: "probe-cancel-1",
      reason: "verify provider route", traceId: "trace-1",
      providerRequest: { modality: "semantic_graph", dataClass: "paper" }
    }, controller.signal
  ), /visualization_request_aborted/);
  assert.equal(records[0].error.code, "visualization_request_aborted");
  assert.equal(records[0].error.status, 499);
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

test("provider cost remains linked to the durable invocation on success and cancellation", async () => {
  const subject = { subjectId: "user-1" };
  const invocations = [];
  const costRows = [];
  const completions = [];
  let cancelled = false;
  const repository = {
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
    async recordProviderCost(row) { costRows.push(row); },
    async reserve() {
      return { reservation: {
        idempotencyKey: `generation-${invocations.length + 1}`,
        modality: "semantic_graph",
        reservationId: `reservation-${invocations.length + 1}`,
        routeId: "route-1",
        routeRevision: 7
      } };
    },
    async rollback() {},
    async startProviderInvocation(invocation) {
      invocations.push(invocation);
      return { invocationId: invocation.invocationId };
    },
    async completeProviderInvocation(completion) { completions.push(completion); }
  };
  const controller = new AbortController();
  let activeController = controller;
  const service = new VisualizationService({
    authorizeDocument: async () => ({ allowed: true }),
    gateway: {
      async generateStructured({ signal }) {
        const cost = {
          amount: 0.02,
          currency: "USD",
          providerRequestId: "provider-request-9",
          units: 2
        };
        if (cancelled) {
          activeController.abort();
          throw Object.assign(new Error("visualization_request_aborted"), {
            code: "visualization_request_aborted",
            cost
          });
        }
        assert.equal(signal, controller.signal);
        return { cost, text: "{\"artifact\":true}" };
      }
    },
    repository,
    validateArtifact: async () => ({ outcome: "pass" })
  });
  const input = {
    providerRequest: { dataClass: "paper", modality: "semantic_graph" },
    reservation: {
      idempotencyKey: "generation-0009",
      modality: "semantic_graph",
      routeId: "route-1",
      traceId: "trace-9",
      units: 4
    }
  };

  await service.generate(subject, input, { signal: controller.signal, traceId: "trace-9" });
  assert.equal(costRows[0].invocationId, invocations[0].invocationId);
  assert.equal(costRows[0].providerRequestId, "provider-request-9");
  assert.equal(completions[0].providerRequestId, "provider-request-9");

  const cancelledController = new AbortController();
  cancelled = true;
  activeController = cancelledController;
  await assert.rejects(
    service.generate(subject, input, { signal: cancelledController.signal, traceId: "trace-10" }),
    /visualization_request_aborted/
  );
  assert.equal(costRows.at(-1).invocationId, invocations.at(-1).invocationId);
  assert.equal(costRows.at(-1).providerRequestId, "provider-request-9");
  assert.equal(completions.at(-1).invocationId, invocations.at(-1).invocationId);
  assert.equal(completions.at(-1).providerRequestId, "provider-request-9");
  assert.equal(completions.at(-1).state, "cancelled");
});

test("replayed provider invocations do not contact the gateway twice", async () => {
  let gatewayCalls = 0;
  let starts = 0;
  const route = {
    dataClasses: ["paper"],
    enabled: true,
    modalities: ["semantic_graph"],
    operations: ["structured_generation"],
    providerId: "provider-1",
    revision: 1,
    routeId: "route-1"
  };
  const service = new VisualizationService({
    authorizeDocument: async () => ({ allowed: true }),
    gateway: {
      async generateStructured() {
        gatewayCalls += 1;
        return { cost: { amount: 0.02, currency: "USD", providerRequestId: "provider-request-12", units: 2 }, text: "{\"artifact\":true}" };
      }
    },
    repository: {
      async finalizeProviderInvocation() {},
      async getProviderRoute() { return route; },
      async reserve() {
        return { reservation: {
          idempotencyKey: "generation-0012",
          modality: "semantic_graph",
          reservationId: "reservation-12",
          routeId: "route-1",
          routeRevision: 1
        } };
      },
      async rollback() {},
      async startProviderInvocation() {
        starts += 1;
        return starts === 1
          ? { invocationId: "durable-invocation-12", replayed: false, state: "started" }
          : { invocationId: "durable-invocation-12", replayed: true, state: "succeeded" };
      }
    },
    validateArtifact: async () => ({ outcome: "pass" })
  });
  const input = {
    providerRequest: { dataClass: "paper", modality: "semantic_graph" },
    reservation: { idempotencyKey: "generation-0012", modality: "semantic_graph", routeId: "route-1", units: 4 }
  };

  await service.generate({ subjectId: "user-1" }, input);
  await assert.rejects(
    service.generate({ subjectId: "user-1" }, input),
    (error) => error.code === "visualization_invocation_replayed" && error.status === 409
  );
  assert.equal(gatewayCalls, 1);
});

test("failed atomic provider reconciliation does not fall back to a second cost write", async () => {
  const calls = [];
  const route = {
    dataClasses: ["paper"],
    enabled: true,
    modalities: ["semantic_graph"],
    operations: ["structured_generation"],
    providerId: "provider-1",
    revision: 1,
    routeId: "route-1"
  };
  const service = new VisualizationService({
    authorizeDocument: async () => ({ allowed: true }),
    gateway: {
      async generateStructured() {
        return { cost: { amount: 0.02, currency: "USD", providerRequestId: "provider-request-duplicate", units: 2 }, text: "{\"artifact\":true}" };
      }
    },
    repository: {
      async finalizeProviderInvocation(input) {
        calls.push(["finalize", input]);
        throw new Error("visualization_provider_request_id_conflict");
      },
      async getProviderRoute() { return route; },
      async recordProviderCost(input) { calls.push(["legacy-cost", input]); },
      async reserve() {
        return { reservation: {
          idempotencyKey: "generation-0013",
          modality: "semantic_graph",
          reservationId: "reservation-13",
          routeId: "route-1",
          routeRevision: 1
        } };
      },
      async rollback() { calls.push(["rollback"]); },
      async startProviderInvocation() { return { invocationId: "durable-invocation-13", replayed: false, state: "started" }; }
    },
    validateArtifact: async () => ({ outcome: "pass" })
  });

  await assert.rejects(
    service.generate({ subjectId: "user-1" }, {
      providerRequest: { dataClass: "paper", modality: "semantic_graph" },
      reservation: { idempotencyKey: "generation-0013", modality: "semantic_graph", routeId: "route-1", units: 4 }
    }),
    /visualization_provider_request_id_conflict/
  );
  assert.deepEqual(calls.map(([name]) => name), ["finalize", "rollback"]);
  assert.equal(calls[0][1].cost.invocationId, "durable-invocation-13");
});

test("late cancellation finalizes the provider invocation as cancelled with one durable cost row", async () => {
  const controller = new AbortController();
  const costRows = [];
  const finalizations = [];
  const rollbacks = [];
  const route = {
    dataClasses: ["paper"],
    enabled: true,
    modalities: ["semantic_graph"],
    operations: ["structured_generation"],
    providerId: "provider-1",
    revision: 1,
    routeId: "route-1"
  };
  const service = new VisualizationService({
    authorizeDocument: async () => ({ allowed: true }),
    gateway: {
      async generateStructured() {
        controller.abort();
        return { cost: { amount: 0.02, currency: "USD", providerRequestId: "provider-request-14", units: 2 }, text: "{\"artifact\":true}" };
      }
    },
    repository: {
      async finalizeProviderInvocation(input) {
        finalizations.push(input);
        if (input.cost) costRows.push(input.cost);
      },
      async getProviderRoute() { return route; },
      async reserve() {
        return { reservation: {
          idempotencyKey: "generation-0014",
          modality: "semantic_graph",
          reservationId: "reservation-14",
          routeId: "route-1",
          routeRevision: 1
        } };
      },
      async rollback(_subject, input) { rollbacks.push(input); },
      async startProviderInvocation() { return { invocationId: "durable-invocation-14", replayed: false, state: "started" }; }
    },
    validateArtifact: async () => ({ outcome: "pass" })
  });

  await assert.rejects(
    service.generate({ subjectId: "user-1" }, {
      providerRequest: { dataClass: "paper", modality: "semantic_graph" },
      reservation: { idempotencyKey: "generation-0014", modality: "semantic_graph", routeId: "route-1", units: 4 }
    }, { signal: controller.signal }),
    /visualization_request_aborted/
  );
  assert.equal(finalizations.length, 1);
  assert.equal(finalizations[0].state, "cancelled");
  assert.equal(finalizations[0].cost.invocationId, "durable-invocation-14");
  assert.equal(finalizations[0].cost.providerRequestId, "provider-request-14");
  assert.equal(costRows.length, 1);
  assert.equal(costRows[0].invocationId, "durable-invocation-14");
  assert.equal(rollbacks.length, 1);
});
