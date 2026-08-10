import assert from "node:assert/strict";
import test from "node:test";
import { readMigrations } from "./migrations.mjs";
import { startCloudRuntime } from "./runtime.mjs";

function poolWithReadiness({
  migrationRows = readMigrations().map(({ checksum, name }) => ({ checksum_sha256: checksum, name })),
  readOnly = "off",
  version = 150000
} = {}) {
  let ended = false;
  const client = {
    async query(sql) {
      if (sql.includes("SELECT name, checksum_sha256")) return { rows: migrationRows };
      return { rows: [] };
    },
    release() {}
  };
  return {
    async connect() { return client; },
    async end() { ended = true; },
    get ended() { return ended; },
    async query(sql) {
      if (sql.includes("SELECT name, checksum_sha256")) return { rows: migrationRows };
      return { rows: [{ database_name: "liteasy", server_version_num: version, transaction_read_only: readOnly }] };
    }
  };
}

test("does not become ready until PostgreSQL migrations and S3 controls pass", async () => {
  const pool = poolWithReadiness();
  let securityChecked = false;
  const identityVerifier = { verifyAuthorizationHeader() {} };
  const pdfUploadService = {
    async assertNoUnverifiedObjects() { return { unverified: 0 }; },
    async repairPendingWorkflows() { return { repaired: 0, scanned: 0 }; }
  };
  const runtime = await startCloudRuntime({ recommendation: {
    endpoint: "https://api.crossref.org/works", mailto: "test@example.com", timeoutMs: 1000
  } }, {
    identityReadinessCheck: async () => ({ discovery: true, jwks: true }),
    identityVerifier,
    objectStore: {
      async assertSecurityConfiguration() {
        securityChecked = true;
        return { privateAccess: true };
      }
    },
    pdfUploadService,
    pool
  });
  assert.equal(securityChecked, true);
  assert.equal(runtime.identityVerifier, identityVerifier);
  assert.deepEqual(runtime.readiness, {
    identity: "ready",
    migrations: "current",
    modelProxy: "unavailable",
    objectStorage: "ready",
    pdfSecurity: "ready",
    postgres: "ready",
    storageWorkflows: "current"
  });
  await runtime.close();
  assert.equal(pool.ended, true);
});

test("closes the pool and refuses startup when an infrastructure gate fails", async () => {
  const pool = poolWithReadiness();
  await assert.rejects(
    () => startCloudRuntime({ recommendation: {
      endpoint: "https://api.crossref.org/works", mailto: "test@example.com", timeoutMs: 1000
    } }, {
      identityReadinessCheck: async () => ({ discovery: true, jwks: true }),
      identityVerifier: {},
      pdfUploadService: {
        async assertNoUnverifiedObjects() { return { unverified: 0 }; },
        async repairPendingWorkflows() { return { repaired: 0, scanned: 0 }; }
      },
      objectStore: { async assertSecurityConfiguration() { throw new Error("bucket unsafe"); } },
      pool
    }),
    /bucket unsafe/
  );
  assert.equal(pool.ended, true);
});

test("refuses readiness while legacy PDF objects still lack scan proof", async () => {
  const pool = poolWithReadiness();
  await assert.rejects(
    () => startCloudRuntime({ recommendation: {
      endpoint: "https://api.crossref.org/works", mailto: "test@example.com", timeoutMs: 1000
    } }, {
      identityReadinessCheck: async () => ({ discovery: true, jwks: true }),
      identityVerifier: {},
      objectStore: { async assertSecurityConfiguration() { return { privateAccess: true }; } },
      pdfUploadService: {
        async assertNoUnverifiedObjects() { throw new Error("storage_security_backfill_required"); },
        async repairPendingWorkflows() { return { repaired: 0, scanned: 0 }; }
      },
      pool
    }),
    /storage_security_backfill_required/
  );
  assert.equal(pool.ended, true);
});

test("wires visualization dependencies while preserving injection", async () => {
  const pool = poolWithReadiness();
  const visualizationRepository = { capability() {} };
  const visualizationProviderGateway = { generateStructured() {} };
  const visualizationArtifactCompilerRegistry = { availableModalities() { return ["test"]; } };
  const visualizationGenerationRepository = {};
  let recoveryScheduled = false;
  const visualizationOrchestrationWorker = {
    abort() {}, close() {}, drainOne() {}, recover() {}, schedule() {},
    scheduleRecovery() { recoveryScheduled = true; }
  };
  const thinReadingVisualizationSourceResolver = {};
  const runtime = await startCloudRuntime({ recommendation: {
    endpoint: "https://api.crossref.org/works", mailto: "test@example.com", timeoutMs: 1000
  } }, {
    identityReadinessCheck: async () => ({ discovery: true, jwks: true }),
    identityVerifier: {},
    objectStore: { async assertSecurityConfiguration() { return { privateAccess: true }; } },
    pdfUploadService: {
      async assertNoUnverifiedObjects() { return { unverified: 0 }; },
      async repairPendingWorkflows() { return { repaired: 0, scanned: 0 }; }
    },
    pool,
    thinReadingVisualizationSourceResolver,
    visualizationArtifactCompilerRegistry,
    visualizationGenerationRepository,
    visualizationOrchestrationWorker,
    visualizationProviderGateway,
    visualizationRepository
  });
  assert.equal(runtime.visualizationRepository, visualizationRepository);
  assert.equal(runtime.visualizationArtifactCompilerRegistry, visualizationArtifactCompilerRegistry);
  assert.equal(runtime.visualizationGenerationRepository, visualizationGenerationRepository);
  assert.equal(runtime.visualizationOrchestrationWorker, visualizationOrchestrationWorker);
  assert.equal(runtime.visualizationOrchestrationService.worker, visualizationOrchestrationWorker);
  assert.equal(recoveryScheduled, true);
  assert.equal(runtime.visualizationProviderGateway, visualizationProviderGateway);
  assert.equal(runtime.visualizationService.repository, visualizationRepository);
  await runtime.close();
});

