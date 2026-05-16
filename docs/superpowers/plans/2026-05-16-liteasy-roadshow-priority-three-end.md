# Liteasy Roadshow-Priority Three-End Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a stable, presentable three-end Liteasy roadshow slice with a stronger internal operations console, resettable demo data, and repeatable smoke checks.

**Architecture:** This plan does not expand the formal SaaS model further. It strengthens the current three-end demo by making the dev-cloud service expose real aggregated demo state, by adding reset/reseed operations, and by turning `/admin/` into a more convincing internal operations surface that reflects actual collection, recommendation-cache, organization, and session state.

**Tech Stack:** Node.js, existing `services/dev-cloud` route split, JSON-file demo persistence, React desktop frontend, QA markdown docs

---

## File Responsibilities

### Dev-cloud data and scripts

- `services/dev-cloud/db/jsonFileStore.mjs`
  - shared JSON persistence utilities
- `services/dev-cloud/db/collectionRepository.mjs`
  - collection counts and list data
- `services/dev-cloud/db/recommendationCacheRepository.mjs`
  - recommendation-cache counts and scope data
- `services/dev-cloud/db/organizationRepository.mjs`
  - organization counts and role sample data
- `services/dev-cloud/db/sessionRepository.mjs`
  - active session tracking
- `services/dev-cloud/db/adminActivityRepository.mjs`
  - recent internal operations and recent customer-side activity feed
- `scripts/reset-demo-data.mjs`
  - clear or reset current demo data
- `scripts/reseed-demo-data.mjs`
  - write deterministic baseline demo data
- `scripts/smoke-roadshow.mjs`
  - roadshow smoke-check script

### Dev-cloud route/payload layer

- `services/dev-cloud/payloads/adminDemoStatePayloads.mjs`
  - aggregate operations-console state payload
- `services/dev-cloud/payloads/adminDemoActionPayloads.mjs`
  - demo reset / reseed / cache clear payloads
- `services/dev-cloud/adminConsole.mjs`
  - render the upgraded internal operations console
- `services/dev-cloud/requestHandler.mjs`
  - route wiring for new admin endpoints
- `services/dev-cloud/server.test.mjs`
  - route and payload tests
- `services/dev-cloud/README.md`
  - updated server usage and roadshow reset/reseed guidance

### Docs

- `docs/qa/roadshow-demo-guide.md`
- `docs/qa/final-demo-handoff.md`
- `docs/qa/environment-startup-guide.md`

## Task 1: Add Resettable Demo Data and Activity Repositories

**Files:**
- Create: `services/dev-cloud/db/sessionRepository.mjs`
- Create: `services/dev-cloud/db/adminActivityRepository.mjs`
- Modify: `services/dev-cloud/db/collectionRepository.mjs`
- Modify: `services/dev-cloud/db/recommendationCacheRepository.mjs`
- Modify: `services/dev-cloud/db/organizationRepository.mjs`
- Create: `scripts/reset-demo-data.mjs`
- Create: `scripts/reseed-demo-data.mjs`
- Test: `services/dev-cloud/server.test.mjs`

- [ ] **Step 1: Write the failing server tests for resettable demo state**

Add tests that express the new repository expectations:

```js
test("returns a non-empty admin demo state summary after reseed", async () => {
  const handler = createDevCloudRequestHandler();

  const response = await invokeHandler({
    method: "GET",
    headers: { host: "127.0.0.1:8787" },
    url: "/v1/admin/demo-state"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.json.summary.organizationCount, "number");
  assert.equal(typeof response.json.summary.collectionItemCount, "number");
  assert.equal(typeof response.json.summary.recommendationCacheEntryCount, "number");
});
```

Add a companion test:

```js
test("resets demo state through the admin reset endpoint", async () => {
  const handler = createDevCloudRequestHandler();

  const resetResponse = await invokeHandler({
    body: JSON.stringify({}),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/admin/demo-reset"
  });

  assert.equal(resetResponse.statusCode, 200);
  assert.equal(resetResponse.json.reset, true);
});
```

- [ ] **Step 2: Run the focused server test to verify failure**

Run:

```bash
node --test services/dev-cloud/server.test.mjs
```

Expected: FAIL because session/admin-activity repositories and demo reset/state endpoints do not exist yet.

