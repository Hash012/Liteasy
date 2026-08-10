# Personalization Explicit Opt-In Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make personalization collection and use disabled until each account explicitly enables it in both the production PostgreSQL service and the local development cloud.

**Architecture:** Treat the server as the privacy authority even when a desktop retains stale local settings. Production adds a forward-only migration that changes the database default to `false`, disables previously enabled states, increments their versions, and invalidates their recommendation caches so accounts must opt in again. Dev-cloud preserves rows created by explicit settings updates but treats a missing setting as disabled and rebuilds the SQLite table with a disabled default.

**Tech Stack:** Node.js 20+, native Node test runner, PostgreSQL 15 SQL migrations, better-sqlite3 migrations.

## Global Constraints

- Personalization signals, local metadata manifests, and historical profile terms are not collected or used until the account explicitly enables personalization.
- Desktop local settings remain advisory; production and dev-cloud reject or ignore collection while their account state is disabled.
- Existing production rows whose origin cannot prove consent are disabled and version-bumped; users may explicitly opt in again.
- Existing dev-cloud `personalization_settings` rows are preserved because that table is written only by the explicit settings update or clear operations.
- Do not modify previously applied migration files.

---

### Task 1: Production Defaults and Existing-State Reset

**Files:**
- Create: `products/liteasy/services/api/migrations/025_personalization_explicit_opt_in.sql`
- Modify: `products/liteasy/services/api/src/personalizationRepository.mjs`
- Test: `products/liteasy/services/api/src/personalizationRepository.test.mjs`
- Test: `products/liteasy/services/api/src/migrations.test.mjs`

**Interfaces:**
- Produces: `PostgresPersonalizationRepository.get(newSubject).enabled === false` without creating account data.
- Produces: final PostgreSQL schema default `personalization_states.enabled = false`.
- Produces: migration reset of existing enabled states with a version increment and deletion of their recommendation cache entries.

- [x] **Step 1: Write failing production default and migration-head tests**

Change the default-state test to require `enabled: false`. Extend the immutable migration list to require `025_personalization_explicit_opt_in.sql`.

```js
assert.deepEqual(await repository.get("user_1"), {
  enabled: false,
  personalizationVersion: 0,
  profile: { disciplines: [], profileVersion: 0, stage: "未设置" },
  tags: []
});
```

- [x] **Step 2: Run focused production tests and verify RED**

Run: `npm test -- src/personalizationRepository.test.mjs src/migrations.test.mjs`

Expected: FAIL because the repository fallback is enabled and migration 025 does not exist.

- [x] **Step 3: Implement the production opt-in boundary**

Return `false` when no personalization state row exists. Add migration 025:

```sql
ALTER TABLE personalization_states ALTER COLUMN enabled SET DEFAULT false;

WITH disabled AS (
  UPDATE personalization_states
     SET enabled = false, version = version + 1, updated_at = now()
   WHERE enabled = true
   RETURNING subject_id
)
DELETE FROM recommendation_cache_entries cache
 USING disabled
 WHERE cache.subject_id = disabled.subject_id;
```

- [x] **Step 4: Run focused production tests**

Run: `npm test -- src/personalizationRepository.test.mjs src/migrations.test.mjs`

Expected: PASS.

### Task 2: Dev-Cloud Explicit Settings Requirement

**Files:**
- Create: `development/dev-cloud/db/migrations/021_personalization_explicit_opt_in.sql`
- Modify: `development/dev-cloud/db/personalizationRepository.mjs`
- Modify: `development/dev-cloud/requestHandler.mjs`
- Test: `development/dev-cloud/db/personalizationRepository.test.mjs`
- Test: `development/dev-cloud/server.test.mjs`

**Interfaces:**
- Produces: a missing `personalization_settings` row maps to `enabled: false`.
- Preserves: existing settings rows and their explicit `0` or `1` value during the table rebuild.
- Preserves: recommendation caches when a disabled account submits an ignored signal.
- Preserves: profile and signal behavior after `setEnabled(ownerKey, true)`.

- [x] **Step 1: Write failing dev-cloud opt-in tests**

Add a repository test proving a new owner is disabled and a behavior signal creates no terms before opt-in. Add a server test that reads disabled settings first, explicitly enables them through `/v1/personalization/settings/update`, then records a signal successfully.

```js
assert.equal(personalization.get("user:new").enabled, false);
assert.deepEqual(personalization.recordSignal("user:new", {
  kind: "paper_opened",
  title: "Private topic"
}).tags, []);
```

- [x] **Step 2: Run focused dev-cloud tests and verify RED**

Run: `npm test -- db/personalizationRepository.test.mjs server.test.mjs`

Expected: FAIL because missing settings currently imply enabled.

- [x] **Step 3: Implement the dev-cloud default and migration**

Make `readState` enabled only when the stored value equals `1`. Rebuild `personalization_settings` in migration 021 with `DEFAULT 0`, copy all existing rows unchanged, drop the old table, and rename the replacement. Update existing signal tests to call `setEnabled(ownerKey, true)` before asserting collection behavior.

- [x] **Step 4: Run focused dev-cloud tests**

Run: `npm test -- db/personalizationRepository.test.mjs server.test.mjs`

Expected: PASS.

### Task 3: Service Regression Verification and Commit

**Files:**
- Review: all files changed by Tasks 1-2.

**Interfaces:**
- Consumes: production API and dev-cloud complete test suites.
- Produces: one focused privacy commit on `fix/filesystem-conformance`.

- [x] **Step 1: Run the complete production API suite**

Run: `npm test`

Expected: all non-environmental production API tests pass.

- [x] **Step 2: Run the complete dev-cloud suite**

Run: `npm test`

Expected: all personalization tests pass. The complete suite currently retains three known legacy
`manual` literature identity fixture failures, which are tracked for the final audit batch.

- [x] **Step 3: Review and commit**

Run: `git diff --check`

```bash
git add docs/superpowers/plans/2026-08-11-filesystem-conformance-05-personalization-opt-in.md products/liteasy/services/api/migrations/025_personalization_explicit_opt_in.sql products/liteasy/services/api/src/personalizationRepository.mjs products/liteasy/services/api/src/personalizationRepository.test.mjs products/liteasy/services/api/src/migrations.test.mjs development/dev-cloud/db/migrations/021_personalization_explicit_opt_in.sql development/dev-cloud/db/personalizationRepository.mjs development/dev-cloud/db/personalizationRepository.test.mjs development/dev-cloud/requestHandler.mjs development/dev-cloud/server.test.mjs
git commit -m "fix: require personalization opt in"
```

Expected: clean isolated branch after commit.

## Verification Evidence

- Production API: `367` tests, `364` passed, `3` PostgreSQL integration tests skipped, `0` failed.
- Dev-cloud personalization repository: `9/9` passed.
- Dev-cloud HTTP personalization paths passed in the full `server.test.mjs` run.
- SQLite 020-to-021 upgrade simulation preserved explicit `0/1` rows and applied `DEFAULT 0`.
- Full dev-cloud suite: all personalization tests passed; the only failures are the three tracked
  legacy `manual` literature identity fixtures.
