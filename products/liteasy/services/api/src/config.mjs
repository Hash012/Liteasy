import { parseVisualizationSecrets } from "./visualizationSecretStore.mjs";

const allowedEnvironments = new Set(["production", "staging", "test"]);
const allowedSslModes = new Set(["require", "verify-ca", "verify-full"]);

function parseVisualizationEgressHostnames(value) {
  if (value === undefined || value === "") return Object.freeze([]);
  const hostnames = [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))].sort();
  if (hostnames.some((hostname) => !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(hostname))) {
    throw new Error("cloud_config_invalid: LITEASY_VISUALIZATION_EGRESS_HOSTNAMES contains an invalid hostname");
  }
  return Object.freeze(hostnames);
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`cloud_config_missing: ${name} is required`);
  return value;
}

function parsePort(value) {
  const port = Number(value ?? "8787");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("cloud_config_invalid: LITEASY_CLOUD_PORT must be a valid TCP port");
  }
  return port;
}

function parsePositiveInteger(value, name, fallback, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`cloud_config_invalid: ${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function requireEmail(env, name) {
  const value = required(env, name).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
    throw new Error(`cloud_config_invalid: ${name} must be a valid contact email`);
  }
  return value;
}

function optionalSecret(value, name) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 4096) {
    throw new Error(`cloud_config_invalid: ${name} is invalid`);
  }
  return value.trim();
}

function requireDeploymentSecret(env, name) {
  const value = required(env, name);
  if (value.length < 16 || value.length > 4096) {
    throw new Error(`cloud_config_invalid: ${name} must contain 16 to 4096 characters`);
  }
  return value;
}

function parseBoolean(value, name, fallback = false) {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`cloud_config_invalid: ${name} must be true or false`);
}

function parseAllowedOrigins(value, environment) {
  if (!value?.trim()) throw new Error("cloud_config_missing: LITEASY_ALLOWED_ORIGINS is required");
  const origins = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (origins.length === 0 || origins.includes("*")) {
    throw new Error("cloud_config_invalid: LITEASY_ALLOWED_ORIGINS cannot use a wildcard");
  }
  return origins.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("cloud_config_invalid: LITEASY_ALLOWED_ORIGINS contains an invalid URL");
    }
    const tauriOrigin = parsed.protocol === "http:" && parsed.hostname === "tauri.localhost";
    const testLoopback = environment === "test" && parsed.protocol === "http:" &&
      new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname);
    if (parsed.origin !== origin || (!tauriOrigin && !testLoopback && parsed.protocol !== "https:")) {
      throw new Error("cloud_config_invalid: allowed origins must be HTTPS or the Tauri local origin");
    }
    return parsed.origin;
  });
}

function validateDatabaseUrl(value, environment) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("cloud_config_invalid: DATABASE_URL must be a PostgreSQL URL");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("cloud_config_invalid: DATABASE_URL must use PostgreSQL");
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") {
    throw new Error("cloud_config_invalid: DATABASE_URL must include a host and database name");
  }
  if (environment !== "test" && new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) {
    throw new Error("cloud_config_invalid: production and staging DATABASE_URL cannot use loopback");
  }
  return value;
}

function validateEndpoint(value, environment) {
  if (!value) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("cloud_config_invalid: LITEASY_S3_ENDPOINT must be a URL");
  }
  if (environment !== "test" && parsed.protocol !== "https:") {
    throw new Error("cloud_config_invalid: production and staging S3 endpoints must use HTTPS");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("cloud_config_invalid: LITEASY_S3_ENDPOINT must use HTTP or HTTPS");
  }
  return parsed.toString().replace(/\/$/, "");
}

function requireHttpUrl(env, name, environment) {
  const value = required(env, name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`cloud_config_invalid: ${name} must be a URL`);
  }
  if (environment !== "test" && parsed.protocol !== "https:") {
    throw new Error(`cloud_config_invalid: ${name} must use HTTPS`);
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error(`cloud_config_invalid: ${name} must use HTTP or HTTPS`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function requireServiceEndpoint(env, name, environment) {
  const value = requireHttpUrl(env, name, environment);
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`cloud_config_invalid: ${name} cannot contain credentials, query, or fragment`);
  }
  return value;
}

function optionalModelProvider(env, provider, environment) {
  const prefix = `LITEASY_MODEL_${provider.toUpperCase()}`;
  const names = {
    apiKey: `${prefix}_API_KEY`,
    baseUrl: `${prefix}_BASE_URL`,
    model: `${prefix}_MODEL`
  };
  const configured = Object.values(names).some((name) => Boolean(env[name]?.trim()));
  if (!configured) return undefined;

  const baseUrl = requireHttpUrl(env, names.baseUrl, environment);
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`cloud_config_invalid: ${names.baseUrl} cannot contain credentials, query, or fragment`);
  }
  const model = required(env, names.model);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) {
    throw new Error(`cloud_config_invalid: ${names.model} is invalid`);
  }
  return Object.freeze({
    apiKey: required(env, names.apiKey),
    baseUrl,
    model,
    provider
  });
}

function normalizePrefix(value) {
  const prefix = (value ?? "documents").trim().replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("cloud_config_invalid: LITEASY_S3_PREFIX is invalid");
  }
  return prefix;
}

function requirePublicClientId(env, name, confidentialClientId) {
  const value = required(env, name);
  if (!/^[A-Za-z0-9._~-]{1,200}$/.test(value)) {
    throw new Error(`cloud_config_invalid: ${name} is invalid`);
  }
  if (value === confidentialClientId) {
    throw new Error(`cloud_config_invalid: ${name} must be distinct from LITEASY_IDP_CLIENT_ID`);
  }
  return value;
}

function requireConfidentialClientId(env, name, disallowedIds) {
  const value = required(env, name);
  if (!/^[A-Za-z0-9._~-]{1,200}$/.test(value)) {
    throw new Error(`cloud_config_invalid: ${name} is invalid`);
  }
  if (disallowedIds.includes(value)) {
    throw new Error(`cloud_config_invalid: ${name} must use a dedicated confidential client`);
  }
  return value;
}

export function loadCloudConfig(env = process.env) {
  const environment = (env.NODE_ENV ?? "").trim().toLowerCase();
  if (!allowedEnvironments.has(environment)) {
    throw new Error("cloud_config_invalid: NODE_ENV must be production, staging, or test");
  }
  const sslMode = required(env, "LITEASY_DATABASE_SSL_MODE").toLowerCase();
  if (!allowedSslModes.has(sslMode)) {
    throw new Error("cloud_config_invalid: LITEASY_DATABASE_SSL_MODE must require TLS");
  }
  const bucket = required(env, "LITEASY_S3_BUCKET");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("cloud_config_invalid: LITEASY_S3_BUCKET is invalid");
  }

  const identityClientId = required(env, "LITEASY_IDP_CLIENT_ID");
  const desktopClientId = requirePublicClientId(
    env,
    "LITEASY_IDP_DESKTOP_CLIENT_ID",
    identityClientId
  );
  const adminClientId = requirePublicClientId(
    env,
    "LITEASY_IDP_ADMIN_CLIENT_ID",
    identityClientId
  );
  if (adminClientId === desktopClientId) {
    throw new Error("cloud_config_invalid: LITEASY_IDP_ADMIN_CLIENT_ID must be distinct from LITEASY_IDP_DESKTOP_CLIENT_ID");
  }
  const managementClientId = requireConfidentialClientId(
    env,
    "LITEASY_IDP_MANAGEMENT_CLIENT_ID",
    [identityClientId, desktopClientId, adminClientId]
  );
  const intuechoServiceClientId = requireConfidentialClientId(
    env,
    "LITEASY_IDP_INTUECHO_SERVICE_CLIENT_ID",
    [identityClientId, desktopClientId, adminClientId, managementClientId]
  );
  const modelProviders = Object.fromEntries(
    ["openai", "deepseek"].flatMap((provider) => {
      const configured = optionalModelProvider(env, provider, environment);
      return configured ? [[provider, configured]] : [];
    })
  );
  return Object.freeze({
    allowedOrigins: Object.freeze(parseAllowedOrigins(required(env, "LITEASY_ALLOWED_ORIGINS"), environment)),
    database: Object.freeze({
      connectionString: validateDatabaseUrl(required(env, "DATABASE_URL"), environment),
      sslMode
    }),
    environment,
    host: env.LITEASY_CLOUD_HOST?.trim() || "127.0.0.1",
    identity: Object.freeze({
      adminClientId,
      clientId: identityClientId,
      clientSecret: required(env, "LITEASY_IDP_CLIENT_SECRET"),
      desktopClientId,
      discoveryUrl: requireHttpUrl(env, "LITEASY_IDP_DISCOVERY_URL", environment),
      introspectionUrl: requireHttpUrl(env, "LITEASY_IDP_INTROSPECTION_URL", environment),
      intuechoServiceClientId,
      issuer: requireHttpUrl(env, "LITEASY_IDP_ISSUER", environment),
      jwksUrl: requireHttpUrl(env, "LITEASY_IDP_JWKS_URL", environment),
      managementClientId,
      managementClientSecret: required(env, "LITEASY_IDP_MANAGEMENT_CLIENT_SECRET"),
      managementUrl: requireHttpUrl(env, "LITEASY_IDP_MANAGEMENT_URL", environment),
      revocationUrl: requireHttpUrl(env, "LITEASY_IDP_REVOCATION_URL", environment),
      tokenUrl: requireHttpUrl(env, "LITEASY_IDP_TOKEN_URL", environment)
    }),
    intuecho: Object.freeze({
      adminApiUrl: requireHttpUrl(env, "LITEASY_INTUECHO_ADMIN_API_URL", environment)
    }),
    models: Object.freeze({
      providers: Object.freeze(modelProviders),
      timeoutMs: parsePositiveInteger(
        env.LITEASY_MODEL_TIMEOUT_MS,
        "LITEASY_MODEL_TIMEOUT_MS",
        60_000,
        300_000
      )
    }),
    port: parsePort(env.LITEASY_CLOUD_PORT),
    pdfSecurity: Object.freeze({
      endpoint: requireServiceEndpoint(env, "LITEASY_PDF_SCANNER_URL", environment),
      secret: requireDeploymentSecret(env, "LITEASY_PDF_SCANNER_SECRET"),
      timeoutMs: parsePositiveInteger(
        env.LITEASY_PDF_SCANNER_TIMEOUT_MS,
        "LITEASY_PDF_SCANNER_TIMEOUT_MS",
        120_000,
        300_000
      )
    }),
    recommendation: Object.freeze({
      endpoint: requireHttpUrl(
        { ...env, LITEASY_RECOMMENDATION_CROSSREF_ENDPOINT: env.LITEASY_RECOMMENDATION_CROSSREF_ENDPOINT ?? "https://api.crossref.org/works" },
        "LITEASY_RECOMMENDATION_CROSSREF_ENDPOINT",
        environment
      ),
      mailto: requireEmail(env, "LITEASY_RECOMMENDATION_CONTACT_EMAIL"),
      timeoutMs: parsePositiveInteger(
        env.LITEASY_RECOMMENDATION_TIMEOUT_MS,
        "LITEASY_RECOMMENDATION_TIMEOUT_MS",
        10_000,
        60_000
      )
    }),
    retrieval: Object.freeze({
      contactEmail: requireEmail(
        { ...env, LITEASY_RETRIEVAL_CONTACT_EMAIL: env.LITEASY_RETRIEVAL_CONTACT_EMAIL ?? env.LITEASY_RECOMMENDATION_CONTACT_EMAIL },
        "LITEASY_RETRIEVAL_CONTACT_EMAIL"
      ),
      maximumPdfBytes: parsePositiveInteger(
        env.LITEASY_RETRIEVAL_MAX_PDF_BYTES,
        "LITEASY_RETRIEVAL_MAX_PDF_BYTES",
        32 * 1024 * 1024,
        256 * 1024 * 1024
      ),
      semanticScholarApiKey: optionalSecret(
        env.LITEASY_RETRIEVAL_SEMANTIC_SCHOLAR_API_KEY,
        "LITEASY_RETRIEVAL_SEMANTIC_SCHOLAR_API_KEY"
      ),
      timeoutMs: parsePositiveInteger(
        env.LITEASY_RETRIEVAL_TIMEOUT_MS,
        "LITEASY_RETRIEVAL_TIMEOUT_MS",
        15_000,
        60_000
      )
    }),
    s3: Object.freeze({
      bucket,
      endpoint: validateEndpoint(env.LITEASY_S3_ENDPOINT?.trim(), environment),
      forcePathStyle: parseBoolean(env.LITEASY_S3_FORCE_PATH_STYLE, "LITEASY_S3_FORCE_PATH_STYLE"),
      prefix: normalizePrefix(env.LITEASY_S3_PREFIX),
      region: required(env, "LITEASY_S3_REGION")
    }),
    visualization: Object.freeze({
      egressHostnames: parseVisualizationEgressHostnames(env.LITEASY_VISUALIZATION_EGRESS_HOSTNAMES),
      secrets: parseVisualizationSecrets(env.LITEASY_VISUALIZATION_SECRETS_JSON)
    })
  });
}

export function loadMigrationDatabaseConfig(env = process.env) {
  const environment = (env.NODE_ENV ?? "").trim().toLowerCase();
  if (!allowedEnvironments.has(environment)) {
    throw new Error("cloud_config_invalid: NODE_ENV must be production, staging, or test");
  }
  const sslMode = required(env, "LITEASY_DATABASE_SSL_MODE").toLowerCase();
  if (!allowedSslModes.has(sslMode)) {
    throw new Error("cloud_config_invalid: LITEASY_DATABASE_SSL_MODE must require TLS");
  }
  const applicationConnectionString = validateDatabaseUrl(required(env, "DATABASE_URL"), environment);
  const migrationConnectionString = validateDatabaseUrl(
    required(env, "LITEASY_MIGRATION_DATABASE_URL"),
    environment
  );
  const applicationUser = new URL(applicationConnectionString).username;
  const migrationUser = new URL(migrationConnectionString).username;
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(applicationUser) || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(migrationUser)) {
    throw new Error("cloud_config_invalid: database role names must be PostgreSQL identifiers");
  }
  if (!applicationUser || !migrationUser || applicationUser === migrationUser) {
    throw new Error("cloud_config_invalid: migration and application database roles must be distinct");
  }
  return Object.freeze({
    applicationRole: applicationUser,
    connectionString: migrationConnectionString,
    sslMode
  });
}

export function publicCloudConfig(config) {
  return {
    databaseTls: config.database.sslMode,
    environment: config.environment,
    identity: "oidc+jwks+rfc7662",
    modelProxy: Object.keys(config.models?.providers ?? {}).length > 0 ? "configured" : "unavailable",
    objectStorage: "s3",
    region: config.s3.region
  };
}

export function publicDesktopIdentityConfig(config) {
  return Object.freeze({
    audience: "liteasy-desktop",
    authorizationFlow: "authorization_code_pkce",
    clientId: config.identity.desktopClientId,
    issuer: config.identity.issuer,
    revocationUrl: config.identity.revocationUrl
  });
}

export function publicAdminIdentityConfig(config) {
  return Object.freeze({
    audience: "liteasy-admin",
    authorizationFlow: "authorization_code_pkce",
    clientId: config.identity.adminClientId,
    issuer: config.identity.issuer
  });
}
