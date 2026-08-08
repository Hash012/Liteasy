import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  localPort,
  localUrl,
  readLocalEnvironment,
  resolvedLocalEnvironment
} from "../local/config.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const localRoot = path.join(repositoryRoot, "deployment/local");
const realmPath = path.join(localRoot, "keycloak/liteasy-realm.json");
const composePath = path.join(localRoot, "compose.yaml");
const expectedClients = new Set([
  "intuecho-api",
  "intuecho-organization-service",
  "intuecho-web",
  "liteasy-account-lifecycle",
  "liteasy-admin-public",
  "liteasy-cloud",
  "liteasy-desktop-public",
  "liteasy-identity-introspection",
  "liteasy-keycloak-admin"
]);
const publicAudiences = new Map([
  ["liteasy-desktop-public", "liteasy-desktop"],
  ["intuecho-web", "intuecho-web"],
  ["liteasy-admin-public", "liteasy-admin"]
]);
const secretEnvironment = [
  "INTUECHO_API_CLIENT_SECRET",
  "INTUECHO_DB_ADMIN_PASSWORD",
  "INTUECHO_DB_APP_PASSWORD",
  "INTUECHO_DB_MIGRATOR_PASSWORD",
  "INTUECHO_ORGANIZATION_SERVICE_SECRET",
  "KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD",
  "KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME",
  "KEYCLOAK_DB_PASSWORD",
  "LITEASY_CLOUD_CLIENT_SECRET",
  "LITEASY_DB_ADMIN_PASSWORD",
  "LITEASY_DB_APP_PASSWORD",
  "LITEASY_DB_MIGRATOR_PASSWORD",
  "LITEASY_IDENTITY_ADMIN_CLIENT_SECRET",
  "LITEASY_IDENTITY_INTROSPECTION_CLIENT_SECRET",
  "LITEASY_IDENTITY_MANAGEMENT_CLIENT_SECRET"
];

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${executable} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

function mapperAudience(client) {
  return client.protocolMappers?.find((mapper) => mapper.protocolMapper === "oidc-audience-mapper")
    ?.config?.["included.custom.audience"];
}

