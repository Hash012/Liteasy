# Thin Reading Multimodal Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the production Liteasy API and administrator controls for provider routes, entitlements, persisted preferences, per-user weighted quotas, reservations, settlement, rollback, and audit.

**Architecture:** A dedicated PostgreSQL repository owns visualization business state and atomic quota transitions. A service layer composes identity, route health, built-in modality deployment, provider invocation, and artifact submission. The desktop receives a fail-closed capability projection; only the existing `platform_admin` role receives exact usage and control-plane data.

**Tech Stack:** Node.js 20, PostgreSQL, existing transaction/idempotency/audit helpers, S3 boundary, React 18, Fluent UI 9, Vitest, Node test runner.

## Global Constraints

- Formal implementation belongs in `products/liteasy/services/api/`; production code must not import `development/`.
- Reuse existing `platform_admin`; do not add a `deployment_admin` role.
- Database stores `secretRef`, never key/token/password material.
- Identity Service verifies identity lifecycle; Liteasy API owns entitlement, preference, quota, provider, and usage tables.
- Liteasy and Intuecho keep separate pools and credentials.
- Provider/system/validation failure, cancellation, timeout, or revocation rolls back all user units.
- Provider operational cost is recorded separately from the user usage ledger.
- Admin mutations require fresh MFA, revision, idempotency key, reason, and append-only audit.
- Capability failures fail closed for generation; source figures remain available under document access rules.

---

### Task 1: Visualization Control-Plane Migration

**Files:**
- Create: `products/liteasy/services/api/migrations/020_visualization_control_plane.sql`
- Modify: `products/liteasy/services/api/src/migrations.test.mjs`
- Test: `products/liteasy/services/api/src/visualizationMigration.test.mjs`

**Interfaces:**
- Produces: provider config, entitlement, preference, quota policy, reservation, invocation, user ledger, provider cost ledger, artifact tables.
- Consumed by: `PostgresVisualizationRepository` in Task 2.

- [ ] **Step 1: Write a failing migration contract test**

```js
test("visualization migration defines separate user and provider ledgers", async () => {
  const sql = await readFile(new URL("../migrations/020_visualization_control_plane.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE visualization_usage_ledger/);
  assert.match(sql, /CREATE TABLE visualization_provider_cost_ledger/);
  assert.match(sql, /UNIQUE \(subject_id, idempotency_key\)/);
  assert.doesNotMatch(sql, /storage_quotas/);
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/services/api && node --test src/visualizationMigration.test.mjs`

Expected: FAIL because migration 020 does not exist.

- [ ] **Step 3: Add constrained tables and indexes**

The migration must include exact state constraints, not free-form strings:

```sql
CREATE TABLE visualization_quota_reservations (
  reservation_id text PRIMARY KEY,
  subject_id text NOT NULL,
  idempotency_key text NOT NULL,
  modality text NOT NULL,
  route_id text NOT NULL,
  route_revision bigint NOT NULL CHECK (route_revision > 0),
  policy_revision bigint NOT NULL CHECK (policy_revision > 0),
  reserved_units integer NOT NULL CHECK (reserved_units > 0),
  settled_units integer CHECK (settled_units >= 0 AND settled_units <= reserved_units),
  state text NOT NULL CHECK (state IN ('reserved','settled','rolled_back','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, idempotency_key)
);
```

Use separate tables for `visualization_provider_invocations` and `visualization_provider_cost_ledger`. Add immutable ledger triggers or revoke UPDATE/DELETE privileges through the repository role migration pattern. Add indexes for active reservations, per-user window usage, route health, and artifact node lookup.

- [ ] **Step 4: Register migration 020 and verify**

Run: `cd products/liteasy/services/api && node --test src/migrations.test.mjs src/visualizationMigration.test.mjs`

Expected: PASS with migration head `020_visualization_control_plane.sql`.

- [ ] **Step 5: Commit**

```bash
git add products/liteasy/services/api/migrations/020_visualization_control_plane.sql products/liteasy/services/api/src/migrations.test.mjs products/liteasy/services/api/src/visualizationMigration.test.mjs
git commit -m "feat: add visualization control plane schema"
```

### Task 2: Atomic Entitlement, Preference, And Quota Repository

