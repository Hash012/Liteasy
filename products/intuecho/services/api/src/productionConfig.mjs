const allowedEnvironments = new Set(["production", "staging", "test"]);
const allowedSslModes = new Set(["require", "verify-ca", "verify-full"]);

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`intuecho_config_missing: ${name} is required`);
  return value;
}

function environmentName(env) {
  const value = (env.NODE_ENV ?? "").trim().toLowerCase();
  if (!allowedEnvironments.has(value)) {
    throw new Error("intuecho_config_invalid: NODE_ENV must be production, staging, or test");
  }
  return value;
}

function parsePort(value) {
  const port = Number(value ?? "4040");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("intuecho_config_invalid: INTUECHO_API_PORT must be a valid TCP port");
  }
  return port;
}

function parseUrl(value, name, environment, { database = false } = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`intuecho_config_invalid: ${name} must be a valid URL`);
  }
  if (database) {
    if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol) || !parsed.hostname || parsed.pathname === "/") {
      throw new Error(`intuecho_config_invalid: ${name} must be a PostgreSQL URL with a database name`);
    }
  } else if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error(`intuecho_config_invalid: ${name} must use HTTP or HTTPS`);
  }
  if (environment !== "test") {
    if (!database && parsed.protocol !== "https:") {
      throw new Error(`intuecho_config_invalid: ${name} must use HTTPS`);
    }
    if (new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) {
      throw new Error(`intuecho_config_invalid: ${name} cannot use loopback outside tests`);
    }
  }
  return database ? value : parsed.toString().replace(/\/$/, "");
}

function parseOrigins(value, environment) {
  const origins = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (origins.length === 0 || origins.includes("*")) {
    throw new Error("intuecho_config_invalid: INTUECHO_ALLOWED_ORIGINS cannot use a wildcard");
  }
  return origins.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("intuecho_config_invalid: INTUECHO_ALLOWED_ORIGINS must be a valid URL");
    }
    const tauriOrigin = parsed.origin === "http://tauri.localhost";
    if (!tauriOrigin) {
      parsed = new URL(parseUrl(origin, "INTUECHO_ALLOWED_ORIGINS", environment));
    }
    if (parsed.origin !== origin) {
      throw new Error("intuecho_config_invalid: INTUECHO_ALLOWED_ORIGINS must contain origins only");
    }
    return origin;
  });
}

function parseOfficialPmlrEndpoint(value, environment) {
  const endpoint = parseUrl(value, "INTUECHO_PMLR_ENDPOINT", environment);
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.hostname !== "proceedings.mlr.press" ||
    parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("intuecho_config_invalid: INTUECHO_PMLR_ENDPOINT must use the official PMLR origin");
  }
  return parsed.origin;
}

function databaseConfig(env, environment, name = "INTUECHO_DATABASE_URL") {
  const sslMode = required(env, "INTUECHO_DATABASE_SSL_MODE").toLowerCase();
  if (!allowedSslModes.has(sslMode)) {
    throw new Error("intuecho_config_invalid: INTUECHO_DATABASE_SSL_MODE must require TLS");
  }
  return Object.freeze({
    connectionString: parseUrl(required(env, name), name, environment, { database: true }),
    sslMode
  });
}

function clientId(env, name) {
  const value = required(env, name);
  if (!/^[A-Za-z0-9._~-]{1,200}$/.test(value)) {
    throw new Error(`intuecho_config_invalid: ${name} is invalid`);
  }
  return value;
}

