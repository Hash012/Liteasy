# Cloud Storage Consistency Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production PostgreSQL/S3 library boundary enforce authorization at commit time, reject active nodes below trashed folders, publish revision changes consistently, count trash toward quota, and remove abandoned staging objects.

**Architecture:** Keep the HTTP authorization check as the early rejection boundary, then repeat organization authorization inside the repository transaction with row locks so membership and policy changes cannot overtake the commit. Keep tree and upload invariants in `PostgresLibraryRepository`, quota projections in `PostgresPlatformAdminRepository`, and S3 enumeration in `S3ObjectStore`; `StorageMaintenanceService` only coordinates bounded cleanup.

**Tech Stack:** Node.js 20+, native Node test runner, PostgreSQL 15 transactions, AWS SDK v3 S3 client.

## Global Constraints

- Preserve the service boundary: `products/liteasy/services/api/` must not depend on `development/`.
- All cloud authorization derives from the verified `liteasy-desktop` subject; client-supplied actor or scope ownership is never authoritative.
- Cross-scope copy validates source export and target upload permission both before work and in the committing transaction.
- Trashed library entries continue to consume logical quota until permanent deletion.
- Every client-visible tree state change increments `library_scope_revisions`.
- Maintenance work is bounded, idempotent, and must not delete staging keys referenced by a recoverable workflow.

---

### Task 1: Transaction-Locked Organization Authorization

**Files:**
- Modify: `products/liteasy/services/api/src/libraryAuthorization.mjs`
- Modify: `products/liteasy/services/api/src/libraryRepository.mjs`
- Test: `products/liteasy/services/api/src/libraryAuthorization.test.mjs`
- Test: `products/liteasy/services/api/src/libraryRepository.test.mjs`

**Interfaces:**
- Consumes: `authorizeLibraryScope(queryable, identity, scope, capability)` and repository inputs containing the verified `actorId`.
- Produces: `authorizeLibraryScope(queryable, identity, scope, capability, { lock: true })`, which reads and locks organization, membership, and policy rows through the current transaction client.

- [x] **Step 1: Write failing authorization-lock tests**

Add tests proving `{ lock: true }` uses transaction-scoped `FOR SHARE` reads and rejects an organization member whose upload policy has changed to `owner_admins`.

```js
await assert.rejects(
  () => authorizeLibraryScope(client, identity, organizationScope, "upload", { lock: true }),
  /organization_upload_forbidden/
);
assert.equal(queries.every(({ sql }) => /FOR SHARE/.test(sql)), true);
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern='locks organization authorization|rechecks organization' src/libraryAuthorization.test.mjs src/libraryRepository.test.mjs`

Expected: FAIL because `authorizeLibraryScope` has no locking mode and repository mutations do not reauthorize.

- [x] **Step 3: Implement locked authorization and repository commit checks**

In locking mode, read `organizations`, the actor's `organization_members` row, and `organization_storage_policies` separately with `FOR SHARE`, then evaluate the same capability rules as the existing early check. Before new upload/attachment database preparation, reauthorize `upload`; an already committed recoverable workflow remains authorized for background completion. Before `copyEntry` mutates the target, sort the source/target scope checks by scope key and reauthorize source `export` or `read` plus target `upload` to avoid cross-organization lock-order deadlocks.

```js
await authorizeLibraryScope(client, desktopIdentity(input.actorId), scope, "upload", { lock: true });
```

- [x] **Step 4: Run focused authorization and repository tests**

Run: `npm test -- src/libraryAuthorization.test.mjs src/libraryRepository.test.mjs`

Expected: PASS with no mutation query after a revoked membership or policy denial.

- [x] **Step 5: Commit Task 1**

```bash
git add products/liteasy/services/api/src/libraryAuthorization.mjs products/liteasy/services/api/src/libraryAuthorization.test.mjs products/liteasy/services/api/src/libraryRepository.mjs products/liteasy/services/api/src/libraryRepository.test.mjs docs/superpowers/plans/2026-08-11-filesystem-conformance-03-cloud-storage-consistency.md
git commit -m "fix: recheck library authorization at commit"
```

