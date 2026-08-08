# LiteasyClaw Phase 4 Three-End Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a demo-stage three-end loop: customer desktop software, deployable dev-cloud server APIs, and a lightweight LiteasyClaw internal operations/maintenance console served by the same local dev-cloud process.

**Architecture:** Keep the current desktop app as the customer endpoint and `development/dev-cloud/server.mjs` as the server endpoint. Add a minimal internal operations console under `GET /admin/` plus JSON operations APIs under `/v1/admin/*`, using deterministic demo data already present in dev-cloud so no production database, auth, or deployment security is introduced yet.

**Tech Stack:** React + Tauri desktop, Node.js built-in `http` dev-cloud service, Node test runner for server tests, Vitest for desktop tests.

---

## Scope Boundary

This plan intentionally builds a demo internal operations interface for LiteasyClaw operators/maintainers, not a customer-facing organization workspace and not a production operations backend. It should show the shape of platform governance while avoiding premature implementation of multi-tenant auth, billing, persistent database migrations, object storage, upload/delete permissions, or real operator RBAC.

## File Responsibilities

- `development/dev-cloud/server.mjs`: Owns local dev-cloud HTTP routes, admin HTML shell, and admin JSON payloads.
- `development/dev-cloud/server.test.mjs`: Verifies operations routes, service index discoverability, and payload contracts.
- `docs/qa/phase4-three-end-demo-guide.md`: Explains how non-developers open the three endpoints and what to verify.
- `README.md`: Adds a short pointer from current effect-viewing instructions to the three-end demo guide.
- `docs/superpowers/plans/2026-05-15-liteasyclaw-phase4-three-end-demo.md`: Tracks implementation progress.

### Task 1: Admin Console Service Routes

**Files:**
- Modify: `development/dev-cloud/server.test.mjs`
- Modify: `development/dev-cloud/server.mjs`

- [ ] **Step 1: Add failing admin index test**

Add this test to `development/dev-cloud/server.test.mjs` after the root index test:

```js
test("returns the demo operations console html", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/admin/"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "text/html; charset=utf-8");
  assert.match(response.body, /LiteasyClaw Operations Console/);
  assert.match(response.body, /内部运营与运维后台 Demo/);
  assert.match(response.body, /\/v1\/admin\/governance-dashboard/);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
node --test development/dev-cloud/server.test.mjs
```

Expected: the new operations console test fails because `/admin/` is not implemented or returns JSON/404.

- [ ] **Step 3: Implement admin HTML response**

In `development/dev-cloud/server.mjs`, add a `writeHtml(request, response, statusCode, html)` helper next to `writeJson`, then add this route before the final method/path fallback:

```js
if (method === "GET" && url.pathname === "/admin/") {
  writeHtml(request, response, 200, buildAdminConsoleHtml());
  return;
}
```

Add `buildAdminConsoleHtml()` near other payload builders. It must return a full HTML string containing:

- `LiteasyClaw Operations Console`
- `内部运营与运维后台 Demo`
- `/v1/admin/governance-dashboard`
- links or labels for user desktop `http://127.0.0.1:1420/`, dev-cloud `http://127.0.0.1:8787/`, and operations console `http://127.0.0.1:8787/admin/`

- [ ] **Step 4: Verify operations HTML route passes**

Run:

```bash
node --test development/dev-cloud/server.test.mjs
```

Expected: all server tests pass.

### Task 2: Operations Governance Dashboard API

**Files:**
- Modify: `development/dev-cloud/server.test.mjs`
- Modify: `development/dev-cloud/server.mjs`

- [ ] **Step 1: Add failing dashboard payload test**

Add this test after the admin HTML test:

```js
test("returns the demo admin governance dashboard payload", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/v1/admin/governance-dashboard"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.dashboard.name, "LiteasyClaw Operations Governance Dashboard");
  assert.equal(response.json.dashboard.environment, "local-demo");
  assert.equal(response.json.dashboard.threeEndStatus.desktop.url, "http://127.0.0.1:1420/");
  assert.equal(response.json.dashboard.threeEndStatus.devCloud.url, "http://127.0.0.1:8787/");
  assert.equal(response.json.dashboard.threeEndStatus.adminConsole.url, "http://127.0.0.1:8787/admin/");
  assert.equal(response.json.dashboard.organizations.length, 2);
  assert.equal(response.json.dashboard.auditQueue.pendingReview, 3);
  assert.equal(response.json.dashboard.quota.storageUsedGb, 38);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
node --test development/dev-cloud/server.test.mjs
```

