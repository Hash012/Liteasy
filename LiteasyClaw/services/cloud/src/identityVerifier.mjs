import { createRemoteJWKSet, jwtVerify } from "jose";

const productAudiences = new Set(["liteasy-admin", "liteasy-desktop", "intuecho-web"]);
const internalAudience = "liteasy-internal";

export class IdentityError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function bearerToken(header) {
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header.trim()) : null;
  if (!match) throw new IdentityError("authentication_required");
  return match[1];
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function audienceArray(value) {
  if (typeof value === "string") return [value];
  return stringArray(value);
}

async function introspectToken(config, token, fetchImpl) {
  const authorization = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
  let response;
  try {
    response = await fetchImpl(config.introspectionUrl, {
      body: new URLSearchParams({ token, token_type_hint: "access_token" }),
      headers: {
        authorization: `Basic ${authorization}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      method: "POST",
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new IdentityError("identity_service_unavailable", 503);
  }
  if (!response.ok) throw new IdentityError("identity_service_unavailable", 503);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new IdentityError("identity_service_invalid_response", 503);
  }
  if (body?.active !== true) throw new IdentityError("session_revoked");
  return body;
}

async function fetchJson(url, fetchImpl, code) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new IdentityError("identity_service_unavailable", 503);
  }
  if (!response.ok) throw new IdentityError("identity_service_unavailable", 503);
  try {
    return await response.json();
  } catch {
    throw new IdentityError(code, 503);
  }
}

export async function verifyIdentityProviderReadiness(config, fetchImpl = fetch) {
  const discovery = await fetchJson(config.discoveryUrl, fetchImpl, "identity_discovery_invalid");
  if (
    discovery.issuer !== config.issuer ||
    discovery.jwks_uri !== config.jwksUrl ||
    discovery.introspection_endpoint !== config.introspectionUrl ||
    discovery.revocation_endpoint !== config.revocationUrl ||
    discovery.token_endpoint !== config.tokenUrl
  ) {
    throw new IdentityError("identity_discovery_mismatch", 503);
  }
  if (!stringArray(discovery.introspection_endpoint_auth_methods_supported).includes("client_secret_basic")) {
    throw new IdentityError("identity_introspection_auth_unsupported", 503);
  }
  if (!stringArray(discovery.token_endpoint_auth_methods_supported).includes("client_secret_basic")) {
    throw new IdentityError("identity_token_auth_unsupported", 503);
  }
  const supportedAlgorithms = new Set(["EdDSA", "ES256", "PS256", "RS256"]);
  if (!stringArray(discovery.id_token_signing_alg_values_supported).some((algorithm) => supportedAlgorithms.has(algorithm))) {
    throw new IdentityError("identity_signing_algorithm_unsupported", 503);
  }
  const jwks = await fetchJson(config.jwksUrl, fetchImpl, "identity_jwks_invalid");
  if (!Array.isArray(jwks.keys) || !jwks.keys.some((key) => key && typeof key.kid === "string" && key.use !== "enc")) {
    throw new IdentityError("identity_jwks_empty", 503);
  }
  return { discovery: true, jwks: true };
}

export function createIdentityVerifier(config, dependencies = {}) {
  const jwks = dependencies.jwks ?? createRemoteJWKSet(new URL(config.jwksUrl));
  const verifyJwt = dependencies.verifyJwt ?? jwtVerify;
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  async function verify(header, expectedAudience) {
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
        throw new IdentityError("access_token_invalid");
      }
      const introspection = await introspectToken(config, token, fetchImpl);
      if (introspection.sub !== verified.payload.sub) throw new IdentityError("access_token_subject_mismatch");
      if (!audienceArray(introspection.aud).includes(expectedAudience)) {
        throw new IdentityError("access_token_audience_mismatch", 403);
      }
      return {
        audience: expectedAudience,
        authTime: Number(verified.payload.auth_time),
        authenticationMethods: stringArray(verified.payload.amr),
        clientId: typeof introspection.client_id === "string" ? introspection.client_id :
          typeof verified.payload.client_id === "string" ? verified.payload.client_id :
            typeof verified.payload.azp === "string" ? verified.payload.azp : null,
        roles: stringArray(verified.payload.roles),
        scopes: typeof introspection.scope === "string" ? introspection.scope.split(/\s+/).filter(Boolean) :
          typeof verified.payload.scope === "string" ? verified.payload.scope.split(/\s+/).filter(Boolean) : [],
        sessionId: typeof verified.payload.sid === "string" ? verified.payload.sid : null,
        subject: verified.payload.sub,
        token
      };
  }

  return {
    async verifyAuthorizationHeader(header, expectedAudience) {
      if (!productAudiences.has(expectedAudience)) throw new IdentityError("identity_audience_configuration_invalid", 500);
      const { clientId: _clientId, ...identity } = await verify(header, expectedAudience);
      return Object.freeze(identity);
    },
    async verifyServiceAuthorizationHeader(header, { clientId, requiredScope }) {
      const identity = await verify(header, internalAudience);
      if (!clientId || identity.clientId !== clientId) {
        throw new IdentityError("service_client_mismatch", 403);
      }
      if (!requiredScope || !identity.scopes.includes(requiredScope)) {
        throw new IdentityError("service_scope_required", 403);
      }
      return Object.freeze(identity);
    }
  };
}

export function requireFreshMfa(identity, { maximumAgeSeconds = 300, nowSeconds = Date.now() / 1000 } = {}) {
  if (identity.audience !== "liteasy-admin") throw new IdentityError("admin_audience_required", 403);
  if (!identity.authenticationMethods.includes("mfa")) throw new IdentityError("mfa_required", 403);
  if (!Number.isFinite(identity.authTime) || nowSeconds - identity.authTime > maximumAgeSeconds || identity.authTime > nowSeconds + 5) {
    throw new IdentityError("fresh_authentication_required", 403);
  }
  return identity;
}
