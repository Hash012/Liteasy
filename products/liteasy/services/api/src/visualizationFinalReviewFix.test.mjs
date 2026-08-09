import assert from "node:assert/strict";
import test from "node:test";
import { loadCloudConfig } from "./config.mjs";
import { PostgresVisualizationRepository } from "./visualizationRepository.mjs";
import { VisualizationProviderGateway } from "./visualizationProviderGateway.mjs";
import { VisualizationService } from "./visualizationService.mjs";

function validEnv(overrides = {}) {
  return {
    DATABASE_URL: "postgresql://liteasy:secret@db.internal/liteasy",
    LITEASY_ALLOWED_ORIGINS: "http://tauri.localhost",
    LITEASY_DATABASE_SSL_MODE: "verify-full",
    LITEASY_IDP_CLIENT_ID: "liteasy-cloud",
    LITEASY_IDP_CLIENT_SECRET: "identity-secret",
    LITEASY_IDP_ADMIN_CLIENT_ID: "liteasy-admin-public",
    LITEASY_IDP_DESKTOP_CLIENT_ID: "liteasy-desktop-public",
    LITEASY_IDP_DISCOVERY_URL: "https://identity.internal/.well-known/openid-configuration",
    LITEASY_IDP_INTROSPECTION_URL: "https://identity.internal/oauth2/introspect",
    LITEASY_IDP_INTUECHO_SERVICE_CLIENT_ID: "intuecho-organization-service",
    LITEASY_IDP_ISSUER: "https://identity.internal",
    LITEASY_IDP_JWKS_URL: "https://identity.internal/.well-known/jwks.json",
    LITEASY_IDP_MANAGEMENT_CLIENT_ID: "liteasy-account-lifecycle",
    LITEASY_IDP_MANAGEMENT_CLIENT_SECRET: "management-secret",
    LITEASY_IDP_MANAGEMENT_URL: "https://identity-admin.internal",
    LITEASY_IDP_REVOCATION_URL: "https://identity.internal/oauth2/revoke",
    LITEASY_IDP_TOKEN_URL: "https://identity.internal/oauth2/token",
    LITEASY_INTUECHO_ADMIN_API_URL: "https://forum-api.internal",
    LITEASY_MIGRATION_DATABASE_URL: "postgresql://liteasy_migrator:secret@db.internal/liteasy",
    LITEASY_PDF_SCANNER_SECRET: "scanner-deployment-secret",
    LITEASY_PDF_SCANNER_URL: "https://scanner.internal/v1/pdf:scan",
    LITEASY_RECOMMENDATION_CONTACT_EMAIL: "operations@liteasy.example",
    LITEASY_S3_BUCKET: "liteasy-private-documents",
    LITEASY_S3_REGION: "ap-southeast-1",
    NODE_ENV: "production",
    ...overrides
  };
}

test("requires a dedicated visualization service client id", () => {
  assert.throws(() => loadCloudConfig(validEnv()), /LITEASY_IDP_VISUALIZATION_SERVICE_CLIENT_ID/);
  const config = loadCloudConfig(validEnv({
    LITEASY_IDP_VISUALIZATION_SERVICE_CLIENT_ID: "liteasy-visualization-service"
  }));
  assert.equal(config.identity.visualizationServiceClientId, "liteasy-visualization-service");
});

