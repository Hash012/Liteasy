# Thin Reading Multimodal Phase 2 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Phase 2 with repeatable real-PostgreSQL verification of migrations `020-022` and the visualization governance/accounting transactions, followed by a clean independent review.

**Architecture:** Extend the existing loopback-only `liteasy_test` integration path instead of adding another database framework. The migrator resets only the guarded test database schema, applies the immutable migration set, grants the application role, and then runs both the existing product integration suite and focused visualization repository tests through the real `pg` driver.

**Tech Stack:** Node.js 20, Node test runner, `pg` 8, PostgreSQL 16, Docker Compose.

## Global Constraints

- Never point destructive integration commands at a non-loopback database or a database whose name does not end in `_test`.
- Use the separate migrator and application roles; the application role must remain unable to create schema objects.
- Do not modify migrations `001-022`; add later corrective migrations only if a real database test proves a defect.
- Repository/unit tests remain hermetic; PostgreSQL tests skip explicitly without `LITEASY_TEST_DATABASE_URL` and never count as a passing integration gate.
- Preserve existing user changes and stage only files named by the current task.
- Do not claim production PostgreSQL readiness from SQL-string contract tests.

---

### Task 1: Repeatable Liteasy PostgreSQL Entry Point

**Files:**
- Modify: `products/liteasy/services/api/scripts/verify-postgres-integration.mjs`
- Create: `deployment/local/verify-liteasy-postgres-integration.mjs`
- Modify: `deployment/local/README.md`
- Test: `products/liteasy/services/api/src/migrations.test.mjs`

**Interfaces:**
- Consumes: `LITEASY_TEST_DATABASE_URL`, `LITEASY_TEST_MIGRATION_DATABASE_URL`, existing `migratePostgres()`.
- Produces: a repeatable local command `node deployment/local/verify-liteasy-postgres-integration.mjs` and an integration database at migration head `022`.

- [ ] **Step 1: Run the current integration path and record RED**

Prepare worktree-local ignored credentials and start only an isolated Liteasy PostgreSQL service, then run:

```bash
cd /home/octopus/Liteasy/.worktrees/thin-reading-multimodal-sdd
node deployment/local/prepare.mjs
docker compose --env-file deployment/local/.env -f deployment/local/compose.yaml -p liteasy-multimodal-test up -d --wait liteasy-postgres
node deployment/local/verify-liteasy-postgres-integration.mjs
```

Expected: Docker reports the isolated PostgreSQL service healthy, then the wrapper command FAILS because the wrapper does not exist. A direct run of the API script against a fresh database would also disagree with its hard-coded `001-019` migration list after applying `020-022`. Keep this Compose project running through the Phase 2 closure gate; do not remove its volumes or touch another Compose project.

- [ ] **Step 2: Add a guarded schema reset and current migration assertion**

In `verify-postgres-integration.mjs`, after the existing loopback/`_test` URL guard and before `migratePostgres()`, reset only the test schema through the migration pool:

```js
if (migrationConnectionString === connectionString) {
  throw new Error("integration_migration_role_required");
}
await migrationPool.query("DROP SCHEMA IF EXISTS public CASCADE");
await migrationPool.query("CREATE SCHEMA public");
await migrationPool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
```

Pass `applicationRole: parsed.username` to `migratePostgres()` and change the exact expected migration list to include:

```js
"020_visualization_control_plane.sql",
"021_visualization_final_review.sql",
"022_visualization_cost_policy_lifecycle.sql"
```

Update the final JSON assertion to report migration count `22`; retain the existing application-role `CREATE TABLE` rejection.

- [ ] **Step 3: Add the local credential-safe wrapper**

Create `verify-liteasy-postgres-integration.mjs` with the same URL construction pattern as the Intuecho wrapper:

```js
function postgresUrl(role, password) {
  const url = new URL("postgresql://localhost");
  url.hostname = values.LOCAL_RUNTIME_HOST;
  url.port = String(localPort(values, "LITEASY_DB_HOST_PORT"));
  url.pathname = "/liteasy_test";
  url.username = role;
  url.password = password;
  return url.toString();
}
```