- [ ] **Step 3: Add lightweight repositories and reset/reseed scripts**

Add:

- `sessionRepository.mjs`
  - track session id, user label, last active time
- `adminActivityRepository.mjs`
  - append recent actions and list recent actions
- `reset-demo-data.mjs`
  - reset JSON files to empty or base state
- `reseed-demo-data.mjs`
  - repopulate stable demo organizations, sample collection, sample cache, sample sessions, and sample activity

Keep these files narrowly focused on storage and seeded state only.

- [ ] **Step 4: Re-run the server tests to verify green**

Run:

```bash
node --test services/dev-cloud/server.test.mjs
```

Expected: PASS for the new data-state expectations after the implementation is complete.

- [ ] **Step 5: Commit the reset/reseed data foundation**

```bash
git add services/dev-cloud/db services/dev-cloud/server.test.mjs scripts/reset-demo-data.mjs scripts/reseed-demo-data.mjs
git commit -m "feat: add resettable roadshow demo data foundation"
```

## Task 2: Expose Admin Demo-State and Admin Demo Actions

**Files:**
- Create: `services/dev-cloud/payloads/adminDemoStatePayloads.mjs`
- Create: `services/dev-cloud/payloads/adminDemoActionPayloads.mjs`
- Modify: `services/dev-cloud/requestHandler.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [ ] **Step 1: Write failing route tests for new admin endpoints**

Add tests for:

- `GET /v1/admin/demo-state`
- `POST /v1/admin/demo-reset`
- `POST /v1/admin/demo-reseed`
- `POST /v1/admin/recommendation-cache/clear`

Example:

```js
test("clears recommendation cache through the admin cache-clear endpoint", async () => {
  const handler = createDevCloudRequestHandler();

  const response = await invokeHandler({
    body: JSON.stringify({
      selectionKey: "demo-2",
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: "local:/tmp/LiteasyLibrary"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/admin/recommendation-cache/clear"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.cleared, true);
});
```

- [ ] **Step 2: Run the server tests to verify failure**

Run:

```bash
node --test services/dev-cloud/server.test.mjs
```

Expected: FAIL because these admin endpoints are not wired yet.

- [ ] **Step 3: Add admin-state and admin-action payload builders**

`adminDemoStatePayloads.mjs` must aggregate:

- active session count
- organization count
- collection item count
- recommendation-cache entry count
- current policy version
- recent activity list

`adminDemoActionPayloads.mjs` must implement:

- demo reset
- demo reseed
- admin recommendation-cache clear

These payload builders must depend on repositories and scripts/helpers, not on route-layer logic.

- [ ] **Step 4: Wire the new endpoints into `requestHandler.mjs`**

Add:

- `GET /v1/admin/demo-state`
- `POST /v1/admin/demo-reset`
- `POST /v1/admin/demo-reseed`
- `POST /v1/admin/recommendation-cache/clear`

Preserve the existing admin model-policy path.

- [ ] **Step 5: Re-run the full dev-cloud test suite**

Run:

```bash
node --test services/dev-cloud/server.test.mjs services/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: PASS

- [ ] **Step 6: Commit the new admin endpoints**

```bash
git add services/dev-cloud/payloads services/dev-cloud/requestHandler.mjs services/dev-cloud/server.test.mjs
git commit -m "feat: expose roadshow admin demo-state and control endpoints"
```

## Task 3: Upgrade `/admin/` Into a Realer Operations Console

**Files:**
- Modify: `services/dev-cloud/adminConsole.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [ ] **Step 1: Write failing admin-console tests for live demo state**

Add test expectations for `/admin/` HTML and `/v1/admin/governance-dashboard` JSON to include roadshow-relevant state such as:

- active session count
- collection item count
- recommendation-cache entry count
- recent activity
- reset / reseed control copy

Example assertions:

```js
assert.match(response.body, /活跃会话数/);
assert.match(response.body, /收藏总数/);
assert.match(response.body, /推荐缓存条目数/);
assert.match(response.body, /重置 Demo 数据/);
assert.match(response.body, /重新播种 Demo 数据/);
```

- [ ] **Step 2: Run the server tests to verify failure**

Run:

```bash
node --test services/dev-cloud/server.test.mjs
```

Expected: FAIL because the current admin console does not show the new state or action copy.

- [ ] **Step 3: Upgrade the admin dashboard payload and HTML**

The admin console must show:

- three-end links
- current policy version
- active sessions
- organization count
- collection item count
- recommendation-cache entry count
- recent activity timeline
- operation buttons/forms for:
  - save policy
  - clear recommendation cache
  - reset demo
  - reseed demo

Do not turn this into a customer organization admin backend.

- [ ] **Step 4: Re-run the server tests to verify green**

Run:

```bash
node --test services/dev-cloud/server.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit the admin console enhancement**

```bash
git add services/dev-cloud/adminConsole.mjs services/dev-cloud/server.test.mjs
git commit -m "feat: upgrade roadshow operations console with live state"
```

## Task 4: Add a Roadshow Smoke Script

**Files:**
- Create: `scripts/smoke-roadshow.mjs`
- Modify: `services/dev-cloud/README.md`

- [ ] **Step 1: Write the failing smoke script expectation in docs or tests**

Add a README section or script usage expectation describing that the script must verify:

- `/`
- `/healthz`
- `/admin/`
- `/v1/admin/demo-state`

Example command:

```bash
node scripts/smoke-roadshow.mjs http://127.0.0.1:8787
```

- [ ] **Step 2: Run the script path to verify failure**

Run:

```bash
node scripts/smoke-roadshow.mjs http://127.0.0.1:8787
```

Expected: FAIL because the script does not exist yet.

- [ ] **Step 3: Add the smoke script**

Implementation requirements:

- accept base URL as first arg
- fetch and validate:
  - `/`
  - `/healthz`
  - `/admin/`
  - `/v1/admin/demo-state`
- non-zero exit on failure
- concise human-readable output

- [ ] **Step 4: Run the smoke script against the local dev-cloud**

Run:

```bash
node scripts/smoke-roadshow.mjs http://127.0.0.1:8787
```

Expected: PASS when dev-cloud is running locally.

- [ ] **Step 5: Commit the smoke script**

```bash
git add scripts/smoke-roadshow.mjs services/dev-cloud/README.md
git commit -m "feat: add roadshow smoke-check script"
```

## Task 5: Update Roadshow and Handoff Docs

**Files:**
- Modify: `docs/qa/roadshow-demo-guide.md`
- Modify: `docs/qa/final-demo-handoff.md`
- Modify: `docs/qa/environment-startup-guide.md`

- [ ] **Step 1: Update docs to reflect the stronger three-end story**

Required additions:

- admin console now shows live demo state, not only static framing
- reset / reseed path before a presentation
- smoke-roadshow script usage
- recommendation-cache clear as an operations action

- [ ] **Step 2: Verify the docs mention the new roadshow controls**

Run:

```bash
rg -n "demo-state|demo-reset|demo-reseed|smoke-roadshow|推荐缓存|运维端" docs/qa/roadshow-demo-guide.md docs/qa/final-demo-handoff.md docs/qa/environment-startup-guide.md
```

Expected: matches for the new operations console and reset/reseed guidance.

- [ ] **Step 3: Commit the roadshow docs**

```bash
git add docs/qa/roadshow-demo-guide.md docs/qa/final-demo-handoff.md docs/qa/environment-startup-guide.md
git commit -m "docs: align roadshow docs with three-end demo controls"
```

## Final Verification

- [ ] **Step 1: Run the dev-cloud test suite**

```bash
node --test services/dev-cloud/server.test.mjs services/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: PASS

- [ ] **Step 2: Run the desktop test suite**

```bash
cd desktop && npm test
```

Expected: PASS

- [ ] **Step 3: Run the desktop build**

```bash
cd desktop && npm run build
```

Expected: PASS

- [ ] **Step 4: Run the smoke script against local dev-cloud**

```bash
node scripts/smoke-roadshow.mjs http://127.0.0.1:8787
```

Expected: PASS

- [ ] **Step 5: Verify the roadshow slice matches the narrative**

Manual checklist:

- desktop, service, and admin console all remain reachable
- admin console shows live state derived from actual demo data files
- presenter can reset and reseed demo state quickly
- recommendation cache and collection counts are visible from operations
- no new customer-facing admin complexity has leaked into desktop