**Files:**
- Create: `products/liteasy/services/api/src/visualizationRepository.mjs`
- Create: `products/liteasy/services/api/src/testSupport/visualizationTestPool.mjs`
- Create: `products/liteasy/services/api/src/visualizationRepository.test.mjs`
- Modify: `products/liteasy/services/api/src/accountLifecycleRepository.mjs`
- Test: `products/liteasy/services/api/src/accountLifecycleService.test.mjs`

**Interfaces:**
- Produces: `PostgresVisualizationRepository` methods `capability()`, `setPreference()`, `getEntitlement()`, `setEntitlement()`, `listQuotaPolicies()`, `setQuotaPolicy()`, `reserve()`, `settle()`, `rollback()`, `recordProviderCost()`, `findReusableArtifact()`, and `recordCacheReuse()`.
- Consumes: stable identity subject and existing `withPostgresTransaction()`.
- Test support exports `createVisualizationTestPool()` and a transaction-cleanup helper using the repository's existing test database harness.

- [ ] **Step 1: Write failing repository transition tests**

```js
const pool = createVisualizationTestPool();
const subject = { subjectId: "user-1" };
const request = (overrides = {}) => ({
  idempotencyKey: "request-1", modality: "semantic_graph", routeId: "route-1", units: 4, ...overrides
});

test("reserve atomically enforces daily, monthly, and concurrency limits", async () => {
  const repository = new PostgresVisualizationRepository(pool);
  const first = await repository.reserve(subject, request({ units: 4 }));
  assert.equal(first.reservation.state, "reserved");
  await assert.rejects(
    repository.reserve(subject, request({ idempotencyKey: "request-2", units: 4 })),
    /visualization_quota_exceeded/
  );
});

test("rollback refunds all user units and retains provider cost separately", async () => {
  const reservationId = "reservation-1";
  const providerCostRows = [{ routeId: "route-1", amount: 0.02 }];
  await repository.rollback(subject, { reasonCode: "validation_failed", reservationId, traceId });
  assert.equal((await repository.capability(subject)).quota.usedUnits, 0);
  assert.equal(providerCostRows.length, 1);
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/services/api && node --test src/visualizationRepository.test.mjs`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement strict inputs and locked reservation transaction**

```js
async reserve(subjectInput, input) {
  const subjectId = subject(subjectInput);
  return withPostgresTransaction(this.pool, async (client) => {
    const entitlement = await lockEntitlement(client, subjectId);
    const policy = await lockQuotaPolicy(client, subjectId);
    await expireReservations(client, subjectId);
    const usage = await currentWindowUsage(client, subjectId, policy);
    assertReservationAllowed({ entitlement, input, policy, usage });
    return insertReservation(client, { ...input, policy, subjectId });
  });
}
```

Use exact-field validation, normalized IDs, IANA timezone validation, `FOR UPDATE`, stable request hashes, and existing idempotency semantics. Reusing an idempotency key with different input returns `409`.

- [ ] **Step 4: Preserve preference across revocation and delete it with account deletion**

First grant inserts `enabled = true` only when no preference row exists. Revocation leaves the preference row. Re-grant restores it. Extend account deletion cleanup to delete preference/artifact business rows while preserving the minimum audit/usage retention required by policy.

The cache key includes tenant/document boundary, evidence hash, spec hash, locale, Skill/Kernel/Renderer versions, and the hard-validator set. `findReusableArtifact()` rechecks current entitlement, modality whitelist, document access, and source identity; a hit writes a zero-unit `cache_reuse` event without invoking a provider.

- [ ] **Step 5: Run repository and lifecycle tests, then commit**

Run: `cd products/liteasy/services/api && node --test src/visualizationRepository.test.mjs src/accountLifecycleService.test.mjs`

Expected: PASS.

```bash
git add products/liteasy/services/api/src/visualizationRepository.mjs products/liteasy/services/api/src/visualizationRepository.test.mjs products/liteasy/services/api/src/accountLifecycleRepository.mjs products/liteasy/services/api/src/accountLifecycleService.test.mjs
git commit -m "feat: govern visualization quotas"
```

### Task 3: Secret References, Provider Routes, And Circuit Breaker

**Files:**
- Create: `products/liteasy/services/api/src/visualizationSecretStore.mjs`
- Create: `products/liteasy/services/api/src/visualizationProviderGateway.mjs`
- Create: `products/liteasy/services/api/src/visualizationCircuitBreaker.mjs`
- Create: `products/liteasy/services/api/src/visualizationProviderGateway.test.mjs`
- Modify: `products/liteasy/services/api/src/config.mjs`
- Modify: `products/liteasy/services/api/src/config.test.mjs`
- Modify: `products/liteasy/services/api/.env.example`

