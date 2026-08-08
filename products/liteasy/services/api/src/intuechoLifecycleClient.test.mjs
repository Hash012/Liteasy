import assert from "node:assert/strict";
import test from "node:test";
import { IntuechoLifecycleClient } from "./intuechoLifecycleClient.mjs";

test("forwards the verified administrator token and validates the deletion receipt", async () => {
  const calls = [];
  const client = new IntuechoLifecycleClient({ adminApiUrl: "https://forum-api.test" }, {
    fetchImpl: async (url, request) => {
      calls.push({ request, url });
      return { ok: true, async json() { return {
        completedAt: "2026-08-07T00:00:00.000Z",
        operationId: "delete-user-0001:intuecho",
        result: { deletedDrafts: 2 },
        subjectId: "user_1"
      }; } };
    }
  });
  const result = await client.deleteAccount({
    adminAccessToken: "admin-token",
    idempotencyKey: "delete-user-0001:intuecho",
    reason: "Approved account deletion",
    subjectId: "user_1"
  });
  assert.equal(result.result.deletedDrafts, 2);
  assert.equal(calls[0].request.headers.authorization, "Bearer admin-token");
  assert.match(calls[0].url, /user_1\/delete$/);
});

test("rejects an unrelated or unverifiable Intuecho receipt", async () => {
  const client = new IntuechoLifecycleClient({ adminApiUrl: "https://forum-api.test" }, {
    fetchImpl: async () => ({ ok: true, async json() { return {
      completedAt: "invalid",
      operationId: "other-operation",
      result: {},
      subjectId: "other-user"
    }; } })
  });
  await assert.rejects(() => client.deleteAccount({
    adminAccessToken: "admin-token",
    idempotencyKey: "delete-user-0001:intuecho",
    reason: "Approved account deletion",
    subjectId: "user_1"
  }), /intuecho_lifecycle_invalid_response/);
});
