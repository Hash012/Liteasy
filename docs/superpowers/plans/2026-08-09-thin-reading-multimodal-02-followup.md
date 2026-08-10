# Thin Reading Multimodal Control-Plane Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three load-bearing control-plane gaps left by the Plan 02 final review so later reader and renderer plans can rely on usable routes, replayable probes, and durable provider accounting.

**Architecture:** Keep PostgreSQL authoritative for cost-policy selection, probe idempotency state, and invocation identity. Provider network calls remain outside database transactions, but each call is preceded by an atomic claim and followed by a durable success/failure finalization. The capability projection is derived from entitlement plus a usable route and a matching cost policy.

**Tech Stack:** Node.js 20, PostgreSQL SQL migrations, existing Liteasy repository/service/provider gateway, React 18/Vitest.

## Global Constraints

- Formal implementation belongs in `products/liteasy/services/api/`; production code must not import `development/`.
- Database stores `secretRef`, never key/token/password material.
- Provider operational cost is recorded separately from the user usage ledger.
- Provider/system/validation failure, cancellation, timeout, or revocation rolls back all user units.
- Admin mutations require fresh MFA, revision, idempotency key, reason, and append-only audit.
- Capability failures fail closed for generation while preserving entitlement state and source-figure access.
- A provider request may execute at most once for a claimed probe idempotency key; a completed failure is replayable and audited.
- A provider cost row must reference the durable Liteasy invocation ID created before network I/O; provider request IDs are metadata, not invocation identity.

---

### Task 1: Cost Policy Provisioning And Capability Gate

**Files:**
- Modify: `products/liteasy/services/api/src/visualizationRepository.mjs`
- Modify: `products/liteasy/services/api/src/visualizationRepository.test.mjs`
- Modify: `products/liteasy/services/api/src/visualizationService.mjs`
- Modify: `products/liteasy/services/api/src/visualizationService.test.mjs`
- Modify: `products/liteasy/services/api/src/visualizationFinalReviewFix.test.mjs`
- Create: `products/liteasy/services/api/migrations/022_visualization_cost_policy_lifecycle.sql`
- Create: `products/liteasy/services/api/src/visualizationCostPolicyMigration.test.mjs`

**Interfaces:**
- `saveProviderRoute()` must insert or upsert one enabled cost policy for every declared `(modality, operation, dataClass, providerId)` combination when a route is first created, with `revision = 1`, a positive server-owned unit cost, actor, reason, and audit transaction.
- `capability()` and `reserve()` must require a matching enabled policy for the locked route/provider; a missing policy returns `serviceAvailable: false` and `visualization_cost_policy_unconfigured` respectively.
- Policy history remains versioned by `(modality, operation, dataClass, providerId, revision)`; updates create a new revision and never mutate historical rows.
- Test fixtures use a literal route with `routeId: "route-new"`, `providerId: "provider-new"`, `revision: 1`, `operations: ["structured_generation"]`, `modalities: ["semantic_graph"]`, `dataClasses: ["paper"]`, `endpoint: "https://provider.example/v1"`, `secretRef: "viz-secret:provider-new"`, and a request with `modality: "semantic_graph"`, `operation: "structured_generation"`, `dataClass: "paper"`, and `routeId: "route-new"`.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test("creating a provider route provisions cost policies for every declared capability", async () => {
  const result = await repository.saveProviderRoute({ route: completeRoute, expectedRevision: 0, actorId: "admin-1", idempotencyKey: "route-create-1", reason: "enable provider route" });
  assert.equal(result.route.revision, 1);
  assert.equal(result.costPolicies.length, 2);
});

