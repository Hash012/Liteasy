import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "./database.mjs";
import {
  createPlatformAdminRepository,
  PlatformAuthorizationError
} from "./platformAdminRepository.mjs";

function createHarness(environment = "development") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-platform-admin-test-"));
  const database = createDatabase({ databasePath: path.join(root, "test.sqlite") });
  let current = new Date("2026-08-06T00:00:00.000Z");
  const insertUser = database.prepare(`
    INSERT INTO users (
      id, email, display_name, membership_tier, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'pro', 'active', ?, ?)
  `);
  for (const [id, email] of [
    ["admin-1", "admin@example.com"],
    ["target-1", "target@example.com"]
  ]) {
    insertUser.run(id, email, id, current.toISOString(), current.toISOString());
  }
  const repository = createPlatformAdminRepository(database, {
    environment,
    now: () => current
  });
  return {
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
    },
    close() {
      database.close();
      fs.rmSync(root, { force: true, recursive: true });
    },
    database,
    repository
  };
}

test("production diagnostics stay disabled even if a stale assignment exists", () => {
  const harness = createHarness("production");
  try {
    harness.database.prepare(`
      INSERT INTO platform_role_assignments (
        owner_key, role, environment, granted_by, granted_at, revoked_at
      ) VALUES ('user:admin-1', 'developer_diagnostics', 'production', 'legacy', ?, NULL)
    `).run("2026-01-01T00:00:00.000Z");
    assert.equal(harness.repository.hasRole("user:admin-1", "developer_diagnostics"), false);
    assert.throws(
      () => harness.repository.grantRole(
        "user:admin-1",
        "developer_diagnostics",
        "bootstrap"
      ),
      (error) => error instanceof PlatformAuthorizationError &&
        error.code === "production_diagnostics_forbidden"
    );
  } finally {
    harness.close();
  }
});

test("support access is scoped, expires, revokes, and audits every transition", () => {
  const harness = createHarness();
  try {
    harness.repository.grantRole("user:admin-1", "platform_admin", "bootstrap");
    const grant = harness.repository.grantSupportAccess({
      durationMinutes: 30,
      grantedBy: "user:admin-1",
      granteeUserId: "admin-1",
      reason: "Investigate user-reported PDF corruption",
      scopeId: "user:target-1",
      scopeType: "user"
    });
    assert.equal(
      harness.repository.requireSupportAccess("admin-1", "user", "user:target-1").grantId,
      grant.grantId
    );
    harness.repository.recordAudit({
      action: "support_document_accessed",
      actorId: "user:admin-1",
      metadata: { documentId: "document-1", grantId: grant.grantId },
      reason: grant.reason,
      risk: "high",
      targetId: "user:target-1",
      targetType: "user"
    });
    assert.deepEqual(harness.repository.revokeSupportAccess(
      grant.grantId,
      "user:admin-1",
      "Investigation complete"
    ), { grantId: grant.grantId, revoked: true });
    assert.throws(
      () => harness.repository.requireSupportAccess("admin-1", "user", "user:target-1"),
      (error) => error instanceof PlatformAuthorizationError &&
        error.code === "support_access_required"
    );
    const actions = harness.database.prepare(`
      SELECT action FROM platform_audit_events ORDER BY occurred_at, event_id
    `).all().map((row) => row.action);
    assert.equal(actions.includes("support_access_granted"), true);
    assert.equal(actions.includes("support_document_accessed"), true);
    assert.equal(actions.includes("support_access_revoked"), true);
  } finally {
    harness.close();
  }
});

test("support access expires without relying on a client clock", () => {
  const harness = createHarness();
  try {
    harness.repository.grantRole("user:admin-1", "platform_admin", "bootstrap");
    harness.repository.grantSupportAccess({
      durationMinutes: 1,
      grantedBy: "user:admin-1",
      granteeUserId: "admin-1",
      reason: "Time-bounded support check",
      scopeId: "user:target-1",
      scopeType: "user"
    });
    harness.advance(60_001);
    assert.throws(
      () => harness.repository.requireSupportAccess("admin-1", "user", "user:target-1"),
      (error) => error instanceof PlatformAuthorizationError &&
        error.code === "support_access_required"
    );
  } finally {
    harness.close();
  }
});

test("retrieval source configuration is transactional, sanitized, and audited", () => {
  const harness = createHarness();
  try {
    const source = harness.repository.saveRetrievalSource({
      baseUrl: "https://example.org/search/",
      enabled: true,
      name: "Research index",
      reason: "Enable approved scholarly index",
      sourceKind: "database"
    }, "user:admin-1");
    assert.equal(source.baseUrl, "https://example.org/search");
    assert.equal(harness.repository.listRetrievalSources().length, 1);
    assert.throws(
      () => harness.repository.saveRetrievalSource({
        baseUrl: "https://token@example.org/search?api_key=secret",
        name: "Unsafe source",
        reason: "invalid",
        sourceKind: "website"
      }, "user:admin-1"),
      (error) => error instanceof PlatformAuthorizationError &&
        error.code === "invalid_retrieval_source_url"
    );
    assert.deepEqual(
      harness.repository.removeRetrievalSource(
        source.sourceId,
        "user:admin-1",
        "Provider contract ended"
      ),
      { removed: true, sourceId: source.sourceId }
    );
    const actions = harness.database.prepare(
      "SELECT action FROM platform_audit_events ORDER BY occurred_at, event_id"
    ).all().map((row) => row.action);
    assert.equal(actions.includes("retrieval_source_saved"), true);
    assert.equal(actions.includes("retrieval_source_removed"), true);
  } finally {
    harness.close();
  }
});

test("model policy survives repository recreation without storing provider secrets", () => {
  const harness = createHarness();
  try {
    const policy = {
      defaultProvider: "deepseek",
      localDirectEnabled: false,
      modelAccessMode: "cloud_proxy",
      policyVersion: "ops-policy-v4",
      syncedAt: "2026-08-06T00:00:00.000Z"
    };
    harness.repository.saveModelPolicy(policy, "user:admin-1");
    const recreated = createPlatformAdminRepository(harness.database, {
      environment: "development"
    });
    assert.deepEqual(recreated.loadModelPolicy(), policy);
    const serialized = harness.database.prepare(
      "SELECT value_json FROM platform_runtime_settings WHERE setting_key = 'model_policy'"
    ).get().value_json;
    assert.equal(serialized.includes("apiKey"), false);
  } finally {
    harness.close();
  }
});
