import assert from "node:assert/strict";
import fs from "node:fs";
import { KeycloakClient } from "../src/keycloakClient.mjs";
import { clientAudiences, validateIsolatedRefreshConfig } from "../src/isolatedRefreshGuard.mjs";

// Tokens/config remain in a private file; only per-audience booleans are emitted.
try {
  assert.equal(process.argv[2], "--config");
  const file = fs.realpathSync(process.argv[3]);
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  const config = validateIsolatedRefreshConfig(JSON.parse(fs.readFileSync(file, "utf8")));
  const request = (url, options = {}) => fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10_000) });
  const adminResponse = await request(config.tokenUrl, { method: "POST", body: new URLSearchParams({ grant_type: "client_credentials",
    client_id: config.admin.clientId, client_secret: config.admin.clientSecret }) });
  assert.equal(adminResponse.status, 200);
  const adminToken = (await adminResponse.json()).access_token;
  const headers = { authorization: `Bearer ${adminToken}` };
  const userResponse = await request(`${config.apiUrl}/users/${encodeURIComponent(config.subjectId)}`, { headers });
  assert.equal(userResponse.status, 200);
  const user = await userResponse.json();
  assert.equal(user.id, config.subjectId);
  assert.equal(user.enabled, true);
  assert.deepEqual(user.attributes?.liteasyTestRun, [config.runId], "synthetic subject marker must be provisioned independently");
  const clientsResponse = await request(`${config.apiUrl}/clients`, { headers });
  assert.equal(clientsResponse.status, 200);
  const enabled = (await clientsResponse.json()).filter((client) => client.enabled && clientAudiences.includes(client.clientId)).map((client) => client.clientId).sort();
  assert.ok(enabled.length > 0);
  assert.deepEqual(config.sessions.map((session) => session.clientId).sort(), enabled, "test every actually enabled audience");
  const refresh = (session) => request(config.tokenUrl, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token",
    client_id: session.clientId, refresh_token: session.refreshToken, ...(session.clientSecret ? { client_secret: session.clientSecret } : {}) }) });
  const sessions = [];
  for (const session of config.sessions) {
    const response = await refresh(session);
    assert.equal(response.status, 200, "refresh must genuinely work before revocation");
    const tokens = await response.json();
    assert.ok(tokens.refresh_token);
    const info = await request(config.userInfoUrl, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    assert.equal(info.status, 200);
    assert.equal((await info.json()).sub, config.subjectId);
    sessions.push({ ...session, refreshToken: tokens.refresh_token });
  }
  const keycloak = new KeycloakClient({ apiUrl: config.apiUrl, tokenUrl: config.tokenUrl,
    clientId: config.admin.clientId, clientSecret: config.admin.clientSecret });
  await keycloak.setStatus(config.subjectId, "disabled");
  const results = [];
  for (const session of sessions) {
    const response = await refresh(session);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_grant");
    results.push({ audience: session.clientId, before: "accepted", after: "invalid_grant", status: "pass" });
  }
  console.log(JSON.stringify({ verified: true, layer: "isolated-real-IdP-refresh", results,
    notEnabled: clientAudiences.filter((audience) => !enabled.includes(audience)), notRun: ["native-OAuth-keyring-handoff", "production"] }));
} catch {
  console.error(JSON.stringify({ verified: false, errorCode: "isolated_refresh_not_verified" }));
  process.exitCode = 1;
}
