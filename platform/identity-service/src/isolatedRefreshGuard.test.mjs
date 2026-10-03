import assert from "node:assert/strict";
import test from "node:test";
import { validateIsolatedRefreshConfig } from "./isolatedRefreshGuard.mjs";

const config = { schema: "liteasy.isolated-refresh-test/v1", disposableTestInstance: true, runId: "0123456789abcdef", origin: "http://127.0.0.1:19081",
  subjectId: "synthetic", admin: { clientId: "synthetic-admin", clientSecret: "synthetic" }, sessions: [{ clientId: "liteasy-desktop", refreshToken: "synthetic" }] };
test("real refresh drill cannot target production, arbitrary realms or unknown client audiences", () => {
  assert.equal(validateIsolatedRefreshConfig(config).apiUrl, "http://127.0.0.1:19081/admin/realms/liteasy-review-0123456789abcdef");
  for (const change of [{ disposableTestInstance: false }, { origin: "https://accounts.example" }, { origin: "http://127.0.0.1:19081/realms/production" },
    { sessions: [{ clientId: "other", refreshToken: "synthetic" }] }, { sessions: [config.sessions[0], config.sessions[0]] }
  ]) assert.throws(() => validateIsolatedRefreshConfig({ ...config, ...change }));
});