export function verifyStaticFoundation() {
  const realm = JSON.parse(fs.readFileSync(realmPath, "utf8"));
  assert.equal(realm.realm, "liteasy");
  assert.equal(realm.enabled, true);
  assert.equal(Array.isArray(realm.users) ? realm.users.length : 0, 0, "realm import must not contain product users");
  const clients = new Map(realm.clients.map((client) => [client.clientId, client]));
  assert.deepEqual(new Set(clients.keys()), expectedClients);

  for (const [clientId, audience] of publicAudiences) {
    const client = clients.get(clientId);
    assert.equal(client.publicClient, true, `${clientId} must be public`);
    assert.equal(client.standardFlowEnabled, true, `${clientId} must use authorization code flow`);
    assert.equal(client.directAccessGrantsEnabled, false, `${clientId} must reject password grants`);
    assert.equal(client.attributes?.["pkce.code.challenge.method"], "S256", `${clientId} must require PKCE S256`);
    assert.equal(mapperAudience(client), audience, `${clientId} audience mismatch`);
  }

  for (const clientId of ["liteasy-cloud", "intuecho-api", "liteasy-account-lifecycle", "liteasy-identity-introspection", "intuecho-organization-service", "liteasy-keycloak-admin"]) {
    const client = clients.get(clientId);
    assert.equal(client.publicClient, false, `${clientId} must be confidential`);
    assert.match(client.secret, /^\$\{[A-Z0-9_]+\}$/, `${clientId} must receive its secret from the environment`);
  }
  assert.deepEqual(
    new Set(clients.get("liteasy-account-lifecycle").defaultClientScopes),
    new Set(["accounts:write", "sessions:revoke"])
  );
  assert.equal(mapperAudience(clients.get("liteasy-account-lifecycle")), "liteasy-identity-management");
  assert.deepEqual(
    new Set(clients.get("intuecho-organization-service").defaultClientScopes),
    new Set(["organization:authorize"])
  );
  assert.equal(mapperAudience(clients.get("intuecho-organization-service")), "liteasy-internal");
  assert.equal(clients.get("liteasy-identity-introspection").serviceAccountsEnabled, false);

  const composeSource = fs.readFileSync(composePath, "utf8");
  for (const variable of [
    "POSTGRES_IMAGE",
    "KEYCLOAK_IMAGE",
    "IDENTITY_MANAGEMENT_IMAGE",
    "LOCAL_BIND_ADDRESS",
    "LITEASY_DB_HOST_PORT",
    "INTUECHO_DB_HOST_PORT",
    "KEYCLOAK_HOST_PORT",
    "IDENTITY_MANAGEMENT_HOST_PORT",
    "KEYCLOAK_PUBLIC_URL",
    "KEYCLOAK_ISSUER",
    "KEYCLOAK_INTERNAL_URL",
    "LITEASY_DESKTOP_LOOPBACK_REDIRECT_URI",
    "LITEASY_DESKTOP_LOCALHOST_REDIRECT_URI",
    "LITEASY_DESKTOP_WEB_ORIGIN",
    "INTUECHO_WEB_LOOPBACK_REDIRECT_URI",
    "INTUECHO_WEB_REDIRECT_URI",
    "INTUECHO_WEB_LOOPBACK_ORIGIN",
    "INTUECHO_WEB_ORIGIN",
    "LITEASY_ADMIN_LOOPBACK_REDIRECT_URI",
    "LITEASY_ADMIN_REDIRECT_URI",
    "LITEASY_ADMIN_LOOPBACK_ORIGIN",
    "LITEASY_ADMIN_WEB_ORIGIN"
  ]) {
    assert.match(composeSource, new RegExp(`\\$\\{${variable}(?::|})`), `${variable} must parameterize Compose`);
  }

  const syntheticEnvironment = Object.fromEntries(
    secretEnvironment.map((name) => [name, `static-${name.toLowerCase().replaceAll("_", "-")}`])
  );
  command("docker", ["compose", "--file", composePath, "config", "--quiet"], {
    env: { ...process.env, ...syntheticEnvironment }
  });
  for (const script of [
    "deployment/local/postgres/postgres-entrypoint.sh",
    "deployment/local/postgres/init-product-database.sh",
    "deployment/local/keycloak/configure-keycloak.sh"
  ]) {
    command("bash", ["-n", script]);
  }
  return { clients: clients.size, compose: true, productUsers: 0, static: true };
}

async function responseJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`runtime probe failed: ${url} returned ${response.status}`);
  return response.json();
}