test("reserves server-derived weighted units and enforces explicit request origin", async () => {
  const calls = [];
  const route = {
    circuitFailures: 0, circuitOpenUntil: null, circuitState: "closed", dataClasses: ["paper"],
    enabled: true, endpoint: "https://provider.example/v1", maxConcurrency: 1,
    modalities: ["semantic_graph"], model: "visual-1", operations: ["structured_generation"],
    priority: 1, providerId: "provider-1", region: "global", revision: 3,
    routeId: "route-1", secretRef: "viz-secret:provider-1", timeoutMs: 30000
  };
  const repository = {
    async reserve(_subject, input) {
      if (input.requestedBy === "explicit") throw new Error("visualization_explicit_request_not_allowed");
      calls.push(input);
      return { reservation: {
        reservationId: "reservation-1", modality: "semantic_graph", routeId: "route-1",
        routeRevision: 3, policyRevision: 4, costTableRevision: 9, reservedUnits: 7, state: "reserved"
      } };
    },
    async getProviderRoute() { return route; },
    async rollback() {},
    async getEntitlement() { return { allowed: true }; }
  };
  const service = new VisualizationService({
    authorizeDocument: async () => ({ allowed: true, sourceIdentityHash: "hash" }),
    gateway: { async generateStructured() { return { text: "ok" }; } },
    repository,
    validateArtifact: async () => ({ outcome: "pass" })
  });
  await service.generate("user-1", {
    reservation: { idempotencyKey: "request-0001", modality: "semantic_graph", routeId: "route-1", units: 999, requestedBy: "automatic" },
    providerRequest: { dataClass: "paper", operation: "structured_generation" }
  });
  assert.equal(calls[0].units, 999, "the repository receives the request but must ignore caller units when pricing is configured");
  await assert.rejects(
    service.generate("user-1", {
      reservation: { idempotencyKey: "request-0002", modality: "semantic_graph", routeId: "route-1", requestedBy: "explicit" },
      providerRequest: { dataClass: "paper", operation: "structured_generation" }
    }),
    /visualization_explicit_request_not_allowed/
  );
});

test("testRoute loads the stored route, checks revision, and records a redacted audit", async () => {
  const calls = [];
  const storedRoute = {
    circuitFailures: 0, circuitOpenUntil: null, circuitState: "closed", dataClasses: ["paper"],
    enabled: true, endpoint: "https://provider.example/v1", maxConcurrency: 1,
    modalities: ["semantic_graph"], model: "visual-1", operations: ["validation"], priority: 1,
    providerId: "provider-1", region: "global", revision: 4, routeId: "route-1",
    secretRef: "viz-secret:provider-1", timeoutMs: 30000
  };
  const repository = {
    async getProviderRoute(routeId) { calls.push(["load", routeId]); return storedRoute; },
    async recordProviderProbe(input) { calls.push(["audit", input]); return { probe: { reachable: true } }; }
  };
  const gateway = {
    async testRoute(input) { calls.push(["probe", input]); return { reachable: true, authenticated: true, capabilities: ["validation"] }; }
  };
  const service = new VisualizationService({
    authorizeDocument: async () => ({ allowed: true }), gateway, repository,
    validateArtifact: async () => ({ outcome: "pass" })
  });
  await service.testProviderRoute({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    expectedRevision: 4, idempotencyKey: "probe-0001", reason: "Connectivity check", routeId: "route-1",
    providerRequest: { dataClass: "paper", modality: "semantic_graph", routes: [{ endpoint: "https://attacker.invalid" }] }, traceId: "trace-1"
  });
  assert.equal(calls[0][0], "load");
  assert.equal(calls.find(([kind]) => kind === "probe")[1].route, storedRoute);
  assert.equal(calls.find(([kind]) => kind === "probe")[1].routes, undefined);
  assert.equal(calls.find(([kind]) => kind === "audit")[1].paperContent, undefined);
});

test("testRoute returns an idempotent replay before contacting the provider", async () => {
  const calls = [];
  const replay = { probe: { authenticated: true, capabilities: ["validation"], reachable: true }, replayed: true };
  const repository = {
    async getProviderProbeReplay(input) { calls.push(["replay", input]); return replay; },
    async getProviderRoute() { calls.push(["load"]); throw new Error("route_must_not_be_loaded"); },
    async recordProviderProbe() { calls.push(["audit"]); throw new Error("audit_must_not_repeat"); }
  };
  const gateway = {
    async testRoute() { calls.push(["probe"]); throw new Error("provider_must_not_be_contacted"); }
  };
  const service = new VisualizationService({
    authorizeDocument: async () => ({ allowed: true }), gateway, repository,
    validateArtifact: async () => ({ outcome: "pass" })
  });
  assert.equal(await service.testProviderRoute({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    expectedRevision: 4,
    idempotencyKey: "probe-0001",
    reason: "Connectivity check",
    routeId: "route-1",
    traceId: "trace-1"
  }), replay);
  assert.deepEqual(calls.map(([kind]) => kind), ["replay"]);
});