Spawn `npm run test:postgres:integration` in `products/liteasy/services/api` with `LITEASY_TEST_DATABASE_URL` using `liteasy_app` and `LITEASY_TEST_MIGRATION_DATABASE_URL` using `liteasy_migrator`; inherit stdio and propagate the exit status.

- [ ] **Step 4: Document and verify the entry point**

Add the exact command under the README database boundary and state that it resets only `liteasy_test`. Run:

```bash
cd products/liteasy/services/api
npm test -- src/migrations.test.mjs
cd ../../../..
node deployment/local/verify-liteasy-postgres-integration.mjs
```

Expected: migration unit tests PASS; integration output contains `"migrations":22` and `"verified":true`.

- [ ] **Step 5: Commit**

```bash
git add products/liteasy/services/api/scripts/verify-postgres-integration.mjs products/liteasy/services/api/src/migrations.test.mjs deployment/local/verify-liteasy-postgres-integration.mjs deployment/local/README.md
git commit -m "test: refresh Liteasy PostgreSQL integration gate"
```

### Task 2: Real Visualization Governance And Quota Transactions

> **Retrospective execution amendment (2026-08-10):** The initial real
> PostgreSQL run, after the Task 2 test was written, exposed two repository
> defects that require files outside this task's original three-file list. This
> amendment is intentionally retrospective and does not rewrite the earlier
> commit history. The required `createVisualizationTestPool({ connectionString,
> sslMode: "disable" })` interface reached `createPostgresPool()` as a TLS
> configuration and failed with `DEPTH_ZERO_SELF_SIGNED_CERT`; authorize
> `products/liteasy/services/api/src/postgres.mjs` and
> `products/liteasy/services/api/src/postgres.test.mjs` to map that explicit
> test-only mode to `pg` `ssl: false`, with a Pool-options regression test.
> Concurrent `reserve()` calls then reproducibly failed with PostgreSQL `40001`
> after waiting behind the subject advisory lock because their `SERIALIZABLE`
> snapshots predated the lock holder's commit; authorize
> `products/liteasy/services/api/src/visualizationRepository.mjs` and
> `products/liteasy/services/api/src/visualizationRepository.test.mjs` to run
> only `reserve()` at `READ COMMITTED`, return the dedicated 429
> `visualization_concurrency_exceeded` error, and cover it through a
> deterministic database lock barrier. The same repository/test files are also
> authorized to inject a defaulted repository clock so hand-calculated UTC
> fixtures can verify Asia/Shanghai boundaries without wall-clock dependence.

**Files:**
- Create: `products/liteasy/services/api/src/visualizationPostgres.integration.test.mjs`
- Modify: `products/liteasy/services/api/package.json`
- Modify: `deployment/local/verify-liteasy-postgres-integration.mjs`

**Interfaces:**
- Consumes: `PostgresVisualizationRepository`, `createVisualizationTestPool()`, migrated `liteasy_test`.
- Produces: `npm run test:postgres:visualization`, covering real locks, constraints, windows, revisions, and idempotency.

- [ ] **Step 1: Run the missing integration test and record RED**

```bash
cd products/liteasy/services/api
node --test src/visualizationPostgres.integration.test.mjs
```

Expected: FAIL because the test module does not exist.

- [ ] **Step 2: Write the opt-in integration test scaffold**

Use one serial top-level test and explicit skip semantics:

```js
const connectionString = process.env.LITEASY_TEST_DATABASE_URL;
test("visualization governance is atomic in PostgreSQL", {
  skip: connectionString ? false : "LITEASY_TEST_DATABASE_URL is not configured"
}, async () => {
  const pool = createVisualizationTestPool({ connectionString, sslMode: "disable" });
  try {
    await verifyGovernanceTransactions(pool);
  } finally {
    await pool.end();
  }
});
```

Use a unique subject/route suffix from `randomUUID()` and direct SQL cleanup for mutable rows only. Do not delete append-only usage, provider-cost, or audit rows.