export function loadIntuechoProductionConfig(env = process.env) {
  const environment = environmentName(env);
  const apiClientId = clientId(env, "INTUECHO_IDP_CLIENT_ID");
  const webClientId = clientId(env, "INTUECHO_IDP_WEB_CLIENT_ID");
  const organizationServiceClientId = clientId(env, "INTUECHO_ORGANIZATION_SERVICE_CLIENT_ID");
  const liteasyLiteratureServiceClientId = clientId(env, "INTUECHO_LITEASY_LITERATURE_SERVICE_CLIENT_ID");
  if (apiClientId === webClientId) {
    throw new Error("intuecho_config_invalid: API and public Web identity clients must be distinct");
  }
  if (new Set([apiClientId, webClientId]).has(organizationServiceClientId)) {
    throw new Error("intuecho_config_invalid: organization service identity client must be distinct");
  }
  if (new Set([apiClientId, webClientId, organizationServiceClientId]).has(liteasyLiteratureServiceClientId)) {
    throw new Error("intuecho_config_invalid: literature projection service identity client must be distinct");
  }
  return Object.freeze({
    adminApiUrl: parseUrl(required(env, "INTUECHO_ADMIN_API_URL"), "INTUECHO_ADMIN_API_URL", environment),
    allowedOrigins: Object.freeze(parseOrigins(required(env, "INTUECHO_ALLOWED_ORIGINS"), environment)),
    database: databaseConfig(env, environment),
    environment,
    host: env.INTUECHO_API_HOST?.trim() || "127.0.0.1",
    identity: Object.freeze({
      clientId: apiClientId,
      clientSecret: required(env, "INTUECHO_IDP_CLIENT_SECRET"),
      discoveryUrl: parseUrl(required(env, "INTUECHO_IDP_DISCOVERY_URL"), "INTUECHO_IDP_DISCOVERY_URL", environment),
      introspectionUrl: parseUrl(required(env, "INTUECHO_IDP_INTROSPECTION_URL"), "INTUECHO_IDP_INTROSPECTION_URL", environment),
      issuer: parseUrl(required(env, "INTUECHO_IDP_ISSUER"), "INTUECHO_IDP_ISSUER", environment),
      jwksUrl: parseUrl(required(env, "INTUECHO_IDP_JWKS_URL"), "INTUECHO_IDP_JWKS_URL", environment),
      tokenUrl: parseUrl(required(env, "INTUECHO_IDP_TOKEN_URL"), "INTUECHO_IDP_TOKEN_URL", environment),
      webClientId
    }),
    literatureProviders: Object.freeze({
      arxivEndpoint: parseUrl(env.INTUECHO_ARXIV_ENDPOINT ?? "https://export.arxiv.org/api/query", "INTUECHO_ARXIV_ENDPOINT", environment),
      crossrefEndpoint: parseUrl(env.INTUECHO_CROSSREF_ENDPOINT ?? "https://api.crossref.org/works", "INTUECHO_CROSSREF_ENDPOINT", environment),
      dblpRecordEndpoint: parseUrl(env.INTUECHO_DBLP_RECORD_ENDPOINT ?? "https://dblp.org/rec", "INTUECHO_DBLP_RECORD_ENDPOINT", environment),
      dblpSearchEndpoint: parseUrl(env.INTUECHO_DBLP_SEARCH_ENDPOINT ?? "https://dblp.org/search/publ/api", "INTUECHO_DBLP_SEARCH_ENDPOINT", environment),
      openAlexApiKey: env.INTUECHO_OPENALEX_API_KEY?.trim() || null,
      openAlexEndpoint: parseUrl(env.INTUECHO_OPENALEX_ENDPOINT ?? "https://api.openalex.org/works", "INTUECHO_OPENALEX_ENDPOINT", environment),
      openReviewEndpoint: parseUrl(env.INTUECHO_OPENREVIEW_ENDPOINT ?? "https://api2.openreview.net/notes", "INTUECHO_OPENREVIEW_ENDPOINT", environment),
      openReviewSearchEndpoint: parseUrl(env.INTUECHO_OPENREVIEW_SEARCH_ENDPOINT ?? "https://api2.openreview.net/notes/search", "INTUECHO_OPENREVIEW_SEARCH_ENDPOINT", environment),
      pmlrEndpoint: parseOfficialPmlrEndpoint(env.INTUECHO_PMLR_ENDPOINT ?? "https://proceedings.mlr.press", environment),
      semanticScholarApiKey: env.INTUECHO_SEMANTIC_SCHOLAR_API_KEY?.trim() || null,
      semanticScholarEndpoint: parseUrl(env.INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT ?? "https://api.semanticscholar.org/graph/v1/paper", "INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT", environment)
    }),
    literatureProjection: Object.freeze({
      audience: "intuecho-internal",
      clientId: liteasyLiteratureServiceClientId
    }),
    organizationAuthorization: Object.freeze({
      apiUrl: parseUrl(required(env, "INTUECHO_ORGANIZATION_API_URL"), "INTUECHO_ORGANIZATION_API_URL", environment),
      audience: "liteasy-internal",
      clientId: organizationServiceClientId,
      clientSecret: required(env, "INTUECHO_ORGANIZATION_SERVICE_CLIENT_SECRET"),
      scope: "organization:authorize",
      tokenUrl: parseUrl(required(env, "INTUECHO_IDP_TOKEN_URL"), "INTUECHO_IDP_TOKEN_URL", environment)
    }),
    port: parsePort(env.INTUECHO_API_PORT)
  });
}

export function loadIntuechoMigrationConfig(env = process.env) {
  const environment = environmentName(env);
  const application = databaseConfig(env, environment);
  const migration = databaseConfig(env, environment, "INTUECHO_MIGRATION_DATABASE_URL");
  const applicationRole = new URL(application.connectionString).username;
  const migrationRole = new URL(migration.connectionString).username;
  if (
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(applicationRole) ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(migrationRole) ||
    applicationRole === migrationRole
  ) {
    throw new Error("intuecho_config_invalid: migration and application database roles must be distinct identifiers");
  }
  return Object.freeze({ applicationRole, ...migration });
}

export function publicIntuechoIdentityConfig(config) {
  return Object.freeze({
    audience: "intuecho-web",
    authorizationFlow: "authorization_code_pkce",
    clientId: config.identity.webClientId,
    issuer: config.identity.issuer
  });
}