test("testRoute claims its idempotency key before external provider I/O", async () => {
  const calls = [];
  const route = {
    circuitFailures: 0, circuitOpenUntil: null, circuitState: "closed", dataClasses: ["paper"], enabled: true,
    endpoint: "https://provider.example/v1", maxConcurrency: 1, modalities: ["semantic_graph"], model: "visual-1",
    operations: ["validation"], priority: 1, providerId: "provider-1", region: "global", revision: 4,
    routeId: "route-1", secretRef: "viz-secret:provider-1", timeoutMs: 30000
  };
  const repository = {
    async claimProviderProbe() { calls.push("claim"); return { route, replayed: false }; },
    async recordProviderProbe() { calls.push("record"); return { probe: { reachable: true } }; }
  };
  const gateway = { async testRoute() { calls.push("provider"); return { authenticated: true, capabilities: ["validation"], reachable: true }; } };
  const service = new VisualizationService({ authorizeDocument: async () => ({ allowed: true }), gateway, repository, validateArtifact: async () => ({ outcome: "pass" }) });
  await service.testProviderRoute({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    expectedRevision: 4, idempotencyKey: "probe-0001", reason: "Connectivity check", routeId: "route-1", traceId: "trace-1"
  });
  assert.deepEqual(calls, ["claim", "provider", "record"]);
});

test("gateway keeps provider cost on normalized errors and uses the durable invocation id", async () => {
  const route = {
    circuitFailures: 0, circuitOpenUntil: null, circuitState: "closed", dataClasses: ["paper"], enabled: true,
    endpoint: "https://provider.example/v1", maxConcurrency: 1, modalities: ["semantic_graph"], model: "visual-1",
    operations: ["structured_generation"], priority: 1, providerId: "provider-1", region: "global", revision: 1,
    routeId: "route-1", secretRef: "viz-secret:provider-1", timeoutMs: 30000
  };
  const gateway = new VisualizationProviderGateway({
    adapter: { async generateStructured() { throw Object.assign(new Error("provider failed"), { cost: { amount: 0.02, currency: "USD", providerRequestId: "provider-request-1", units: 2 } }); } },
    dnsLookup: async () => [{ address: "8.8.8.8", family: 4 }], egressPolicy: { allowedHostnames: ["provider.example"] },
    secretStore: { resolve: () => "deployment-secret" }
  });
  await assert.rejects(
    gateway.generateStructured({ dataClass: "paper", invocationId: "invocation-1", modality: "semantic_graph", route, signal: new AbortController().signal }),
    (error) => error.cost?.invocationId === "invocation-1" && error.cost?.providerRequestId === "provider-request-1"
  );
});

test("generation translates reservation failures before provider work starts", async () => {
  const repository = {
    async reserve() { throw new Error("visualization_quota_exceeded"); }
  };
  const service = new VisualizationService({
    authorizeDocument: async () => ({ allowed: true }),
    gateway: { async generateStructured() { throw new Error("provider_must_not_be_contacted"); } },
    repository,
    validateArtifact: async () => ({ outcome: "pass" })
  });
  await assert.rejects(service.generate("user-1", {
    providerRequest: { dataClass: "paper", operation: "structured_generation" },
    reservation: { idempotencyKey: "request-0001", modality: "semantic_graph", routeId: "route-1" }
  }), (error) => error.code === "visualization_quota_exceeded" && error.status === 429);
});