- [ ] **Step 3: Add entitlement, route, and policy assertions**

Through the real repository:

```js
await repository.setEntitlement(subjectId, {
  allowed: true,
  allowedModalities: ["semantic_graph"],
  expectedRevision: 0,
  explicitRequestsAllowed: true,
  grantedBy: adminId,
  idempotencyKey: `entitlement-${suffix}`,
  reason: "Approved PostgreSQL integration entitlement",
  traceId: `trace-entitlement-${suffix}`
});
await repository.setQuotaPolicy(subjectId, {
  dailyUnits: 2,
  expectedRevision: 0,
  idempotencyKey: `quota-policy-${suffix}`,
  maxConcurrency: 1,
  monthlyUnits: 4,
  reason: "Approved PostgreSQL integration quota",
  timezone: "Asia/Shanghai",
  traceId: `trace-quota-${suffix}`,
  updatedBy: adminId
});
```

Create an enabled `semantic_graph` route at revision `1`, assert its structured-generation cost policy was inserted, replay the same idempotency key byte-identically, and assert a stale expected revision rejects without adding an audit row.

- [ ] **Step 4: Add concurrent reservation and window assertions**

Start two `reserve()` calls together with distinct idempotency keys against `maxConcurrency: 1`:

```js
const results = await Promise.allSettled([
  repository.reserve(subjectId, reservation("reserve-a")),
  repository.reserve(subjectId, reservation("reserve-b"))
]);
assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(results.filter((result) => result.status === "rejected").length, 1);
assert.match(results.find((result) => result.status === "rejected").reason.message, /visualization_concurrency_exceeded/);
```

Rollback the successful reservation, reserve again, and assert the row pins route, quota-policy, and cost-policy revisions. Insert bounded ledger fixtures on both sides of an `Asia/Shanghai` day/month boundary and assert the repository uses net deltas in the correct windows.

- [ ] **Step 5: Wire the dedicated command and wrapper**

Add:

```json
"test:postgres:visualization": "node --test src/visualizationPostgres.integration.test.mjs"
```

The local wrapper runs the existing full PostgreSQL script first and then `npm run test:postgres:visualization` with the same guarded URLs.

- [ ] **Step 6: Run the real database test**

```bash
cd /home/octopus/Liteasy/.worktrees/thin-reading-multimodal-sdd
node deployment/local/verify-liteasy-postgres-integration.mjs
```

Expected: the visualization integration test runs without a skip and passes. If a real transaction assertion fails, stop this task, invoke `systematic-debugging`, identify the root cause, and amend this plan with the exact production correction before editing repository code.

- [ ] **Step 7: Verify and commit**

```bash
node deployment/local/verify-liteasy-postgres-integration.mjs
cd products/liteasy/services/api && npm test
git add products/liteasy/services/api/src/visualizationPostgres.integration.test.mjs products/liteasy/services/api/package.json deployment/local/verify-liteasy-postgres-integration.mjs
git commit -m "test: verify visualization governance in PostgreSQL"
```

Expected: integration tests PASS with zero skipped PostgreSQL tests; API unit suite PASS.

### Task 3: Real Publication And Provider Accounting Transactions

**Files:**
- Modify: `products/liteasy/services/api/src/visualizationPostgres.integration.test.mjs`

**Interfaces:**
- Consumes: the real entitlement, route, policy, and reservation fixtures from Task 2.
- Produces: PostgreSQL evidence for atomic publication/settlement, invocation replay, provider-cost reconciliation, and late cancellation.

- [ ] **Step 1: Add a real subject-owned library document fixture**

Insert a personal source object, library entry, and reference using exact real columns:

```js
await pool.query(`
  INSERT INTO storage_objects(
    content_hash, byte_length, storage_key, media_type, checksum_verified_at, status
  ) VALUES ($1, 16, $2, 'application/pdf', now(), 'available')