**Interfaces:**
- Produces: `EnvironmentVisualizationSecretStore.resolve(secretRef)`, `VisualizationProviderGateway.generateStructured()`, `generateImage()`, `testRoute()`.
- Consumes: provider route revision from Task 2; `AbortSignal` from request/Agent cancellation.
- Test fixtures: `route` is a complete normalized route object, `gatewayWithFailingAdapter({ threshold })` returns a gateway with an in-memory adapter, `failThreeCalls()` invokes it three times, and `probeRequests` records redacted circuit probes.

- [ ] **Step 1: Write failing security and routing tests**

```js
test("never accepts credential material in a route mutation", () => {
  assert.throws(() => normalizeRoute({ ...route, apiKey: "secret" }), /secret_material_forbidden/);
});

test("opens the circuit after consecutive route failures without leaking paper content", async () => {
  const gateway = gatewayWithFailingAdapter({ threshold: 3 });
  await failThreeCalls(gateway);
  await assert.rejects(gateway.generateStructured(request), /visualization_route_circuit_open/);
  assert.equal(probeRequests.every((probe) => probe.prompt === undefined), true);
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/services/api && node --test src/visualizationProviderGateway.test.mjs src/config.test.mjs`

Expected: FAIL because gateway and secret store do not exist.

- [ ] **Step 3: Implement environment-backed secret references**

```js
export class EnvironmentVisualizationSecretStore {
  constructor(entries) { this.entries = new Map(Object.entries(entries)); }
  resolve(secretRef) {
    if (!/^viz-secret:[a-z0-9._-]{1,80}$/.test(secretRef)) throw new Error("secret_ref_invalid");
    const value = this.entries.get(secretRef);
    if (!value) throw new Error("secret_ref_unavailable");
    return value;
  }
}
```

Parse deployment secrets from a deployment-only JSON environment variable and never include values in readiness, logs, admin responses, fixtures, or error details. `.env.example` documents only the variable name and JSON shape with redacted values.

- [ ] **Step 4: Implement route normalization, egress checks, and adapter isolation**

Allow HTTPS endpoints by default. Resolve DNS and validate every redirect against the deployment egress policy. Route selection intersects operation, modality, data class, enabled state, circuit state, priority, and concurrency. Provider adapters return only Liteasy normalized text/image results.

`testRoute()` performs only connectivity, authentication, declared-capability, and redacted health checks; it never reserves user units, sends paper content, creates an artifact, or appends a user usage event.

- [ ] **Step 5: Run and commit**

Run: `cd products/liteasy/services/api && node --test src/visualizationProviderGateway.test.mjs src/config.test.mjs`

Expected: PASS.

```bash
git add products/liteasy/services/api/src/visualizationSecretStore.mjs products/liteasy/services/api/src/visualizationProviderGateway.mjs products/liteasy/services/api/src/visualizationCircuitBreaker.mjs products/liteasy/services/api/src/visualizationProviderGateway.test.mjs products/liteasy/services/api/src/config.mjs products/liteasy/services/api/src/config.test.mjs products/liteasy/services/api/.env.example
git commit -m "feat: add visualization provider gateway"
```

### Task 4: Visualization Service And HTTP Routes

**Files:**
- Create: `products/liteasy/services/api/src/visualizationService.mjs`
- Create: `products/liteasy/services/api/src/visualizationRoutes.mjs`
- Create: `products/liteasy/services/api/src/visualizationService.test.mjs`
- Modify: `products/liteasy/services/api/src/runtime.mjs`
- Modify: `products/liteasy/services/api/src/runtime.test.mjs`
- Modify: `products/liteasy/services/api/src/server.mjs`
- Modify: `products/liteasy/services/api/src/server.test.mjs`

**Interfaces:**
- Produces: account capability/preference endpoints, admin endpoints, internal reserve/generate/validate/commit service methods.
- Consumes: repository and provider gateway from Tasks 2-3, existing identity verifier, `platformAdminRepository.principal()` and fresh MFA guard.
- Test fixtures: `userToken`, `response`, `staleAdmin`, `call()`, and `jsonBody()` are imported from the existing API HTTP test harness; `handler` is the route handler under test.

- [ ] **Step 1: Write failing endpoint tests**