test("generation durably records provider cost and cancellation against a replayed invocation", async () => {
  const calls = [];
  const controller = new AbortController();
  const route = {
    dataClasses: ["paper"], enabled: true, modalities: ["semantic_graph"], operations: ["structured_generation"],
    providerId: "provider-1", revision: 3, routeId: "route-1"
  };
  const repository = {
    async completeProviderInvocation(input) { calls.push(["complete", input]); },
    async getProviderRoute() { return route; },
    async recordProviderCost(input) { calls.push(["cost", input]); },
    async reserve() {
      return { reservation: {
        idempotencyKey: "request-0001", modality: "semantic_graph", reservationId: "reservation-1",
        routeId: "route-1", routeRevision: 3
      } };
    },
    async rollback(_subjectId, input) { calls.push(["rollback", input]); },
    async startProviderInvocation(input) { calls.push(["start", input]); return null; }
  };
  const gateway = {
    async generateStructured() {
      controller.abort();
      return { cost: { amount: 0.04, currency: "USD", units: 3 }, text: "late" };
    }
  };
  const service = new VisualizationService({
    authorizeDocument: async () => ({ allowed: true }), gateway, repository,
    validateArtifact: async () => ({ outcome: "pass" })
  });
  await assert.rejects(service.generate("user-1", {
    providerRequest: {
      dataClass: "paper", invocationId: "invocation-1", operation: "structured_generation",
      providerRequestId: "provider-request-1"
    },
    reservation: { idempotencyKey: "request-0001", modality: "semantic_graph", routeId: "route-1" }
  }, { signal: controller.signal, traceId: "trace-1" }), /visualization_request_aborted/);
  assert.deepEqual(calls.map(([kind]) => kind), ["start", "cost", "complete", "rollback"]);
  assert.equal(calls[1][1].invocationId, "invocation-1");
  assert.equal(calls[1][1].providerRequestId, "provider-request-1");
  assert.deepEqual(calls[2][1], {
    errorCode: "visualization_request_aborted",
    invocationId: "invocation-1",
    state: "cancelled"
  });
});

test("provider invocation start returns the committed row on an idempotent conflict", async () => {
  const existing = {
    idempotency_key: "request-0001", invocation_id: "invocation-existing", provider_request_id: "provider-request-1",
    reservation_id: "reservation-1", route_id: "route-1", route_revision: "3"
  };
  const calls = [];
  const repository = new PostgresVisualizationRepository({
    async query(sql, values) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, values });
      if (normalized.startsWith("INSERT INTO visualization_provider_invocations")) return { rows: [] };
      if (normalized.includes("FROM visualization_provider_invocations")) return { rows: [existing] };
      return { rows: [] };
    }
  });
  assert.equal(await repository.startProviderInvocation({
    dataClass: "paper", idempotencyKey: "request-0001", invocationId: "invocation-new",
    modality: "semantic_graph", operation: "structured_generation", providerRequestId: "provider-request-1",
    reservationId: "reservation-1", responseMaxBytes: 2048, routeId: "route-1", routeRevision: 3,
    subjectId: "user-1"
  }), existing);
  assert.equal(calls.some(({ sql }) => sql.includes("FROM visualization_provider_invocations")), true);
});

