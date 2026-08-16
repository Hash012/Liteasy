import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";
import { AiProviderConfigurationService } from "./aiProviderConfigurationService.mjs";

function fakePool() {
  const state = {
    auditDetails: [],
    idempotency: new Map(),
    row: null,
    structuredRoute: {
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-chat",
      providerId: "deepseek",
      revision: 1,
      secretRef: "viz-secret:platform-deepseek",
      updatedBy: "system"
    }
  };
  const client = {
    async query(sql, params = []) {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM idempotency_records")) {
        const record = state.idempotency.get(params[1]);
        return { rows: record ? [record] : [] };
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
      if (sql.includes("UPDATE platform_ai_provider_configuration")) {
        state.row = {
          ...state.row,
          algorithm: params[0],
          authentication_tag: params[2],
          encrypted_payload: params[3],
          initialization_vector: params[1],
          revision: Number(state.row.revision) + 1,
          updated_at: new Date("2026-08-13T09:00:00.000Z"),
          updated_by: params[4]
        };
        return { rows: [state.row] };
      }
      if (sql.includes("UPDATE visualization_provider_configs")) {
        const changed = state.structuredRoute.endpoint !== params[0] ||
          state.structuredRoute.model !== params[1] ||
          state.structuredRoute.providerId !== "deepseek" ||
          state.structuredRoute.secretRef !== "viz-secret:platform-deepseek";
        if (changed) {
          state.structuredRoute = {
            endpoint: params[0],
            model: params[1],
            providerId: "deepseek",
            revision: state.structuredRoute.revision + 1,
            secretRef: "viz-secret:platform-deepseek",
            updatedBy: params[2]
          };
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO audit_events")) {
        state.auditDetails.push(params[4]);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO idempotency_records")) {
        state.idempotency.set(params[1], { request_hash: params[2], response_body: JSON.parse(params[3]) });
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

function legacyEncryptedRow(key, payload) {
  const initializationVector = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  cipher.setAAD(Buffer.from("liteasy:platform-ai-provider-configuration:v1", "utf8"));
  const encryptedPayload = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  return {
    algorithm: "aes-256-gcm-v1",
    authentication_tag: cipher.getAuthTag(),
    configuration_id: "active",
    encrypted_payload: encryptedPayload,
    initialization_vector: initializationVector,
    revision: 1,
    updated_at: new Date("2026-08-13T08:00:00.000Z"),
    updated_by: "admin-1"
  };
}

test("encrypts provider credentials and returns only non-secret provider metadata", async () => {
  const pool = fakePool();
  const reconfigured = { mineru: null, providers: null };
  const service = new AiProviderConfigurationService({
    encryptionKey: Buffer.alloc(32, 5),
    environment: "staging",
    fallbackConfig: { mineru: { timeoutMs: 600_000 }, models: { timeoutMs: 300_000 } },
    mineruPdfService: { reconfigure(config) { reconfigured.mineru = config; } },
    modelProxyService: { reconfigure(providers) { reconfigured.providers = providers; } },
    pool
  });
  const secrets = {
    mineruToken: "mineru-token-private",
    textApiKey: "deepseek-api-key-private",
    textBaseUrl: "https://api.deepseek.com",
    textModel: "deepseek-v4-flash",
    textProvider: "deepseek",
    visionApiKey: "vision-api-key-private",
    visionBaseUrl: "https://models.example/v1",
    visionModel: "vision-model-private"
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
    textBaseUrl: "https://api.deepseek.com",
    textModel: "deepseek-v4-flash",
    textProvider: "deepseek",
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
  assert.equal(reconfigured.providers.deepseek.model, secrets.textModel);
  assert.equal(reconfigured.mineru.model.model, secrets.visionModel);
  assert.deepEqual(await service.status({ roles: ["platform_admin"] }), response.configuration);
  assert.deepEqual(pool.state.structuredRoute, {
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    providerId: "deepseek",
    revision: 2,
    secretRef: "viz-secret:platform-deepseek",
    updatedBy: "admin-1"
  });
});

test("loads encrypted configuration after restart without exposing it in status", async () => {
  const pool = fakePool();
  const firstModel = { reconfigure() {} };
  const firstMineru = { reconfigure() {} };
  const input = {
    expectedRevision: 0,
    idempotencyKey: "configure-ai-0002",
    mineruToken: "mineru-token-private",
    reason: "Enable staging AI providers",
    textApiKey: "deepseek-api-key-private",
    textBaseUrl: "https://api.deepseek.com",
    textModel: "deepseek-v4-flash",
    textProvider: "deepseek",
    traceId: "trace-2",
    visionApiKey: "vision-api-key-private",
    visionBaseUrl: "https://models.example/v1",
    visionModel: "vision-model-private"
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

test("switches text generation to DeepSeek while preserving legacy vision and MinerU credentials", async () => {
  const pool = fakePool();
  const encryptionKey = Buffer.alloc(32, 7);
  pool.state.row = legacyEncryptedRow(encryptionKey, {
    apiKey: "existing-vision-api-key",
    baseUrl: "https://vip.auto-code.example/v1",
    mineruToken: "existing-mineru-token",
    model: "gpt-5.6-sol"
  });
  const reconfigured = { mineru: null, providers: null, secrets: new Map() };
  const service = new AiProviderConfigurationService({
    encryptionKey,
    environment: "staging",
    fallbackConfig: { mineru: {}, models: {} },
    mineruPdfService: { reconfigure(config) { reconfigured.mineru = config; } },
    modelProxyService: { reconfigure(providers) { reconfigured.providers = providers; } },
    pool,
    visualizationSecretStore: { set(reference, secret) { reconfigured.secrets.set(reference, secret); } }
  });
  await service.initialize();
  assert.equal(reconfigured.secrets.has("viz-secret:platform-deepseek"), false);

  const result = await service.save({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    expectedRevision: 1,
    idempotencyKey: "configure-ai-deepseek",
    mineruToken: "",
    reason: "Move text generation to DeepSeek",
    textApiKey: "new-deepseek-api-key",
    textBaseUrl: "https://api.deepseek.com",
    textModel: "deepseek-v4-flash",
    textProvider: "deepseek",
    traceId: "trace-deepseek",
    visionApiKey: "",
    visionBaseUrl: "",
    visionModel: ""
  });

  assert.equal(result.configuration.revision, 2);
  assert.equal(reconfigured.providers.deepseek.model, "deepseek-v4-flash");
  assert.equal(reconfigured.providers.openai, undefined);
  assert.equal(reconfigured.mineru.model.model, "gpt-5.6-sol");
  assert.equal(reconfigured.mineru.model.baseUrl, "https://vip.auto-code.example/v1");
  assert.equal(reconfigured.mineru.token, "existing-mineru-token");
  assert.equal(reconfigured.secrets.get("viz-secret:platform-deepseek"), "new-deepseek-api-key");
  assert.equal(reconfigured.secrets.get("viz-secret:platform-openai"), "existing-vision-api-key");
});

test("accepts administrator-selected models and only deployment-allowed text endpoints", async () => {
  const service = new AiProviderConfigurationService({
    encryptionKey: Buffer.alloc(32, 8),
    environment: "staging",
    fallbackConfig: { mineru: {}, models: {} },
    mineruPdfService: { reconfigure() {} },
    modelProxyService: { reconfigure() {} },
    pool: fakePool()
  });
  await assert.rejects(() => service.save({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    expectedRevision: 0,
    idempotencyKey: "configure-ai-deepseek",
    mineruToken: "existing-mineru-token",
    reason: "Reject a non-official DeepSeek endpoint",
    textApiKey: "new-deepseek-api-key",
    textBaseUrl: "https://deepseek-compatible.example/v1",
    textModel: "deepseek-v4-flash",
    textProvider: "deepseek",
    traceId: "trace-deepseek",
    visionApiKey: "existing-vision-api-key",
    visionBaseUrl: "https://vip.auto-code.example/v1",
    visionModel: "gpt-5.6-sol"
  }), { message: "ai_provider_text_base_url_invalid" });
  const configured = await service.save({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    expectedRevision: 0,
    idempotencyKey: "configure-ai-model",
    mineruToken: "existing-mineru-token",
    reason: "Select the current DeepSeek model",
    textApiKey: "new-deepseek-api-key",
    textBaseUrl: "https://api.deepseek.com",
    textModel: "deepseek-v4-pro",
    textProvider: "deepseek",
    traceId: "trace-deepseek-model",
    visionApiKey: "existing-vision-api-key",
    visionBaseUrl: "https://vip.auto-code.example/v1",
    visionModel: "gpt-5.6-sol"
  });
  assert.equal(configured.configuration.textModel, "deepseek-v4-pro");
  assert.equal(configured.configuration.textBaseUrl, "https://api.deepseek.com");
  await assert.rejects(() => service.save({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    apiKey: "legacy-model-key",
    baseUrl: "https://models.example/v1",
    expectedRevision: 0,
    idempotencyKey: "configure-ai-legacy",
    mineruToken: "existing-mineru-token",
    model: "legacy-model",
    reason: "Reject the retired write contract",
    traceId: "trace-legacy"
  }), { message: "ai_provider_configuration_invalid" });
});

test("preserves the text API key while changing an allowlisted endpoint and model", async () => {
  const pool = fakePool();
  const reconfigured = { providers: null };
  const service = new AiProviderConfigurationService({
    encryptionKey: Buffer.alloc(32, 6),
    environment: "staging",
    fallbackConfig: {
      mineru: {},
      models: {},
      platform: { textProviderEgressHostnames: ["api.deepseek.com", "deepseek-gateway.example"] }
    },
    mineruPdfService: { reconfigure() {} },
    modelProxyService: { reconfigure(providers) { reconfigured.providers = providers; } },
    pool
  });
  const common = {
    mineruToken: "existing-mineru-token",
    textProvider: "deepseek",
    visionApiKey: "existing-vision-api-key",
    visionBaseUrl: "https://vision.example/v1",
    visionModel: "gpt-5.6-sol"
  };
  await service.save({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    ...common,
    expectedRevision: 0,
    idempotencyKey: "configure-custom-0001",
    reason: "Initialize the text provider",
    textApiKey: "existing-deepseek-api-key",
    textBaseUrl: "https://api.deepseek.com",
    textModel: "deepseek-v4-flash",
    traceId: "trace-custom-1"
  });
  const changed = await service.save({ roles: ["platform_admin"], subjectId: "admin-1" }, {
    ...common,
    expectedRevision: 1,
    idempotencyKey: "configure-custom-0002",
    reason: "Switch the allowlisted text deployment",
    textApiKey: "",
    textBaseUrl: "https://deepseek-gateway.example/v1",
    textModel: "deepseek-v4-pro",
    traceId: "trace-custom-2",
    visionApiKey: "",
    visionBaseUrl: "",
    visionModel: "",
    mineruToken: ""
  });
  assert.equal(changed.configuration.textBaseUrl, "https://deepseek-gateway.example/v1");
  assert.equal(changed.configuration.textModel, "deepseek-v4-pro");
  assert.equal(reconfigured.providers.deepseek.model, "deepseek-v4-pro");
  assert.equal(pool.state.structuredRoute.endpoint, "https://deepseek-gateway.example/v1/chat/completions");
  assert.equal(pool.state.structuredRoute.model, "deepseek-v4-pro");
});
