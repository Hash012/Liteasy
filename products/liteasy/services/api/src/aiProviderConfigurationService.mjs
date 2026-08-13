import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createModelUpstreamProviders } from "./modelUpstreamProviders.mjs";
import { PlatformAdminError } from "./platformAdminRepository.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

const algorithm = "aes-256-gcm-v1";
const aad = Buffer.from("liteasy:platform-ai-provider-configuration:v1", "utf8");
const allowedFields = new Set([
  "apiKey", "baseUrl", "expectedRevision", "idempotencyKey", "mineruToken",
  "model", "reason", "traceId"
]);

function requirePlatformAdmin(principal) {
  if (!principal?.roles?.includes("platform_admin")) {
    throw new PlatformAdminError("platform_admin_required", 403);
  }
}

function requiredText(value, minimum, maximum, code) {
  if (typeof value !== "string") throw new PlatformAdminError(code);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum || normalized.includes("\u0000")) {
    throw new PlatformAdminError(code);
  }
  return normalized;
}

function validateEndpoint(value, environment) {
  const normalized = requiredText(value, 8, 2048, "ai_provider_base_url_invalid");
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new PlatformAdminError("ai_provider_base_url_invalid");
  }
  const testLoopback = environment === "test" && parsed.protocol === "http:" &&
    new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname.toLowerCase());
  if ((!testLoopback && parsed.protocol !== "https:") || parsed.username || parsed.password ||
    parsed.search || parsed.hash) {
    throw new PlatformAdminError("ai_provider_base_url_invalid");
  }
  return parsed.toString().replace(/\/$/, "");
}

function validateInput(input, environment) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new PlatformAdminError("ai_provider_configuration_invalid");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new PlatformAdminError("ai_provider_configuration_revision_invalid");
  }
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 200, "idempotency_key_invalid");
  if (!/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) throw new PlatformAdminError("idempotency_key_invalid");
  const model = requiredText(input.model, 1, 200, "ai_provider_model_invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) {
    throw new PlatformAdminError("ai_provider_model_invalid");
  }
  return {
    apiKey: requiredText(input.apiKey, 8, 4096, "ai_provider_api_key_invalid"),
    baseUrl: validateEndpoint(input.baseUrl, environment),
    expectedRevision: input.expectedRevision,
    idempotencyKey,
    mineruToken: requiredText(input.mineruToken, 8, 4096, "ai_provider_mineru_token_invalid"),
    model,
    reason: requiredText(input.reason, 8, 1000, "admin_reason_invalid"),
    traceId: requiredText(input.traceId, 1, 300, "trace_id_invalid")
  };
}

function encrypt(payload, key) {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  cipher.setAAD(aad);
  const encryptedPayload = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  return {
    authenticationTag: cipher.getAuthTag(),
    encryptedPayload,
    initializationVector
  };
}

function decrypt(row, key) {
  if (row.algorithm !== algorithm) throw new Error("ai_provider_configuration_algorithm_unsupported");
  const decipher = createDecipheriv("aes-256-gcm", key, row.initialization_vector);
  decipher.setAAD(aad);
  decipher.setAuthTag(row.authentication_tag);
  const plaintext = Buffer.concat([
    decipher.update(row.encrypted_payload),
    decipher.final()
  ]).toString("utf8");
  const payload = JSON.parse(plaintext);
  return validateInput({
    ...payload,
    expectedRevision: 0,
    idempotencyKey: "decrypted-config",
    reason: "decrypt stored provider configuration",
    traceId: "stored-configuration"
  }, "production");
}

function publicStatus(row, writable) {
  return {
    configured: Boolean(row),
    mineruConfigured: Boolean(row),
    modelProviderConfigured: Boolean(row),
    revision: row ? Number(row.revision) : 0,
    updatedAt: row?.updated_at?.toISOString() ?? null,
    updatedBy: row?.updated_by ?? null,
    writable
  };
}

async function appendAudit(client, input) {
  await client.query(`
    INSERT INTO audit_events(
      audit_id, actor_id, actor_audience, action, resource_type, resource_id,
      reason, trace_id, detail
    ) VALUES ($1, $2, 'liteasy-admin', 'ai_provider_configuration_updated',
      'ai_provider_configuration', 'active', $3, $4, $5::jsonb)
  `, [
    `audit_${randomUUID()}`,
    input.actorId,
    input.reason,
    input.traceId,
    JSON.stringify({ previousRevision: input.previousRevision, revision: input.revision })
  ]);
}

export function parseAiProviderEncryptionKey(value) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("cloud_config_invalid: LITEASY_PLATFORM_CONFIG_ENCRYPTION_KEY must be a Base64 32-byte key");
  }
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) {
    throw new Error("cloud_config_invalid: LITEASY_PLATFORM_CONFIG_ENCRYPTION_KEY must be a Base64 32-byte key");
  }
  return key;
}

