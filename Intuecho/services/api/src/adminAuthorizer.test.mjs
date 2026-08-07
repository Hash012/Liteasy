import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformAdminAuthorizer } from "./adminAuthorizer.mjs";

test("rechecks platform_admin against the separate administration API", async () => {
  const calls = [];
  const authorizer = createPlatformAdminAuthorizer({
    baseUrl: "https://admin.test/",
    fetchImpl: async (url, request = {}) => {
      calls.push({ request, url });
      if (url.endsWith("/readyz")) {
        return { ok: true, async json() { return { status: "ready" }; } };
      }
      return { ok: true, async json() { return {
        principal: { roles: ["platform_admin"], subjectId: "admin-1" }
      }; } };
    }
  });
  assert.deepEqual(await authorizer.assertPlatformAdmin({ subject: "admin-1", token: "admin-token" }), {
    subject: "admin-1"
  });
  assert.deepEqual(await authorizer.readiness(), { ready: true });
  assert.equal(calls[0].request.headers.authorization, "Bearer admin-token");
});

test("does not trust a platform role unless subject and role are confirmed", async () => {
  const authorizer = createPlatformAdminAuthorizer({
    baseUrl: "https://admin.test",
    fetchImpl: async () => ({ ok: true, async json() { return {
      principal: { roles: ["platform_admin"], subjectId: "someone-else" }
    }; } })
  });
  await assert.rejects(
    () => authorizer.assertPlatformAdmin({ subject: "admin-1", token: "admin-token" }),
    /platform_admin_required/
  );
});