```js
const httpRequest = (method, path, token) => ({ method, path, headers: { authorization: `Bearer ${token}` }, body: null });
const expectCapability = (overrides = {}) => ({ allowed: false, enabled: false, serviceAvailable: false, quota: { available: false }, availableModalities: [], ...overrides });

test("account capabilities fail closed while preserving developer diagnostics", async () => {
  await handler(httpRequest("GET", "/v1/account/capabilities", userToken), response);
  assert.deepEqual(jsonBody(response), {
    developerDiagnostics: false,
    multimodalVisualization: expectCapability({ allowed: false, enabled: false })
  });
});

test("only a fresh platform admin can change an entitlement", async () => {
  const result = await call("POST", "/v1/admin/visualization/entitlements/set", staleAdmin);
  assert.equal(result.status, 403);
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/services/api && node --test src/visualizationService.test.mjs src/server.test.mjs`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement authoritative service transitions**

```js
async generate(principal, input, context) {
  const reservation = await this.repository.reserve(principal.subjectId, input.reservation);
  try {
    const result = await this.gateway.generateStructured(input.providerRequest, context.signal);
    return { reservation, result };
  } catch (error) {
    await this.repository.rollback(principal.subjectId, {
      reasonCode: mapFailure(error), reservationId: reservation.reservationId, traceId: context.traceId
    });
    throw error;
  }
}
```

Submission must re-read entitlement, preference, route revision, source-document access, and cancellation state before atomically settling and saving. Late provider responses after cancellation are discarded.

- [ ] **Step 4: Register focused route module**

`server.mjs` delegates `/v1/admin/visualization/*`, `/v1/account/preferences/multimodal-visualization/set`, and internal visualization generation paths to `visualizationRoutes.mjs`. Do not expand the existing model proxy allowlist or expose provider calls directly to the desktop.

- [ ] **Step 5: Run API suite and commit**

Run: `cd products/liteasy/services/api && npm test`

Expected: all Node tests PASS.

```bash
git add products/liteasy/services/api/src/visualizationService.mjs products/liteasy/services/api/src/visualizationRoutes.mjs products/liteasy/services/api/src/visualizationService.test.mjs products/liteasy/services/api/src/runtime.mjs products/liteasy/services/api/src/runtime.test.mjs products/liteasy/services/api/src/server.mjs products/liteasy/services/api/src/server.test.mjs
git commit -m "feat: expose visualization governance API"
```

### Task 5: Desktop Capability And Preference Clients

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/account/accountCapabilitiesClient.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/account/useAccountCapabilities.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationControlPlaneClient.ts`
- Modify: `products/liteasy/apps/desktop/src/app/controllers/useCloudAccountController.ts`
- Test: `products/liteasy/apps/desktop/src/tests/accountCapabilitiesClient.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useAccountCapabilities.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/visualizationControlPlaneClient.test.ts`

**Interfaces:**
- Produces: `MultimodalVisualizationCapability`, `setMultimodalVisualizationPreference(enabled)`, fail-closed hook state.
- Consumed by: reader integration plan.
- Test fixtures: `loadAccountCapabilities`, `renderCapabilityHook`, `waitFor`, and the transport object in the snippet are imported from the desktop account test harness.

- [ ] **Step 1: Write failing compatibility tests**

```ts
const unavailableMultimodalCapability = { allowed: false, enabled: false, serviceAvailable: false, quota: { available: false }, availableModalities: [] };
const oldServerInput = { developerDiagnostics: false };
const successThenFailureTransport = {
  calls: 0,
  async getCapabilities() {
    this.calls += 1;
    if (this.calls === 1) return { multimodalVisualization: { allowed: true, enabled: true, serviceAvailable: true, quota: { available: true }, availableModalities: ["semantic_graph"] } };
    throw new Error("network");
  }
};

test("treats an old capability response as generation unavailable", async () => {
  await expect(loadAccountCapabilities(oldServerInput)).resolves.toEqual({
    developerDiagnostics: false,
    multimodalVisualization: unavailableMultimodalCapability
  });
});

