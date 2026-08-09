import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("final review migration persists versioned modality costs and reservation bindings", async () => {
  const sql = await fs.readFile(new URL("../migrations/021_visualization_final_review.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE visualization_cost_policies/);
  assert.match(sql, /cost_table_revision/);
  assert.match(sql, /requested_by/);
  assert.match(sql, /reservation_id.*visualization_artifacts/s);
  assert.match(sql, /response_max_bytes/);
  assert.match(sql, /event_type IN \('reserved','settled','rollback','expired','adjustment','cache_reuse'\)/);
  assert.match(sql, /provider_id/);
});

test("final review migration keeps unknown usage event types blocked", async () => {
  const sql = await fs.readFile(new URL("../migrations/021_visualization_final_review.sql", import.meta.url), "utf8");
  assert.match(sql, /visualization_usage_ledger_event_type_check/);
  assert.doesNotMatch(sql, /event_type = 'cache_reuse' OR event_type = 'settled'[^\n]*units_delta/);
});
