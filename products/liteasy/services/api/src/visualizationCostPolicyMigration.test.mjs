import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../migrations/", import.meta.url);

test("cost policy lifecycle preserves the provider-inclusive versioned contract", async () => {
  const initial = await readFile(new URL("021_visualization_final_review.sql", migrationDirectory), "utf8");
  const lifecycle = await readFile(new URL("022_visualization_cost_policy_lifecycle.sql", migrationDirectory), "utf8");

  assert.match(initial, /PRIMARY KEY\s*\(modality, operation, data_class, provider_id, revision\)/i);
  assert.match(initial, /unit_cost integer NOT NULL CHECK \(unit_cost > 0\)/i);
  assert.match(initial, /revision bigint NOT NULL DEFAULT 1 CHECK \(revision > 0\)/i);
  assert.match(initial, /updated_by text NOT NULL/i);
  assert.match(initial, /reason text NOT NULL/i);
  assert.match(initial, /event_type IN \('reserved','settled','rollback','expired','adjustment','cache_reuse'\)/i);
  assert.match(lifecycle, /visualization_cost_policies_lookup_idx/i);
  assert.match(lifecycle, /visualization_cost_policies_provider_idx/i);
  assert.doesNotMatch(lifecycle, /DROP\s+(TABLE|COLUMN|CONSTRAINT)/i);
});