Expected: the dashboard payload test fails because `/v1/admin/governance-dashboard` is missing.

- [ ] **Step 3: Implement dashboard payload**

Add `GET /v1/admin/governance-dashboard` to `development/dev-cloud/server.mjs`. Return deterministic JSON:

```js
{
  dashboard: {
    name: "LiteasyClaw Operations Governance Dashboard",
    environment: "local-demo",
    generatedAt: "2026-05-15T00:00:00Z",
    threeEndStatus: {
      desktop: { label: "客户桌面软件端", url: "http://127.0.0.1:1420/", status: "manual-start" },
      devCloud: { label: "服务器部署端", url: "http://127.0.0.1:8787/", status: "online" },
      adminConsole: { label: "内部运营与运维后台", url: "http://127.0.0.1:8787/admin/", status: "online" }
    },
    organizations: [...],
    auditQueue: { pendingReview: 3, highRisk: 1 },
    quota: { storageUsedGb: 38, storageLimitGb: 100, modelCallsUsed: 4200, modelCallsLimit: 10000 },
    runningTasks: [...]
  }
}
```

Use existing demo organization/governance values where possible; do not add persistence.

- [ ] **Step 4: Add endpoint to service index**

Update `availableEndpoints` to include:

```js
"GET /admin/",
"GET /v1/admin/governance-dashboard"
```

Update root index and unknown-path tests accordingly.

- [ ] **Step 5: Verify dashboard route passes**

Run:

```bash
node --test development/dev-cloud/server.test.mjs
```

Expected: all server tests pass.

### Task 3: Tester Guide for Three-End Demo

**Files:**
- Create: `docs/qa/phase4-three-end-demo-guide.md`
- Modify: `README.md`

- [ ] **Step 1: Write tester guide**

Create `docs/qa/phase4-three-end-demo-guide.md` with these sections:

```md
# LiteasyClaw Phase 4 内部运营与运维后台 Demo 验收指南

## 1. 三端分别是什么

- 客户桌面软件端：`http://127.0.0.1:1420/` 或 Tauri 桌面窗口
- 服务器部署端：`http://127.0.0.1:8787/`
- 内部运营与运维后台：`http://127.0.0.1:8787/admin/`

## 2. 启动顺序

1. 启动开发云：`node /home/octopus/Liteasy/development/dev-cloud/server.mjs`
2. 启动桌面前端：`cd /home/octopus/Liteasy/products/liteasy/apps/desktop && npm run dev`
3. 浏览器打开内部运营与运维后台：`http://127.0.0.1:8787/admin/`

## 3. 内部运营与运维后台应该看到什么

- `LiteasyClaw Operations Console`
- `内部运营与运维后台 Demo`
- 客户桌面端、服务器部署端、内部运营/运维后台链接和状态
- 组织、配额、任务和审计队列摘要

## 4. 当前不是生产运维后台

当前内部运营与运维后台没有真实登录、RBAC、数据库写入、计费、对象存储或真实组织权限。它只用于 demo 阶段验证三端边界。
```

- [ ] **Step 2: Link guide from README**

In `README.md`, add `docs/qa/phase4-three-end-demo-guide.md` under the QA guide list and mention `http://127.0.0.1:8787/admin/` in the effect-viewing section.

- [ ] **Step 3: Verify docs mention all three endpoints**

Run:

```bash
rg -n "127.0.0.1:1420|127.0.0.1:8787/admin|内部运营与运维后台 Demo" README.md docs/qa/phase4-three-end-demo-guide.md
```

Expected: all three endpoint references are present.

### Task 4: Final Three-End Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-05-15-liteasyclaw-phase4-three-end-demo.md`

- [ ] **Step 1: Run server tests**

Run:

```bash
node --test development/dev-cloud/server.test.mjs development/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: all server tests pass.

- [ ] **Step 2: Run desktop tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test
```

Expected: all desktop tests pass.

- [ ] **Step 3: Run desktop build**

Run:

```bash
cd products/liteasy/apps/desktop && npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: Record verification evidence**

Append a short verification note to this plan with exact test counts from the commands above.

## Verification Record

- [x] `node --test development/dev-cloud/server.test.mjs development/dev-cloud/providers/openaiResponses.test.mjs` passed with 19 server/provider tests.
- [x] `cd products/liteasy/apps/desktop && npm test` passed with 62 desktop test files and 219 tests.
- [x] `cd products/liteasy/apps/desktop && npm run build` passed through TypeScript and Vite production build.

## Completed Scope

- [x] `GET /admin/` serves a lightweight `LiteasyClaw Operations Console` HTML page for the internal operations/maintenance endpoint.
- [x] `GET /v1/admin/governance-dashboard` returns deterministic three-end, organization, quota, task, and audit summary JSON.
- [x] Root service index advertises `GET /admin/` and `GET /v1/admin/governance-dashboard`.
- [x] `docs/qa/phase4-three-end-demo-guide.md` documents how to open the user desktop endpoint, dev-cloud endpoint, and operations endpoint.

## Follow-up: Admin Console Readable Dashboard

- [x] `GET /admin` is accepted as an alias for `GET /admin/`, so browsers no longer show `not_found` when the trailing slash is omitted.
- [x] The operations console HTML now renders the governance dashboard data directly: three-end status, quota metrics, organization spaces, running tasks, and recent audit events.
- [x] Root service index advertises both `GET /admin` and `GET /admin/`.
- [x] Verification: `node --test development/dev-cloud/server.test.mjs development/dev-cloud/providers/openaiResponses.test.mjs` passed with 20 server/provider tests.
- [x] Verification: `cd products/liteasy/apps/desktop && npm test && npm run build` passed with 62 desktop test files, 219 desktop tests, and a successful production build.

## Follow-up: Shared Library Manifest Opening

- [x] `POST /v1/org/shared-library/manifest` returns a deterministic folder/document manifest for organization shared libraries.
- [x] Root service index advertises the shared-library manifest endpoint for desktop diagnostics.
- [x] Desktop shared-library opening now loads the manifest before replacing the workspace, so the organization summary can remain lightweight while the workspace opens from a directory-shaped payload.
- [x] The organization sidebar keeps an available shared library openable when the summary exposes only `documentCount` and no inline document list.
- [x] Verification: `node --test development/dev-cloud/server.test.mjs development/dev-cloud/providers/openaiResponses.test.mjs` passed with 21 server/provider tests.
- [x] Verification: `cd products/liteasy/apps/desktop && npm test` passed with 63 desktop test files and 223 tests.
- [x] Verification: `cd products/liteasy/apps/desktop && npm run build` passed through TypeScript and Vite production build.

## Follow-up: Admin Role Boundary Correction

- [x] Reframed `/admin` as the LiteasyClaw internal operations/maintenance console, not a customer-facing organization space.
- [x] Updated dashboard labels so the desktop endpoint is the customer software endpoint and the operations endpoint is the internal operations backend.
- [x] Added internal-ops sections for API policy and user/account overview so `/admin` is about platform configuration and resource/customer operations rather than customer organization work.
- [x] Updated QA docs and README to state that customers use the desktop app, while LiteasyClaw operations/maintenance staff use the admin page to configure APIs, manage resources, and inspect user/organization status.
- [x] Verification: `node --test development/dev-cloud/server.test.mjs development/dev-cloud/providers/openaiResponses.test.mjs` passed with 21 server/provider tests after the role-boundary correction.
- [x] Verification: `cd products/liteasy/apps/desktop && npm test && npm run build` passed with 63 desktop test files, 223 desktop tests, and a successful production build.

## Follow-up: Operations API Policy Configuration

- [x] Root service index advertises `POST /v1/admin/model-policy` as the internal-operations policy update endpoint.
- [x] `POST /v1/admin/model-policy` updates the demo policy for a long-lived dev-cloud handler and returns `updatedBy: internal-ops-demo`.
- [x] The operations console now includes an `运维下发 API 策略` form that posts to `/v1/admin/model-policy`.
- [x] Shared-library workspace opening now uses inline summary documents immediately and only fetches the manifest when the summary is lightweight, avoiding dev-server hangs in offline tests while preserving the manifest-backed path.
- [x] QA docs include both browser-form and curl verification paths for policy updates.
- [x] Verification: `node --test development/dev-cloud/server.test.mjs development/dev-cloud/providers/openaiResponses.test.mjs` passed with 22 server/provider tests.
- [x] Verification: `cd products/liteasy/apps/desktop && npm test && npm run build` passed with 63 desktop test files, 223 desktop tests, and a successful production build.