test("capability is unavailable when the locked route has no matching cost policy", async () => {
  const capability = await repository.capability("user-1");
  assert.equal(capability.serviceAvailable, false);
  await assert.rejects(repository.reserve("user-1", request), /visualization_cost_policy_unconfigured/);
});
```

- [ ] **Step 2: Verify RED**

Run: `cd products/liteasy/services/api && node --test src/visualizationFinalReviewFix.test.mjs src/visualizationRepository.test.mjs`

Expected: the new route-create policy assertion fails because route persistence does not create policies for newly declared provider combinations.

- [ ] **Step 3: Add the lifecycle migration contract**

Migration 022 must add only indexes/constraints needed by the lifecycle and a catalog contract test must assert the provider-inclusive primary key, positive unit cost, and immutable revision columns from migration 021 remain present. Do not drop or rename the event-type whitelist.

- [ ] **Step 4: Implement server-owned provisioning and gate**

Inside the existing route mutation transaction, derive combinations from the normalized route, insert missing revision-1 policies with a deterministic default cost, and append the existing redacted audit record. In `capability()`, select a route only when its cost policy exists for the requested operation/data class; preserve `allowed` independently from `serviceAvailable`.

- [ ] **Step 5: Run GREEN and commit**

Run: `cd products/liteasy/services/api && node --test src/visualizationCostPolicyMigration.test.mjs src/visualizationFinalReviewFix.test.mjs src/visualizationRepository.test.mjs src/visualizationService.test.mjs && npm test`

Commit: `git commit -m "fix: provision visualization cost policies for new routes"`

### Task 2: Probe Claim Finalization And Replayable Failure

**Files:**
- Modify: `products/liteasy/services/api/src/visualizationRepository.mjs`
- Modify: `products/liteasy/services/api/src/visualizationService.mjs`
- Modify: `products/liteasy/services/api/src/visualizationRepository.test.mjs`
- Modify: `products/liteasy/services/api/src/visualizationService.test.mjs`
- Modify: `products/liteasy/services/api/src/server.test.mjs`

**Interfaces:**
- `claimProviderProbe(input)` atomically locks the `(actorId, idempotencyKey)` record before external I/O and returns `{ claimed: true }`, `{ pending: true }`, or a stored `{ replayed: true, ...result }`.
- `recordProviderProbe({ actorId, idempotencyKey, requestHash, routeId, expectedRevision, result, error, traceId })` finalizes either success or a stable redacted failure, writes one append-only audit event, and clears `pending` so all later calls replay.
- `testProviderRoute()` calls finalization from both success and failure paths; a failed provider probe is never left pending and never causes a second external call for the same key.
- Test fixtures use admin principal `{ subjectId: "admin-1", roles: ["platform_admin"], authentication: { fresh: true } }` and probe input `{ routeId: "route-1", expectedRevision: 3, idempotencyKey: "probe-failure-1", reason: "verify provider route", traceId: "trace-1", providerRequest: { modality: "semantic_graph", dataClass: "paper" } }`.

- [ ] **Step 1: Write failing concurrency and failure tests**

```js
test("a failed probe finalizes its claim and replays without a second provider call", async () => {
  let calls = 0;
  gateway.testRoute = async () => { calls += 1; throw new Error("provider down"); };
  await assert.rejects(service.testProviderRoute(admin, input), /visualization_provider_unavailable/);
  const replay = await service.testProviderRoute(admin, input);
  assert.equal(calls, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.error.code, "visualization_provider_unavailable");
});
```

- [ ] **Step 2: Verify RED**

Run: `cd products/liteasy/services/api && node --test src/visualizationService.test.mjs src/visualizationRepository.test.mjs`

Expected: the second call either performs a second provider call or remains pending because failure finalization is absent.

- [ ] **Step 3: Implement finalization in the repository**

Use the existing `idempotency_records` row and an advisory transaction lock. Store a redacted response body with a stable status/code and audit detail; never store paper content, credentials, or raw provider errors. Preserve route ID and expected revision in the request hash.

- [ ] **Step 4: Finalize every service path**

Wrap the gateway call in `try/catch/finally`: success calls `recordProviderProbe` before returning, provider error maps to a stable public code and calls the same method with `error`, cancellation records a cancelled result, and only then rethrows. Pending callers poll only until the bounded route timeout, then return a stable 503 without making a provider call.

- [ ] **Step 5: Run GREEN and commit**

Run: `cd products/liteasy/services/api && node --test src/visualizationService.test.mjs src/visualizationRepository.test.mjs src/server.test.mjs && npm test`

Commit: `git commit -m "fix: finalize visualization provider probe claims"`

### Task 3: Durable Invocation And Provider Cost Reconciliation

**Files:**
- Modify: `products/liteasy/services/api/src/visualizationRepository.mjs`
- Modify: `products/liteasy/services/api/src/visualizationService.mjs`
- Modify: `products/liteasy/services/api/src/visualizationProviderGateway.mjs`
- Modify: `products/liteasy/services/api/src/visualizationRepository.test.mjs`
- Modify: `products/liteasy/services/api/src/visualizationService.test.mjs`
- Modify: `products/liteasy/services/api/src/visualizationProviderGateway.test.mjs`

**Interfaces:**
- `startProviderInvocation()` returns a durable `invocationId`; every cost record uses it, while `providerRequestId` is stored separately and may be absent only when no provider response exists.
- `completeProviderInvocation({ invocationId, state, providerRequestId, providerUnits, errorCode, responseHash })` updates the same row exactly once and is safe to replay.
- Gateway error normalization preserves validated `cost` metadata and attaches the durable invocation ID supplied by the service; adapter response limits can only reduce the operation hard cap.
- Test fixtures use subject `{ subjectId: "user-1" }`, an abortable `AbortController`, and a repository spy that records `invocations`, `costRows`, and `completeProviderInvocation` calls while the gateway adapter returns a normalized cost with `providerRequestId: "provider-request-9"`.

- [ ] **Step 1: Write failing identity and cancellation tests**

```js
test("provider cost remains linked to the durable invocation on success and cancellation", async () => {
  const result = await service.generate(subject, input, context);
  assert.equal(repository.costRows[0].invocationId, repository.invocations[0].invocationId);
  controller.abort();
  await assert.rejects(service.generate(subject, input, context), /visualization_request_aborted/);
  assert.equal(repository.costRows.at(-1).invocationId, repository.invocations.at(-1).invocationId);
});
```

- [ ] **Step 2: Verify RED**

Run: `cd products/liteasy/services/api && node --test src/visualizationProviderGateway.test.mjs src/visualizationService.test.mjs src/visualizationRepository.test.mjs`

Expected: a mutation using a provider request ID that differs from the durable invocation ID fails the linkage assertion.

- [ ] **Step 3: Make invocation identity authoritative**

Generate the Liteasy invocation ID before gateway I/O, pass it through the normalized request, and never replace it with provider request metadata. `recordProviderCost()` must use the durable invocation ID and `completeProviderInvocation()` must update provider request ID/state in one idempotent transition.

- [ ] **Step 4: Preserve cost and enforce response caps**

When normalizing provider errors, copy only validated cost fields and the durable invocation ID. Clamp adapter-provided `responseMaxBytes` with `Math.min(operationCap, adapterValue)` and enforce both `Content-Length` and streamed byte totals.

- [ ] **Step 5: Run GREEN and commit**

Run: `cd products/liteasy/services/api && node --test src/visualizationProviderGateway.test.mjs src/visualizationService.test.mjs src/visualizationRepository.test.mjs && npm test`

Commit: `git commit -m "fix: reconcile visualization provider accounting"`

### Final Follow-Up Verification

- [ ] Run API, admin, and desktop focused tests plus builds.
- [ ] Run `git diff --check` and verify only intended files are committed; preserve existing dirty thin-reading/export files.
- [ ] Generate a scoped review package from the follow-up base to the final head and obtain spec/quality approval before continuing Plan 03.