### Task 2: Active Parent and Upload Visibility Revisions

**Files:**
- Modify: `products/liteasy/services/api/src/libraryRepository.mjs`
- Test: `products/liteasy/services/api/src/libraryRepository.test.mjs`
- Test: `products/liteasy/services/api/src/pdfUploadService.test.mjs`

**Interfaces:**
- Consumes: `requireActiveTargetFolder(client, scope, folderId)` and `bumpScopeRevision(client, scope)`.
- Produces: all folder/entry creation paths reject trashed parents; `completePdfUpload(workflow, traceId)` returns and persists the revision that makes a pending entry available.

- [x] **Step 1: Write failing parent-state and repair-revision tests**

Add repository tests that make `requireFolder` return `status: "trashed"` for `createFolder`, `createMetadataEntry`, and `preparePdfUpload`. Attachment already locks an active metadata entry, so a folder-subtree trash makes that entry ineligible. Add a completion test where the workflow response has revision `4` and the transaction bump returns `5`; assert the returned/idempotency response revision is `5`.

```js
await assert.rejects(() => repository.createFolder(scope, input), /library_folder_trashed/);
assert.equal(completed.revision, 5);
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --test-name-pattern='trashed parent|visible upload revision' src/libraryRepository.test.mjs src/pdfUploadService.test.mjs`

Expected: FAIL because create/upload paths skip the active-parent check and completion reuses the preparation revision.

- [x] **Step 3: Enforce active parents and bump visibility revisions**

Call `requireActiveTargetFolder` immediately before each insert/update that places an active node. In `completePdfUpload`, bump the workflow scope revision after the entry becomes available, replace `response_body.revision`, write that final response to idempotency/audit state, and persist the updated workflow response before commit.

- [x] **Step 4: Run focused library and upload tests**

Run: `npm test -- src/libraryRepository.test.mjs src/pdfUploadService.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit Task 2**

```bash
git add products/liteasy/services/api/src/libraryRepository.mjs products/liteasy/services/api/src/libraryRepository.test.mjs products/liteasy/services/api/src/pdfUploadService.test.mjs
git commit -m "fix: preserve cloud tree state invariants"
```

### Task 3: Trash-Inclusive Administrative Quota Projections

**Files:**
- Modify: `products/liteasy/services/api/src/platformAdminRepository.mjs`
- Test: `products/liteasy/services/api/src/platformAdminRepository.test.mjs`

**Interfaces:**
- Consumes: `library_entries.logical_bytes`, whose active and trashed rows both occupy logical quota.
- Produces: `getQuota`, `listGovernance`, organization status projections, and `setQuota` responses that report all non-purged logical bytes.

- [x] **Step 1: Write a failing quota SQL behavior test**

Capture every administrative usage query and assert none filters `library_entries.status = 'active'`; keep literal used-byte fixtures so the test checks the repository boundary rather than recomputing SQL behavior.

```js
assert.equal(usageQueries.every((sql) => !/status\s*=\s*'active'/i.test(sql)), true);
```

- [x] **Step 2: Run the quota tests and verify RED**

Run: `npm test -- --test-name-pattern='quota|governance' src/platformAdminRepository.test.mjs`

Expected: FAIL because administrative projections exclude trashed entries.

- [x] **Step 3: Remove active-only filters from administrative usage projections**

Keep scope filters and aggregation intact; only remove status predicates so purged rows disappear naturally while active and trashed rows remain counted.

- [x] **Step 4: Run platform admin tests**

Run: `npm test -- src/platformAdminRepository.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit Task 3**

```bash
git add products/liteasy/services/api/src/platformAdminRepository.mjs products/liteasy/services/api/src/platformAdminRepository.test.mjs
git commit -m "fix: count cloud trash toward storage quota"
```

