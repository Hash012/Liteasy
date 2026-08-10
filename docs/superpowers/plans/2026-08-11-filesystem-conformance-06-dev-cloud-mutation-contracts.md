# Dev-Cloud Mutation Contracts Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dev-cloud library mutation require an exact idempotency request and an explicit current scope revision, matching the confirmed filesystem design and production service boundary.

**Architecture:** Keep `createLibraryStorageRepository` as the authoritative mutation boundary. Route helpers normalize away authentication aliases and the idempotency key before hashing the business request, while the repository requires an 8-200 character key, a hashable request payload, and a non-negative `expectedRevision` for every scope-tree mutation. Existing SQLite rows without a request hash fail closed instead of replaying an unverifiable response.

**Tech Stack:** Node.js 20+, native Node test runner, better-sqlite3 transactions.

## Global Constraints

- The confirmed design in `docs/design/Liteasy-文件系统与存储边界设计.md` remains authoritative.
- Every user-reachable cloud tree mutation requires both an idempotency key and `expectedRevision`.
- The same actor/key/operation replays only when the normalized business request hash is identical.
- Authentication aliases, transport placement of the idempotency key, and `sessionId` are not part of the business request hash.
- Existing null `request_hash` rows cannot prove equality and therefore fail closed on replay.
- Maintenance and account-lifecycle operations that are not client tree mutations keep their existing internal transaction contracts.

---

### Task 1: Exact Idempotency Replay

**Files:**
- Modify: `development/dev-cloud/db/libraryStorageRepository.mjs`
- Modify: `development/dev-cloud/requestHandler.mjs`
- Test: `development/dev-cloud/db/libraryStorageRepository.test.mjs`
- Test: `development/dev-cloud/db/organizationRepository.test.mjs`
- Test: `development/dev-cloud/server.test.mjs`

**Interfaces:**
- Produces: `runIdempotent(actorKey, operationKey, operationKind, operation, requestInput)` requires an 8-200 character operation key and a defined JSON request payload.
- Produces: request replay only when `stored.request_hash === sha256(JSON.stringify(requestInput))`.
- Produces: `libraryMutationRequest(body)` removes `sessionId` and `idempotencyKey` before hashing.

- [x] **Step 1: Write failing repository idempotency tests**

Add tests proving that a short key and an omitted request payload fail before the callback runs, and that a legacy row with `request_hash IS NULL` cannot replay a new request.

```js
assert.throws(
  () => repository.runIdempotent("user:alice", "short", "create_library_folder", () => {
    throw new Error("must not execute");
  }, { expectedRevision: 0, name: "Topic" }),
  (error) => error instanceof LibraryStorageError && error.code === "invalid_idempotency_key"
);

assert.throws(
  () => repository.runIdempotent(
    "user:alice",
    "folder-create-0001",
    "create_library_folder",
    () => ({ ok: true })
  ),
  (error) => error instanceof LibraryStorageError && error.code === "invalid_idempotency_request"
);
```

Insert one controlled `library_idempotency_keys` row with a null hash, then call `runIdempotent` with the same actor/key/operation and a defined payload. Expect `idempotency_key_reused` and prove the callback did not execute.

- [x] **Step 2: Write the failing HTTP annotation replay test**

Create an organization annotation, then submit a changed body under the same idempotency key. Expect HTTP `409` with `idempotency_key_reused`; the stored annotation body and revision remain unchanged.

- [x] **Step 3: Run focused tests and verify RED**

Run:

```bash
cd development/dev-cloud
npm test -- db/libraryStorageRepository.test.mjs db/organizationRepository.test.mjs server.test.mjs
```

Expected: the repository accepts short/missing-proof requests, and the annotation route replays a changed request because it does not supply `requestInput`.

- [x] **Step 4: Implement strict request hashing**

In `runIdempotent`:

```js
if (!actorKey || !/^[A-Za-z0-9:._-]{8,200}$/.test(operationKey) || !operationKind) {
  throw new LibraryStorageError("invalid_idempotency_key", "A valid idempotency key is required.");
}
if (requestInput === undefined) {
  throw new LibraryStorageError(
    "invalid_idempotency_request",
    "An idempotent request payload is required."
  );
}
const requestHash = createHash("sha256").update(JSON.stringify(requestInput)).digest("hex");
```

