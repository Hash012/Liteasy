import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAccountRepository } from "../db/accountRepository.mjs";
import { createAuthSessionRepository } from "../db/authSessionRepository.mjs";
import { createDatabase } from "../db/database.mjs";
import { createAuthService, AuthError } from "./authService.mjs";

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-auth-boundary-test-"));
  const database = createDatabase({ databasePath: path.join(root, "test.sqlite") });
  const accounts = createAccountRepository(database);
  const sessions = createAuthSessionRepository(database);
  const mfa = {
    isEnabled: () => true,
    verify: (_userId, code) => code === "123456"
  };
  return {
    accounts,
    auth: createAuthService({
      accountRepository: accounts,
      mfaService: mfa,
      sessionRepository: sessions
    }),
    close() {
      database.close();
      fs.rmSync(root, { force: true, recursive: true });
    },
    database
  };
}

test("disabling an account revokes desktop, Intuecho, and admin sessions together", async () => {
  const harness = createHarness();
  try {
    const registered = await harness.auth.register({
      audience: "liteasy-desktop",
      displayName: "Identity User",
      email: "identity@example.com",
      password: "private-password-1"
    });
    const forum = await harness.auth.login({
      audience: "intuecho-web",
      email: "identity@example.com",
      password: "private-password-1"
    });
    const admin = await harness.auth.login({
      audience: "liteasy-admin",
      email: "identity@example.com",
      mfaCode: "123456",
      password: "private-password-1"
    });

    harness.accounts.setStatus(registered.userId, "disabled");

    for (const [token, audience] of [
      [registered.sessionId, "liteasy-desktop"],
      [forum.sessionId, "intuecho-web"],
      [admin.sessionId, "liteasy-admin"]
    ]) {
      assert.throws(
        () => harness.auth.validateSession(token, audience),
        (error) => error instanceof AuthError && error.code === "invalid_session"
      );
    }
    assert.equal(harness.database.prepare(`
      SELECT count(*) AS count FROM auth_sessions
      WHERE user_id = ? AND revoked_at IS NULL
    `).get(registered.userId).count, 0);
  } finally {
    harness.close();
  }
});

test("a production bootstrap password must be changed with MFA before admin login", async () => {
  const harness = createHarness();
  try {
    const registered = await harness.auth.register({
      audience: "liteasy-desktop",
      displayName: "Bootstrap Admin",
      email: "bootstrap@example.com",
      password: "temporary-password-1"
    });
    harness.database.prepare(
      "UPDATE users SET must_change_password = 1 WHERE id = ?"
    ).run(registered.userId);

    await assert.rejects(
      () => harness.auth.login({
        audience: "liteasy-admin",
        email: "bootstrap@example.com",
        mfaCode: "123456",
        password: "temporary-password-1"
      }),
      (error) => error instanceof AuthError && error.code === "password_change_required"
    );
    assert.deepEqual(await harness.auth.changeBootstrapPassword({
      email: "bootstrap@example.com",
      mfaCode: "123456",
      newPassword: "replacement-password-2",
      password: "temporary-password-1"
    }), { changed: true });
    const loggedIn = await harness.auth.login({
      audience: "liteasy-admin",
      email: "bootstrap@example.com",
      mfaCode: "123456",
      password: "replacement-password-2"
    });
    assert.equal(loggedIn.audience, "liteasy-admin");
  } finally {
    harness.close();
  }
});

test("unknown audiences are rejected instead of becoming desktop sessions", async () => {
  const harness = createHarness();
  try {
    await assert.rejects(
      () => harness.auth.register({
        audience: "untrusted-client",
        displayName: "Invalid Audience",
        email: "audience@example.com",
        password: "private-password-1"
      }),
      (error) => error instanceof AuthError && error.code === "invalid_session_audience"
    );
  } finally {
    harness.close();
  }
});