function authorization(clientId, clientSecret) {
  const encoded = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

async function serviceToken(tokenEndpoint, clientId, clientSecret, scope) {
  const response = await fetch(tokenEndpoint, {
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
    headers: {
      authorization: authorization(clientId, clientSecret),
      "content-type": "application/x-www-form-urlencoded"
    },
    method: "POST",
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error(`service token failed for ${clientId}: ${response.status}`);
  const body = await response.json();
  assert.equal(typeof body.access_token, "string");
  return body.access_token;
}

async function introspectServiceToken(endpoint, verifier, clientId, token, expectedIssuer, expectedAudience, expectedScopes) {
  const response = await fetch(endpoint, {
    body: new URLSearchParams({ token, token_type_hint: "access_token" }),
    headers: {
      authorization: authorization(verifier.clientId, verifier.clientSecret),
      "content-type": "application/x-www-form-urlencoded"
    },
    method: "POST",
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error(`service token introspection failed for ${clientId}: ${response.status}`);
  const body = await response.json();
  const audiences = Array.isArray(body.aud) ? body.aud : [body.aud].filter(Boolean);
  const scopes = new Set(typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : []);
  assert.equal(body.active, true);
  assert.equal(body.iss, expectedIssuer);
  assert.equal(body.client_id ?? body.azp, clientId);
  assert.equal(audiences.includes(expectedAudience), true, `${clientId} audience mismatch`);
  for (const scope of expectedScopes) assert.equal(scopes.has(scope), true, `${clientId} missing scope ${scope}`);
}

async function verifyProtectedIdentityRoute(baseUrl, token) {
  const response = await fetch(`${baseUrl}/v1/accounts/runtime-verification-subject/status`, {
    body: JSON.stringify({ reason: "Non-mutating runtime authorization verification", status: "active" }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-idempotency-key": "runtime-verification",
      "x-trace-id": "runtime-verification"
    },
    method: "POST",
    signal: AbortSignal.timeout(8_000)
  });
  assert.equal(response.status, 404, "identity-management must authorize the caller before resolving the absent subject");
  assert.deepEqual(await response.json(), { code: "identity_subject_not_found" });
}

async function verifyRevocationEndpoint(endpoint, clientId, clientSecret, token) {
  const response = await fetch(endpoint, {
    body: new URLSearchParams({ token, token_type_hint: "access_token" }),
    headers: {
      authorization: authorization(clientId, clientSecret),
      "content-type": "application/x-www-form-urlencoded"
    },
    method: "POST",
    signal: AbortSignal.timeout(5_000)
  });
  assert.equal(response.status, 200, "OIDC revocation endpoint must accept authenticated requests");
}

export async function verifyRuntimeFoundation() {
  const values = resolvedLocalEnvironment(readLocalEnvironment());
  const issuer = localUrl(values, "KEYCLOAK_ISSUER");
  const publicUrl = localUrl(values, "KEYCLOAK_PUBLIC_URL");
  assert.equal(issuer, `${publicUrl}/realms/liteasy`, "KEYCLOAK_ISSUER must match KEYCLOAK_PUBLIC_URL");
  const discovery = await responseJson(`${issuer}/.well-known/openid-configuration`);
  assert.equal(discovery.issuer, issuer);
  assert.equal(discovery.token_endpoint, `${issuer}/protocol/openid-connect/token`);
  assert.equal(discovery.introspection_endpoint, `${issuer}/protocol/openid-connect/token/introspect`);
  assert.equal(discovery.revocation_endpoint, `${issuer}/protocol/openid-connect/revoke`);
  assert.equal(discovery.jwks_uri, `${issuer}/protocol/openid-connect/certs`);
  const jwks = await responseJson(discovery.jwks_uri);
  assert.equal(Array.isArray(jwks.keys) && jwks.keys.length > 0, true, "JWKS must contain a signing key");
  const identityBase = new URL("http://localhost");
  identityBase.hostname = values.LOCAL_RUNTIME_HOST;
  identityBase.port = String(localPort(values, "IDENTITY_MANAGEMENT_HOST_PORT"));
  const adapterUrl = identityBase.toString().replace(/\/$/, "");
  const adapter = await responseJson(`${adapterUrl}/readyz`);
  assert.equal(adapter.dependencies?.keycloakAdminApi, true);
  const secrets = values;
  const lifecycle = await serviceToken(
    discovery.token_endpoint,
    "liteasy-account-lifecycle",
    secrets.LITEASY_IDENTITY_MANAGEMENT_CLIENT_SECRET,
    "accounts:write sessions:revoke"
  );
  await introspectServiceToken(
    discovery.introspection_endpoint,
    {
      clientId: "liteasy-identity-introspection",
      clientSecret: secrets.LITEASY_IDENTITY_INTROSPECTION_CLIENT_SECRET
    },
    "liteasy-account-lifecycle",
    lifecycle,
    issuer,
    "liteasy-identity-management",
    ["accounts:write", "sessions:revoke"]
  );
  await verifyProtectedIdentityRoute(adapterUrl, lifecycle);
  await verifyRevocationEndpoint(
    discovery.revocation_endpoint,
    "liteasy-account-lifecycle",
    secrets.LITEASY_IDENTITY_MANAGEMENT_CLIENT_SECRET,
    lifecycle
  );
  const organization = await serviceToken(
    discovery.token_endpoint,
    "intuecho-organization-service",
    secrets.INTUECHO_ORGANIZATION_SERVICE_SECRET,
    "organization:authorize"
  );
  await introspectServiceToken(
    discovery.introspection_endpoint,
    { clientId: "intuecho-api", clientSecret: secrets.INTUECHO_API_CLIENT_SECRET },
    "intuecho-organization-service",
    organization,
    issuer,
    "liteasy-internal",
    ["organization:authorize"]
  );
  return {
    identityManagementAuthorization: true,
    jwks: true,
    oidcDiscovery: true,
    revocationEndpoint: true,
    runtime: true,
    serviceTokens: true
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = { static: verifyStaticFoundation() };
    if (process.argv.includes("--runtime")) result.runtime = await verifyRuntimeFoundation();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
