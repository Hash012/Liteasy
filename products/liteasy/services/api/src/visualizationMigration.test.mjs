import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../migrations/020_visualization_control_plane.sql", import.meta.url);

test("visualization migration defines separate user and provider ledgers", async () => {
  const sql = await fs.readFile(migrationUrl, "utf8");
  assert.match(sql, /CREATE TABLE visualization_usage_ledger/);
  assert.match(sql, /CREATE TABLE visualization_provider_cost_ledger/);
  assert.match(sql, /UNIQUE \(subject_id, idempotency_key\)/);
  assert.doesNotMatch(sql, /storage_quotas/);
});

test("visualization migration keeps reservations bounded and stateful", async () => {
  const sql = await fs.readFile(migrationUrl, "utf8");
  assert.match(sql, /state text NOT NULL CHECK \(state IN \('reserved','settled','rolled_back','expired'\)\)/);
  assert.match(sql, /reserved_units integer NOT NULL CHECK \(reserved_units > 0\)/);
  assert.match(sql, /settled_units integer CHECK \(settled_units >= 0 AND settled_units <= reserved_units\)/);
  assert.match(sql, /expires_at timestamptz NOT NULL/);
});

test("visualization ledgers are append-only and provider costs cannot become user usage", async () => {
  const sql = await fs.readFile(migrationUrl, "utf8");
  assert.match(sql, /visualization_usage_ledger_append_only/);
  assert.match(sql, /visualization_provider_cost_ledger_append_only/);
  assert.match(sql, /CREATE TABLE visualization_provider_invocations/);
  assert.match(sql, /provider_request_id/);
  assert.match(sql, /UNIQUE \(route_id, provider_request_id\)/);
});

test("migration head includes 020 visualization control plane", async () => {
  const { readMigrations } = await import("./migrations.mjs");
  const migration = readMigrations().find(({ name }) => name === "020_visualization_control_plane.sql");
  assert.equal(migration?.name, "020_visualization_control_plane.sql");
});