test("gateway rejects a response whose declared length exceeds the operation limit", async () => {
  const route = {
    circuitFailures: 0, circuitOpenUntil: null, circuitState: "closed", dataClasses: ["paper"], enabled: true,
    endpoint: "https://provider.example/v1", maxConcurrency: 1, modalities: ["semantic_graph"], model: "visual-1",
    operations: ["structured_generation"], priority: 1, providerId: "provider-1", region: "global", revision: 1,
    routeId: "route-1", secretRef: "viz-secret:provider-1", timeoutMs: 30000
  };
  const gateway = new VisualizationProviderGateway({
    adapters: { "provider-1": { async generateStructured({ request }) { return (await request()).json(); } } },
    dnsLookup: async () => [{ address: "8.8.8.8", family: 4 }],
    egressPolicy: { allowedHostnames: ["provider.example"] },
    fetchImpl: async () => {
      const response = new Response("{}", { headers: { "content-length": String(3 * 1024 * 1024) }, status: 200 });
      Object.defineProperty(response, "peerAddress", { value: "8.8.8.8" });
      return response;
    },
    secretStore: { resolve: () => "deployment-secret" }
  });
  await assert.rejects(
    gateway.generateStructured({ dataClass: "paper", modality: "semantic_graph", route, signal: new AbortController().signal }),
    /visualization_provider_response_too_large/
  );
});

test("preference retries are idempotent and equal-unit settlement is a valid transition", async () => {
  const calls = [];
  const row = { enabled: true, revision: "2", subject_id: "user-1" };
  const reservation = {
    reservation_id: "reservation-1", subject_id: "user-1", idempotency_key: "request-0001",
    modality: "semantic_graph", route_id: "route-1", route_revision: "1", policy_revision: "2",
    cost_table_revision: "5", reserved_units: 4, settled_units: null, state: "reserved",
    expires_at: new Date(Date.now() + 60_000)
  };
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(normalized) || normalized.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
      if (normalized.includes("FROM idempotency_records")) return { rows: [] };
      if (normalized.startsWith("INSERT INTO visualization_user_preferences")) return { rows: [row] };
      if (normalized.includes("FROM visualization_quota_reservations")) return { rows: [reservation] };
      if (normalized.startsWith("UPDATE visualization_quota_reservations")) return { rows: [{ ...reservation, state: "settled", settled_units: 4 }] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PostgresVisualizationRepository({
    async connect() { return client; },
    async query(sql, values) { return client.query(sql, values); }
  });
  await repository.setPreference("user-1", { enabled: true, idempotencyKey: "preference-0001", traceId: "trace-1" });
  await repository.settle("user-1", { reservationId: "reservation-1", settledUnits: 4, reasonCode: "completed", traceId: "trace-1" });
  assert.equal(calls.some(({ values }) => values.includes("visualization-preference-set")), true);
  assert.equal(calls.some(({ sql }) => sql.includes("event_type") && sql.includes("cost_table_revision")), true);
});

test("publication binds artifact modality and reservation and returns the committed artifact on replay", async () => {
  const reservation = {
    reservation_id: "reservation-1", subject_id: "user-1", modality: "semantic_graph", route_id: "route-1",
    route_revision: "1", policy_revision: "2", reserved_units: 1, settled_units: 1, state: "settled",
    expires_at: new Date(Date.now() + 60_000)
  };
  const committed = { artifact_id: "artifact-1", body: { artifactVersion: "liteasy.visualization/v1" }, modality: "semantic_graph" };
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(normalized)) return { rows: [] };
      if (normalized.includes("FROM visualization_quota_reservations")) return { rows: [reservation] };
      if (normalized.includes("FROM visualization_artifacts")) return { rows: [committed] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PostgresVisualizationRepository({ async connect() { return client; } });
  const result = await repository.publish("user-1", {
    artifact: { artifactId: "different", body: {}, evidenceHash: "a".repeat(64), specHash: "b".repeat(64), state: "ready" },
    document: { documentId: "doc-1", sourceIdentityHash: "c".repeat(64) },
    reservationId: "reservation-1", routeId: "route-1", routeRevision: 1, settledUnits: 1,
    access: { allowed: true, scopeId: "user-1", scopeType: "user", sourceIdentityHash: "c".repeat(64) },
    validation: { outcome: "pass" }, traceId: "trace-1"
  });
  assert.equal(result.replayed, true);
  assert.equal(result.artifact.artifactId, "artifact-1");
  assert.match(calls.map(({ sql }) => sql).join("\n"), /reservation_id/);
});
