import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderConfigurationService } from "./aiProviderConfigurationService.mjs";

function fakePool() {
  const state = { auditDetails: [], idempotency: null, row: null };
  const client = {
    async query(sql, params = []) {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM idempotency_records")) {
        return { rows: state.idempotency ? [state.idempotency] : [] };
      }
      if (sql.includes("FROM platform_ai_provider_configuration")) {
        return { rows: state.row ? [state.row] : [] };
      }
      if (sql.includes("INSERT INTO platform_ai_provider_configuration")) {
        state.row = {
          algorithm: params[0],
          authentication_tag: params[2],
          configuration_id: "active",
          encrypted_payload: params[3],
          initialization_vector: params[1],
          revision: 1,
          updated_at: new Date("2026-08-13T08:00:00.000Z"),
          updated_by: params[4]
        };
        return { rows: [state.row] };
      }
      if (sql.includes("INSERT INTO audit_events")) {
        state.auditDetails.push(params[4]);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO idempotency_records")) {
        state.idempotency = { request_hash: params[2], response_body: JSON.parse(params[3]) };
        return { rows: [] };
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
    release() {}
  };
  return {
    async connect() { return client; },
    async query(sql, params) { return client.query(sql, params); },
    state
  };
}

test("encrypts provider credentials and returns status only", async () => {
  const pool = fakePool();
  const reconfigured = { mineru: null, providers: null };
  const service = new AiProviderConfigurationService({
    encryptionKey: Buffer.alloc(32, 5),
    environment: "staging",
    fallbackConfig: { mineru: { timeoutMs: 600_000 }, models: { timeoutMs: 60_000 } },
    mineruPdfService: { reconfigure(config) { reconfigured.mineru = config; } },
    modelProxyService: { reconfigure(providers) { reconfigured.providers = providers; } },
    pool
  });
  const secrets = {
    apiKey: "model-api-key-private",
    baseUrl: "https://models.example/v1",
    mineruToken: "mineru-token-private",
    model: "vision-model-private"
  };
  const response = await service.save({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    ...secrets,
    expectedRevision: 0,
    idempotencyKey: "configure-ai-0001",
    reason: "Enable staging AI providers",
    traceId: "trace-1"
  });
  assert.deepEqual(response.configuration, {
    configured: true,
    mineruConfigured: true,
    modelProviderConfigured: true,
    revision: 1,
    updatedAt: "2026-08-13T08:00:00.000Z",
    updatedBy: "admin-1",
    writable: true
  });
  const persisted = Buffer.concat([
    pool.state.row.authentication_tag,
    pool.state.row.encrypted_payload,
    pool.state.row.initialization_vector
  ]).toString("utf8");
  for (const secret of Object.values(secrets)) assert.equal(persisted.includes(secret), false);
  assert.equal(JSON.stringify(pool.state.auditDetails).includes("private"), false);
  assert.equal(JSON.stringify(response).includes("private"), false);
  assert.equal(reconfigured.mineru.token, secrets.mineruToken);
  assert.equal(reconfigured.providers.openai.model, secrets.model);
  assert.deepEqual(await service.status({ roles: ["platform_admin"] }), response.configuration);
});

test("loads encrypted configuration after restart without exposing it in status", async () => {
  const pool = fakePool();
  const firstModel = { reconfigure() {} };
  const firstMineru = { reconfigure() {} };
  const input = {
    apiKey: "model-api-key-private",
    baseUrl: "https://models.example/v1",
    expectedRevision: 0,
    idempotencyKey: "configure-ai-0002",
    mineruToken: "mineru-token-private",
    model: "vision-model-private",
    reason: "Enable staging AI providers",
    traceId: "trace-2"
  };
  const options = {
    encryptionKey: Buffer.alloc(32, 9),
    environment: "staging",
    fallbackConfig: { mineru: {}, models: {} },
    mineruPdfService: firstMineru,
    modelProxyService: firstModel,
    pool
  };
  await new AiProviderConfigurationService(options).save(
    { roles: ["platform_admin"], subjectId: "admin-1" },
    input
  );
  let restoredMineru;
  const restored = new AiProviderConfigurationService({
    ...options,
    mineruPdfService: { reconfigure(config) { restoredMineru = config; } },
    modelProxyService: { reconfigure() {} }
  });
  const status = await restored.initialize();
  assert.equal(status.configured, true);
  assert.equal(restoredMineru.token, input.mineruToken);
  assert.equal(JSON.stringify(status).includes("private"), false);
});