### Task 4: Bounded S3 Staging Garbage Collection

**Files:**
- Modify: `products/liteasy/services/api/src/s3ObjectStore.mjs`
- Modify: `products/liteasy/services/api/src/libraryRepository.mjs`
- Modify: `products/liteasy/services/api/src/storageMaintenance.mjs`
- Test: `products/liteasy/services/api/src/s3ObjectStore.test.mjs`
- Test: `products/liteasy/services/api/src/libraryRepository.test.mjs`
- Test: `products/liteasy/services/api/src/storageMaintenance.test.mjs`

**Interfaces:**
- Produces: `S3ObjectStore.listStagingObjects({ before, limit }) -> Array<{ lastModified, storageKey }>`.
- Produces: `PostgresLibraryRepository.listReferencedStagingKeys(keys) -> string[]` covering non-completed workflows and `storage_objects.staging_key`.
- Consumes: `StorageMaintenanceService.run({ limit, stagingRetentionHours = 24 })`.

- [x] **Step 1: Write failing pagination, reference, and coordinator tests**

Test that S3 listing uses the `${prefix}/.staging/` prefix, follows continuation tokens only until the bounded limit, and returns only objects older than `before`. Test that maintenance deletes old unreferenced keys, preserves referenced keys, and reports failed staging deletions without preventing formal-object garbage collection.

```js
assert.deepEqual(result.removedStagingObjects, 1);
assert.deepEqual(deleted, ["documents/.staging/orphan"]);
```

- [x] **Step 2: Run staging cleanup tests and verify RED**

Run: `npm test -- --test-name-pattern='staging' src/s3ObjectStore.test.mjs src/libraryRepository.test.mjs src/storageMaintenance.test.mjs`

Expected: FAIL because S3 staging enumeration and maintenance coordination do not exist.

- [x] **Step 3: Implement bounded staging cleanup**

Import `ListObjectsV2Command`, validate limit and cutoff, enumerate under the staging prefix, and stop at the requested bound. Query PostgreSQL for keys referenced by `storage_publish_workflows` whose state is not `completed` or by `storage_objects.staging_key`; delete only the remaining candidates. Return `failedStagingObjects`, `removedStagingObjects`, and `scannedStagingObjects` in maintenance output.

- [x] **Step 4: Run storage tests**

Run: `npm test -- src/s3ObjectStore.test.mjs src/libraryRepository.test.mjs src/storageMaintenance.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit Task 4**

```bash
git add products/liteasy/services/api/src/s3ObjectStore.mjs products/liteasy/services/api/src/s3ObjectStore.test.mjs products/liteasy/services/api/src/libraryRepository.mjs products/liteasy/services/api/src/libraryRepository.test.mjs products/liteasy/services/api/src/storageMaintenance.mjs products/liteasy/services/api/src/storageMaintenance.test.mjs
git commit -m "fix: collect abandoned S3 staging objects"
```

### Task 5: Production API Regression Verification

**Files:**
- Review: all files changed by Tasks 1-4.

**Interfaces:**
- Consumes: the production API package test command and PostgreSQL integration verifier's environment-based skip behavior.
- Produces: a clean branch with focused red-green evidence and a fresh full-suite result.

- [ ] **Step 1: Run the complete production API suite**

Run: `npm test`

Expected: all non-environmental tests pass; PostgreSQL/S3 integration checks may report their documented skip when credentials are absent.

- [ ] **Step 2: Review the complete branch diff**

Run: `git diff 42afd1a...HEAD --check`

Run: `git diff 42afd1a...HEAD -- products/liteasy/services/api docs/superpowers/plans`

Expected: no whitespace errors, no dependency on `development/`, no user-controlled authorization data, and no unrelated edits.

- [ ] **Step 3: Record final verification state**

Run: `git status --short --branch`

Expected: clean `fix/filesystem-conformance` branch after focused commits.