export class AiProviderConfigurationService {
  constructor({
    encryptionKey,
    environment,
    fallbackConfig,
    fetchImpl,
    mineruPdfService,
    modelProxyService,
    pool,
    visualizationSecretStore
  }) {
    this.encryptionKey = encryptionKey;
    this.environment = environment;
    this.fallbackConfig = fallbackConfig;
    this.fetchImpl = fetchImpl;
    this.mineruPdfService = mineruPdfService;
    this.modelProxyService = modelProxyService;
    this.pool = pool;
    this.visualizationSecretStore = visualizationSecretStore;
  }

  async #row(client = this.pool) {
    const result = await client.query(`
      SELECT * FROM platform_ai_provider_configuration WHERE configuration_id = 'active'
    `);
    return result.rows.find((row) => row.configuration_id === "active");
  }

  #apply(payload) {
    const models = {
      providers: {
        openai: {
          apiKey: payload.apiKey,
          baseUrl: payload.baseUrl,
          model: payload.model,
          provider: "openai"
        }
      },
      timeoutMs: this.fallbackConfig.models?.timeoutMs ?? 60_000
    };
    this.modelProxyService.reconfigure(createModelUpstreamProviders(models, { fetchImpl: this.fetchImpl }));
    this.mineruPdfService.reconfigure({
      ...this.fallbackConfig.mineru,
      model: models.providers.openai,
      modelFetch: this.fetchImpl,
      token: payload.mineruToken
    });
    this.visualizationSecretStore?.set("viz-secret:platform-openai", payload.apiKey);
  }

  async initialize() {
    const row = await this.#row();
    if (row) {
      if (!this.encryptionKey) throw new Error("ai_provider_configuration_encryption_key_missing");
      this.#apply(decrypt(row, this.encryptionKey));
      return publicStatus(row, true);
    }
    return publicStatus(undefined, Boolean(this.encryptionKey));
  }

  async status(principal) {
    requirePlatformAdmin(principal);
    return publicStatus(await this.#row(), Boolean(this.encryptionKey));
  }

  async save(principal, rawInput) {
    requirePlatformAdmin(principal);
    if (!this.encryptionKey) throw new PlatformAdminError("ai_provider_configuration_write_unavailable", 503);
    const input = validateInput(rawInput, this.environment);
    const secretPayload = {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      mineruToken: input.mineruToken,
      model: input.model
    };
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ ...secretPayload, expectedRevision: input.expectedRevision, reason: input.reason }))
      .digest("hex");
    const result = await withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${principal.subjectId}:set_ai_provider_configuration:${input.idempotencyKey}`
      ]);
      const prior = await client.query(`
        SELECT request_hash, response_body FROM idempotency_records
         WHERE actor_id = $1 AND operation = 'set_ai_provider_configuration'
           AND idempotency_key = $2 AND expires_at > now()
      `, [principal.subjectId, input.idempotencyKey]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash) {
          throw new PlatformAdminError("idempotency_key_reused", 409);
        }
        return prior.rows[0].response_body;
      }
      const currentResult = await client.query(`
        SELECT * FROM platform_ai_provider_configuration
         WHERE configuration_id = 'active' FOR UPDATE
      `);
      const current = currentResult.rows[0];
      const currentRevision = current ? Number(current.revision) : 0;
      if (currentRevision !== input.expectedRevision) {
        throw new PlatformAdminError("ai_provider_configuration_revision_conflict", 409);
      }
      const encrypted = encrypt(secretPayload, this.encryptionKey);
      const changed = current
        ? await client.query(`
            UPDATE platform_ai_provider_configuration
               SET algorithm = $1, initialization_vector = $2, authentication_tag = $3,
                   encrypted_payload = $4, revision = revision + 1,
                   updated_by = $5, updated_at = now()
             WHERE configuration_id = 'active' AND revision = $6
             RETURNING *
          `, [algorithm, encrypted.initializationVector, encrypted.authenticationTag,
            encrypted.encryptedPayload, principal.subjectId, currentRevision])
        : await client.query(`
            INSERT INTO platform_ai_provider_configuration(
              configuration_id, algorithm, initialization_vector, authentication_tag,
              encrypted_payload, revision, updated_by
            ) VALUES ('active', $1, $2, $3, $4, 1, $5)
            RETURNING *
          `, [algorithm, encrypted.initializationVector, encrypted.authenticationTag,
            encrypted.encryptedPayload, principal.subjectId]);
      if (!changed.rows[0]) throw new PlatformAdminError("ai_provider_configuration_revision_conflict", 409);
      const status = publicStatus(changed.rows[0], true);
      await appendAudit(client, {
        actorId: principal.subjectId,
        previousRevision: currentRevision,
        reason: input.reason,
        revision: status.revision,
        traceId: input.traceId
      });
      const response = { configuration: status };
      await client.query(`
        INSERT INTO idempotency_records(
          actor_id, operation, idempotency_key, request_hash, response_status,
          response_body, expires_at
        ) VALUES ($1, 'set_ai_provider_configuration', $2, $3, 200, $4::jsonb, now() + interval '24 hours')
      `, [principal.subjectId, input.idempotencyKey, requestHash, JSON.stringify(response)]);
      return response;
    });
    this.#apply(secretPayload);
    return result;
  }
}
