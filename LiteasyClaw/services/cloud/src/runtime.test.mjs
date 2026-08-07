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
