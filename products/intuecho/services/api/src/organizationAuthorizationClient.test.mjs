import assert from "node:assert/strict";
import test from "node:test";
import {
  OrganizationAuthorizationClient,
  OrganizationAuthorizationError
} from "./organizationAuthorizationClient.mjs";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function config() {
  return {
    apiUrl: "https://liteasy.internal",
    audience: "liteasy-internal",
    clientId: "intuecho-organization-service",
    clientSecret: "service-secret",
    scope: "organization:authorize",
    tokenUrl: "https://identity.internal/token"
  };
}

test("uses one client-credentials token for authoritative access and invitation calls", async () => {
  const requests = [];
  const client = new OrganizationAuthorizationClient(config(), {
    fetchImpl: async (url, init) => {
      requests.push({ body: String(init.body), headers: init.headers, url });
      if (url === config().tokenUrl) return response(200, {
        access_token: "service-token",
        expires_in: 300,
        token_type: "Bearer"
      });
      if (url.endsWith("/access")) return response(200, { allowed: true, role: "member" });
      if (url.endsWith("/memberships")) return response(200, { organizations: [{
        myRole: "admin",
        name: "Evidence Lab",
        organizationId: "org_1"
      }] });
      return response(201, { invitation: {
        invitationId: "orginvite_1",
        invitationToken: "orginv_token",
        organizationId: "org_1",
        revision: 0,
        role: "member",
        targetSubject: "user_2"
      } });
    },
    now: () => 1_000
  });

  assert.equal(await client.authorizeVisibility({ organizationId: "org_1", userId: "user_1" }), true);
  assert.deepEqual(await client.listMemberships("user_1"), [{
    name: "Evidence Lab",
    organizationId: "org_1",
    role: "admin"
  }]);
  const invitation = await client.authorizeInvitation({
    idempotencyKey: "intuecho-message_1",
    invitedUserId: "user_2",
    inviterId: "user_1",
    organizationId: "org_1",
    role: "member"
  });
  assert.equal(invitation.invitationId, "orginvite_1");
  assert.equal(requests.filter((item) => item.url === config().tokenUrl).length, 1);
  assert.match(requests[0].body, /grant_type=client_credentials/);
  assert.match(requests[0].body, /audience=liteasy-internal/);
  assert.equal(requests[1].headers.authorization, "Bearer service-token");
  assert.equal(JSON.parse(requests[3].body).actorSubject, "user_1");
});

test("fails closed on unavailable, denied, and malformed organization authority responses", async () => {
  const token = response(200, { access_token: "service-token", expires_in: 300, token_type: "Bearer" });
  const denied = new OrganizationAuthorizationClient(config(), {
    fetchImpl: async (url) => url === config().tokenUrl ? token : response(403, {})
  });
  assert.equal(await denied.authorizeVisibility({ organizationId: "org_1", userId: "user_1" }), false);
  assert.equal(await denied.authorizeInvitation({
    idempotencyKey: "intuecho-message_1",
    invitedUserId: "user_2",
    inviterId: "user_1",
    organizationId: "org_1",
    role: "member"
  }), null);

  const malformed = new OrganizationAuthorizationClient(config(), {
    fetchImpl: async (url) => url === config().tokenUrl ? token : response(201, { invitation: { invitationId: "forged" } })
  });
  await assert.rejects(() => malformed.authorizeInvitation({
    idempotencyKey: "intuecho-message_2",
    invitedUserId: "user_2",
    inviterId: "user_1",
    organizationId: "org_1",
    role: "member"
  }), OrganizationAuthorizationError);
});