`, [sourceHash, `objects/visualization-${suffix}.pdf`]);
await pool.query(`
  INSERT INTO library_entries(
    document_id, scope_type, scope_id, entry_kind, file_name, normalized_name,
    title, metadata, logical_bytes, availability, created_by
  ) VALUES ($1, 'user', $2, 'pdf', $3, $3, 'Visualization integration paper',
    '{}', 16, 'available', $2)
`, [documentId, subjectId, `visualization-${suffix}.pdf`]);
await pool.query(`
  INSERT INTO storage_object_references(document_id, content_hash) VALUES ($1, $2)
`, [documentId, sourceHash]);
```

Use the same `subjectId` and pass:

```js
const access = {
  allowed: true,
  scopeId: subjectId,
  scopeType: "user",
  sourceIdentityHash: sourceHash
};
const document = { documentId, sourceIdentityHash: sourceHash };
```

- [ ] **Step 2: Add publication and equal-unit settlement RED**

Reserve one request, publish a valid envelope with matching modality/document/route revisions, then assert in one database snapshot:

```js
assert.equal(reservation.state, "settled");
assert.equal(reservation.settled_units, reservation.reserved_units);
assert.equal(artifact.reservation_id, reservation.reservation_id);
assert.equal(usage.event_type, "settled");
assert.equal(Number(usage.units_delta), 0);
```

Replay publication and assert it returns the committed artifact without a second ledger event. Attempt publication with a different modality, expired reservation, revoked entitlement, and changed source hash; each must reject and leave no artifact/settlement.

- [ ] **Step 3: Add invocation and provider-cost reconciliation RED**

Call `startProviderInvocation()`, then concurrently call `finalizeProviderInvocation()` twice with the same provider request ID and cost. Assert one terminal invocation, one provider-cost row, and replay without duplication. Repeat with the same provider request ID on a different invocation and assert the whole transaction rolls back.

Finalize a late cancellation with provider cost present and assert:

```js
assert.equal(invocation.state, "cancelled");
assert.equal(providerCostRows, 1);
assert.equal(userSettlementRows, 0);
assert.equal(userRollbackRows, 1);
```

- [ ] **Step 4: Run GREEN and commit**

```bash
node deployment/local/verify-liteasy-postgres-integration.mjs
cd products/liteasy/services/api && npm test
git add products/liteasy/services/api/src/visualizationPostgres.integration.test.mjs
git commit -m "test: verify visualization accounting in PostgreSQL"
```

Expected: all PostgreSQL and API tests PASS; no unexpected skip.

### Task 4: Phase 2 Final Review And Closure Record

**Files:**
- Modify: `.superpowers/sdd/2026-08-09-thin-reading-multimodal-02-followup/progress.md`
- Modify: `docs/superpowers/plans/2026-08-09-thin-reading-multimodal-implementation-index.md`

**Interfaces:**
- Consumes: commits and verification evidence from Tasks 1-3.
- Produces: an auditable Phase 2 completion record; it does not claim production deployment acceptance.

- [ ] **Step 1: Run the complete verification matrix**

```bash
node deployment/local/verify-liteasy-postgres-integration.mjs
cd products/liteasy/services/api && npm test
cd ../../apps/admin && npm test && npm run build
cd ../desktop && npm test && npm run build
```

Expected: PostgreSQL gate has zero skips; API/admin/desktop tests and both builds PASS.

- [ ] **Step 2: Request independent code review**

Use `superpowers:requesting-code-review` over the Phase 2 closure base through current HEAD. Review against the original Plan 2, follow-up plan, and closure design. Critical/Important findings block completion and are fixed test-first with a scoped re-review.

- [ ] **Step 3: Record only verified closure facts**

Append the PostgreSQL command/result, package test counts, build results, review verdict, and commit range to the follow-up ledger. Update the implementation index Phase 2 entry to `complete` while retaining the statement that local readiness is not production acceptance.

- [ ] **Step 4: Commit**

```bash
git add .superpowers/sdd/2026-08-09-thin-reading-multimodal-02-followup/progress.md docs/superpowers/plans/2026-08-09-thin-reading-multimodal-implementation-index.md
git commit -m "docs: close multimodal control plane phase"
```