test("wires production static science compilers behind explicit generated catalog entries", async () => {
  const pool = poolWithReadiness();
  const runtime = await startCloudRuntime({ recommendation: {
    endpoint: "https://api.crossref.org/works", mailto: "test@example.com", timeoutMs: 1000
  } }, {
    identityReadinessCheck: async () => ({ discovery: true, jwks: true }),
    identityVerifier: {},
    objectStore: { async assertSecurityConfiguration() { return { privateAccess: true }; } },
    pdfUploadService: {
      async assertNoUnverifiedObjects() { return { unverified: 0 }; },
      async repairPendingWorkflows() { return { repaired: 0, scanned: 0 }; }
    },
    pool,
    visualizationBuiltinCatalog: {
      entries: [{ enabled: true, generated: true, modality: "semantic_graph", skillId: "semantic-graph" }],
      version: "liteasy.visualization-builtins/v1"
    },
    visualizationProviderGateway: { generateStructured() {} },
    visualizationRepository: { capability() {} }
  });
  assert.deepEqual(runtime.visualizationArtifactCompilerRegistry.availableModalities(), ["semantic_graph"]);
  await runtime.close();
});

test("constructs visualization gateway with the validated hostname policy and secret store", async () => {
  const pool = poolWithReadiness();
  let options;
  const gateway = { generateStructured() {} };
  const runtime = await startCloudRuntime({
    recommendation: { endpoint: "https://api.crossref.org/works", mailto: "test@example.com", timeoutMs: 1000 },
    visualization: {
      egressHostnames: ["provider.example"],
      secrets: { "viz-secret:provider-1": "deployment-secret" }
    }
  }, {
    identityReadinessCheck: async () => ({ discovery: true, jwks: true }),
    identityVerifier: {},
    objectStore: { async assertSecurityConfiguration() { return { privateAccess: true }; } },
    pdfUploadService: {
      async assertNoUnverifiedObjects() { return { unverified: 0 }; },
      async repairPendingWorkflows() { return { repaired: 0, scanned: 0 }; }
    },
    pool,
    visualizationProviderGatewayFactory(input) { options = input; return gateway; },
    visualizationRepository: { capability() {} }
  });
  assert.deepEqual(options.egressPolicy, { allowedHostnames: ["provider.example"] });
  assert.deepEqual(Object.keys(options.adapters).sort(), ["openai", "openai-compatible"]);
  assert.equal(options.secretStore.resolve("viz-secret:provider-1"), "deployment-secret");
  assert.deepEqual(runtime.visualizationArtifactCompilerRegistry.availableModalities().sort(), [
    "biology_structure", "circuit", "physics_diagram", "semantic_graph"
  ]);
  await runtime.close();
});

test("wires scope-bearing document authorization and an operational visualization validator", async () => {
  const pool = poolWithReadiness();
  const runtime = await startCloudRuntime({ recommendation: {
    endpoint: "https://api.crossref.org/works", mailto: "test@example.com", timeoutMs: 1000
  } }, {
    identityReadinessCheck: async () => ({ discovery: true, jwks: true }),
    identityVerifier: {},
    libraryRepository: {
      async getDownloadablePdf() {
        return { contentHash: "a".repeat(64) };
      }
    },
    objectStore: { async assertSecurityConfiguration() { return { privateAccess: true }; } },
    pdfUploadService: {
      async assertNoUnverifiedObjects() { return { unverified: 0 }; },
      async repairPendingWorkflows() { return { repaired: 0, scanned: 0 }; }
    },
    pool,
    visualizationProviderGateway: { generateStructured() {} },
    visualizationRepository: { capability() {} }
  });
  assert.deepEqual(await runtime.visualizationService.authorizeDocument({
    document: {
      documentId: "document-1",
      scopeType: "user",
      sourceIdentityHash: "a".repeat(64)
    },
    subjectId: "user-1"
  }), {
    allowed: true,
    scopeId: "user-1",
    scopeType: "user",
    sourceIdentityHash: "a".repeat(64)
  });
  assert.deepEqual(await runtime.visualizationService.validateArtifact({
    modality: "semantic_graph",
    phase: "provider_result",
    providerResult: { text: "{\"artifact\":true}" }
  }), {
    outcome: "pass",
    validatorVersions: { structure: "1" }
  });
  await runtime.close();
});
