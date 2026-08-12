import { createRemoteJWKSet, jwtVerify } from "jose";

const allowedAudiences = new Set(["intuecho-internal", "intuecho-web", "liteasy-admin", "liteasy-desktop"]);

export class ProductionIdentityError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function bearerToken(header) {
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header.trim()) : null;
  if (!match) throw new ProductionIdentityError("authentication_required");
  return match[1];
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function audiences(value) {
  return typeof value === "string" ? [value] : stringArray(value);
}

async function fetchJson(url, fetchImpl, code) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new ProductionIdentityError("identity_service_unavailable", 503);
  }
  if (!response.ok) throw new ProductionIdentityError("identity_service_unavailable", 503);
  try {
    return await response.json();
  } catch {
    throw new ProductionIdentityError(code, 503);
  }
}

async function introspect(config, token, fetchImpl) {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
  let response;
  try {
    response = await fetchImpl(config.introspectionUrl, {
      body: new URLSearchParams({ token, token_type_hint: "access_token" }),
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      method: "POST",
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new ProductionIdentityError("identity_service_unavailable", 503);
  }
  if (!response.ok) throw new ProductionIdentityError("identity_service_unavailable", 503);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ProductionIdentityError("identity_service_invalid_response", 503);
  }
  if (body?.active !== true) throw new ProductionIdentityError("session_revoked");
  return body;
}

export async function verifyIntuechoIdentityReadiness(config, fetchImpl = fetch) {
  const discovery = await fetchJson(
    config.discoveryUrl,
    fetchImpl,
    "identity_discovery_invalid"
  );
  if (
    discovery.issuer !== config.issuer ||
    discovery.jwks_uri !== config.jwksUrl ||
    discovery.introspection_endpoint !== config.introspectionUrl
  ) {
    throw new ProductionIdentityError("identity_discovery_mismatch", 503);
  }
  if (!stringArray(discovery.introspection_endpoint_auth_methods_supported).includes("client_secret_basic")) {
    throw new ProductionIdentityError("identity_introspection_auth_unsupported", 503);
  }
  const safeAlgorithms = new Set(["EdDSA", "ES256", "PS256", "RS256"]);
  if (!stringArray(discovery.id_token_signing_alg_values_supported).some((item) => safeAlgorithms.has(item))) {
    throw new ProductionIdentityError("identity_signing_algorithm_unsupported", 503);
  }
  const jwks = await fetchJson(config.jwksUrl, fetchImpl, "identity_jwks_invalid");
  if (!Array.isArray(jwks.keys) || !jwks.keys.some((key) => key && typeof key.kid === "string" && key.use !== "enc")) {
    throw new ProductionIdentityError("identity_jwks_empty", 503);
  }
  return { discovery: true, jwks: true };
}

export function createProductionIdentityVerifier(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const jwks = dependencies.jwks ?? createRemoteJWKSet(new URL(config.jwksUrl));
  const verifyJwt = dependencies.verifyJwt ?? jwtVerify;
  return {
    async verifyAuthorizationHeader(header, expectedAudience) {
      if (!allowedAudiences.has(expectedAudience)) {
        throw new ProductionIdentityError("identity_audience_configuration_invalid", 500);
      }
      const token = bearerToken(header);
      let verified;
      try {
        verified = await verifyJwt(token, jwks, {
          audience: expectedAudience,
          clockTolerance: 5,
          issuer: config.issuer,
          requiredClaims: ["aud", "exp", "iat", "iss", "sub"]
        });
      } catch {
        throw new ProductionIdentityError("access_token_invalid");
      }
      const active = await introspect(config, token, fetchImpl);
      if (active.sub !== verified.payload.sub) {
        throw new ProductionIdentityError("access_token_subject_mismatch");
      }
      if (!audiences(active.aud).includes(expectedAudience)) {
        throw new ProductionIdentityError("access_token_audience_mismatch", 403);
      }
      const name = typeof verified.payload.name === "string" && verified.payload.name.trim()
        ? verified.payload.name.trim()
        : typeof active.name === "string" && active.name.trim()
          ? active.name.trim()
          : null;
      if (new Set(["intuecho-web", "liteasy-desktop"]).has(expectedAudience) && !name) {
        throw new ProductionIdentityError("identity_display_name_missing", 403);
      }
      const adminMfaVerified = verified.payload.liteasy_admin_mfa === true;
      return Object.freeze({
        adminMfaVerified,
        audience: expectedAudience,
        authTime: Number(verified.payload.auth_time),
        authenticationMethods: adminMfaVerified
          ? [...new Set([...stringArray(verified.payload.amr), "mfa"])]
          : stringArray(verified.payload.amr),
        clientId: typeof active.client_id === "string"
          ? active.client_id
          : typeof verified.payload.client_id === "string" ? verified.payload.client_id : null,
        name,
        sessionId: typeof verified.payload.sid === "string" ? verified.payload.sid : null,
        subject: verified.payload.sub,
        token
      });
    }
  };
}

export function requireFreshAdminMfa(
  identity,
  { maximumAgeSeconds = 300, nowSeconds = Date.now() / 1000 } = {}
) {
  if (identity?.audience !== "liteasy-admin") {
    throw new ProductionIdentityError("admin_audience_required", 403);
  }
  if (identity.adminMfaVerified !== true) {
    throw new ProductionIdentityError("mfa_required", 403);
  }
  if (
    !Number.isFinite(identity.authTime) ||
    identity.authTime > nowSeconds + 5 ||
    nowSeconds - identity.authTime > maximumAgeSeconds
  ) {
    throw new ProductionIdentityError("fresh_authentication_required", 403);
  }
  return identity;
}

export function initialsFor(name) {
  const characters = [...String(name ?? "").trim()].filter((character) => !/\s/u.test(character));
  return characters.slice(0, 2).join("").toLocaleUpperCase("zh-CN") || "?";
}