test("does not retain a stale allowed capability after refresh fails", async () => {
  const { result, rerender } = renderCapabilityHook(successThenFailureTransport);
  await waitFor(() => expect(result.current.multimodalVisualization.allowed).toBe(true));
  rerender();
  await waitFor(() => expect(result.current.multimodalVisualization.allowed).toBe(false));
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/accountCapabilitiesClient.test.ts src/tests/useAccountCapabilities.test.ts`

Expected: FAIL because multimodal capability is absent.

- [ ] **Step 3: Implement strict nested parsing with an old-server fallback**

Validate every modality against the generated modality allowlist. Unknown nested fields or invalid values make only multimodal generation unavailable; `developerDiagnostics` remains usable.

- [ ] **Step 4: Add authenticated, idempotent preference mutation**

```ts
export async function setMultimodalVisualizationPreference(input: {
  enabled: boolean;
  endpoint: string;
  sessionId: string;
  transport?: VisualizationControlPlaneTransport;
}) {
  return request({
    body: { enabled: input.enabled, idempotencyKey: crypto.randomUUID() },
    path: "/v1/account/preferences/multimodal-visualization/set"
  });
}
```

- [ ] **Step 5: Run and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/accountCapabilitiesClient.test.ts src/tests/useAccountCapabilities.test.ts src/tests/visualizationControlPlaneClient.test.ts src/tests/useCloudAccountController.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/account products/liteasy/apps/desktop/src/app/features/visualization/visualizationControlPlaneClient.ts products/liteasy/apps/desktop/src/app/controllers/useCloudAccountController.ts products/liteasy/apps/desktop/src/tests
git commit -m "feat: load multimodal account capability"
```

### Task 6: Fluent Administrator Control Surface

**Files:**
- Create: `products/liteasy/apps/admin/src/VisualizationGovernanceView.tsx`
- Modify: `products/liteasy/apps/admin/src/AdminWorkspace.tsx`
- Modify: `products/liteasy/apps/admin/src/api.ts`
- Modify: `products/liteasy/apps/admin/src/types.ts`
- Modify: `products/liteasy/apps/admin/src/styles.css`
- Test: `products/liteasy/apps/admin/src/tests/VisualizationGovernanceView.test.tsx`
- Test: `products/liteasy/apps/admin/src/tests/api.test.ts`

**Interfaces:**
- Produces: provider route table/editor/test action, user entitlement editor, quota policy editor, usage/audit filters.
- Consumes: admin routes from Task 4.

- [ ] **Step 1: Write failing role and interaction tests**

```tsx
test("saves a user entitlement with revision, reason, and idempotency", async () => {
  const user = userEvent.setup();
  render(<VisualizationGovernanceView api={api} principal={platformAdmin} />);
  await user.type(screen.getByLabelText("用户 ID"), "user-1");
  await user.click(screen.getByRole("button", { name: "查询" }));
  await user.click(screen.getByRole("switch", { name: "允许生成" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(api.setVisualizationEntitlement).toHaveBeenCalledWith(expect.objectContaining({
    expectedRevision: 3,
    subjectId: "user-1"
  }));
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/admin && npm test -- src/tests/VisualizationGovernanceView.test.tsx src/tests/api.test.ts`

Expected: FAIL because the view and API methods do not exist.

- [ ] **Step 3: Implement focused API types and methods**

Use exact `VisualizationProviderRoute`, `VisualizationEntitlement`, `VisualizationQuotaPolicy`, `VisualizationUsageRow` types. Mutation methods attach an idempotency key exactly as existing model-policy and quota calls do.

- [ ] **Step 4: Build the minimal Fluent UI**

Add one activity-bar destination with `DataUsageSettingsRegular`. Use compact tables, `Switch` for enabled state, `Checkbox` for modality permissions, numeric inputs for daily/monthly/concurrency, and icon buttons with `Tooltip` for test/refresh. Put endpoint/model/secret reference and exact usage in an advanced admin section. Do not add reader-facing explanatory prose.

- [ ] **Step 5: Run admin tests and build**

Run: `cd products/liteasy/apps/admin && npm test && npm run build`

Expected: tests and production build PASS.

- [ ] **Step 6: Run cross-product control-plane verification and commit**

Run: `cd products/liteasy/services/api && npm test`

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/accountCapabilitiesClient.test.ts src/tests/useAccountCapabilities.test.ts src/tests/visualizationControlPlaneClient.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/admin products/liteasy/apps/desktop/src/app/features/account products/liteasy/apps/desktop/src/app/features/visualization/visualizationControlPlaneClient.ts products/liteasy/apps/desktop/src/app/controllers/useCloudAccountController.ts products/liteasy/apps/desktop/src/tests products/liteasy/services/api
git commit -m "feat: add visualization administration"
```