Compare every existing row with strict equality, including null legacy hashes. Add `libraryMutationRequest(body)` in the request handler and use it from `executeLibraryMutation` and the direct organization annotation routes. Update repository-level callers in tests to pass literal request payloads.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the Task 1 command again. Expected: all idempotency tests pass; the two tracked repository fixtures and one server fixture for legacy literature identity may still fail and must remain the only unrelated failures.

### Task 2: Required Scope Revision

**Files:**
- Modify: `development/dev-cloud/db/libraryStorageRepository.mjs`
- Test: `development/dev-cloud/db/libraryStorageRepository.test.mjs`
- Test: `development/dev-cloud/server.test.mjs`

**Interfaces:**
- Produces: missing, non-integer, or negative revisions fail with `invalid_library_revision`.
- Preserves: a well-formed but stale revision fails with `library_revision_conflict` and status `409`.
- Preserves: current revisions mutate once and return the incremented scope revision.

- [x] **Step 1: Write failing missing-revision repository tests**

Exercise representative mutation families with valid target state but no revision: create/upload, update/move, trash/restore/purge, empty trash, team annotation upload, and team annotation withdrawal. Each must fail before changing the tree.

```js
assert.throws(
  () => repository.createFolder({
    createdBy: "user:alice",
    name: "Missing revision",
    scopeId: "user:alice",
    scopeType: "user"
  }),
  (error) => error instanceof LibraryStorageError && error.code === "invalid_library_revision"
);
```

- [x] **Step 2: Run the repository test and verify RED**

Run: `npm test -- db/libraryStorageRepository.test.mjs`

Expected: missing revisions are currently accepted because `assertRevision` returns early.

- [x] **Step 3: Require revisions at the repository boundary**

Change `assertRevision` to distinguish malformed/missing input from a stale current revision:

```js
const expected = parseLibraryRevision(expectedRevision);
const actual = currentRevision(scope.scopeType, scope.scopeId);
if (expected !== actual) {
  throw new LibraryStorageError(
    "library_revision_conflict",
    "The library changed. Refresh and retry the operation.",
    409
  );
}
```

Update test setup mutations to pass the repository's current revision explicitly. Use a small test helper that derives only the literal `expectedRevision` field; do not change production APIs to auto-read revisions.

- [x] **Step 4: Run focused dev-cloud tests**

Run:

```bash
npm test -- db/libraryStorageRepository.test.mjs db/organizationRepository.test.mjs
npm test -- server.test.mjs
```

Expected: repository mutation tests pass. The server file passes all mutation-contract tests and retains only the tracked legacy literature identity failure.

### Task 3: Regression Verification and Commit

**Files:**
- Review: all files changed by Tasks 1-2.

**Interfaces:**
- Consumes: exact idempotency replay and required revision contracts.
- Produces: one focused commit on `fix/filesystem-conformance`.

- [x] **Step 1: Run the complete dev-cloud suite**

Run: `npm test`

Expected: no new failures. Only the three tracked legacy `manual` literature identity fixtures may remain until the final audit batch.

- [x] **Step 2: Run the complete production API suite**

Run: `cd products/liteasy/services/api && npm test`

Expected: all non-environmental tests pass, confirming no production contract regression.

- [x] **Step 3: Review and commit**

Run: `git diff --check`.

```bash
git add docs/superpowers/plans/2026-08-11-filesystem-conformance-06-dev-cloud-mutation-contracts.md development/dev-cloud/db/libraryStorageRepository.mjs development/dev-cloud/db/libraryStorageRepository.test.mjs development/dev-cloud/db/organizationRepository.test.mjs development/dev-cloud/requestHandler.mjs development/dev-cloud/server.test.mjs
git commit -m "fix: enforce dev cloud mutation contracts"
```

Expected: the isolated branch contains one focused mutation-contract commit.
