const environments = new Set(["production", "staging", "test"]);

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`identity_management_config_missing: ${name}`);
  return value;
}

function endpoint(env, name, environment) {
  const value = required(env, name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`identity_management_config_invalid: ${name}`);
  }
  const loopback = new Set(["127.0.0.1", "::1", "localhost", "keycloak"]).has(parsed.hostname);
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`identity_management_config_invalid: ${name}`);
  }
  if (environment !== "test" && parsed.protocol !== "https:") {
    throw new Error(`identity_management_config_invalid: ${name} must use HTTPS`);
  }
  if (environment === "test" && parsed.protocol !== "https:" && !loopback) {
    throw new Error(`identity_management_config_invalid: ${name} test HTTP endpoint must be loopback-local`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function clientId(env, name) {
  const value = required(env, name);
  if (!/^[A-Za-z0-9._~-]{1,200}$/.test(value)) {
    throw new Error(`identity_management_config_invalid: ${name}`);
  }
  return value;
}

function secret(env, name) {
  const value = required(env, name);
  if (value.length < 16 || value.length > 4096) {
    throw new Error(`identity_management_config_invalid: ${name}`);
  }
  return value;
}

export function loadIdentityManagementConfig(env = process.env) {
  const environment = (env.NODE_ENV ?? "").trim().toLowerCase();
  if (!environments.has(environment)) {
    throw new Error("identity_management_config_invalid: NODE_ENV");
  }
  const port = Number(env.IDENTITY_MANAGEMENT_PORT ?? "9090");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("identity_management_config_invalid: IDENTITY_MANAGEMENT_PORT");
  }
  const callerClientId = clientId(env, "IDENTITY_MANAGEMENT_CALLER_CLIENT_ID");
  const introspectionClientId = clientId(env, "IDENTITY_MANAGEMENT_INTROSPECTION_CLIENT_ID");
  const adminClientId = clientId(env, "IDENTITY_MANAGEMENT_ADMIN_CLIENT_ID");
  if (new Set([callerClientId, introspectionClientId, adminClientId]).size !== 3) {
    throw new Error("identity_management_config_invalid: caller, introspection, and admin clients must be distinct");
  }
  const issuer = endpoint(env, "IDENTITY_MANAGEMENT_ISSUER", environment);
  return Object.freeze({
    admin: Object.freeze({
      apiUrl: endpoint(env, "IDENTITY_MANAGEMENT_ADMIN_API_URL", environment),
      clientId: adminClientId,
      clientSecret: secret(env, "IDENTITY_MANAGEMENT_ADMIN_CLIENT_SECRET"),
      tokenUrl: endpoint(env, "IDENTITY_MANAGEMENT_ADMIN_TOKEN_URL", environment)
    }),
    authorization: Object.freeze({
      audience: clientId(env, "IDENTITY_MANAGEMENT_AUDIENCE"),
      callerClientId,
      issuer,
      verifier: Object.freeze({
        clientId: introspectionClientId,
        clientSecret: secret(env, "IDENTITY_MANAGEMENT_INTROSPECTION_CLIENT_SECRET"),
        url: endpoint(env, "IDENTITY_MANAGEMENT_INTROSPECTION_URL", environment)
      })
    }),
    environment,
    host: env.IDENTITY_MANAGEMENT_HOST?.trim() || "127.0.0.1",
    issuer,
    port
  });
}
