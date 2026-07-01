# LiteasyClaw D1 Deployable Demo Cloud Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a roadshow-ready LiteasyClaw demo environment that can be deployed on a cloud server and exercised reliably by a presenter.

**Architecture:** This plan keeps the existing `desktop` app and current `LiteasyClaw/services/dev-cloud` service shape, but hardens them into a deployment-oriented demo baseline. It focuses on environment configuration, deployability, server start paths, smoke checks, presentation-safe defaults, and documentation, while avoiding work that would be thrown away immediately after the roadshow.

**Tech Stack:** Existing `desktop` app, existing `LiteasyClaw/services/dev-cloud` Node service, deployment scripts and environment configuration, existing QA docs

---

## Scope Summary

This plan is intentionally demo-first. It does not formalize the full cloud platform. It makes the current server suitable for cloud deployment and roadshow presentation by tightening:

- deploy-time configuration
- environment handling
- startup paths
- smoke testing
- presenter documentation

## File Responsibilities

- `LiteasyClaw/services/dev-cloud/server.mjs`: must support explicit deploy-time configuration and stable host/port/environment behavior.
- `LiteasyClaw/services/dev-cloud/README.md`: must explain deploy/start/run behavior for local and cloud demo use.
- `README.md`: must link to the roadshow deployment flow and clarify the three-end demo shape.
- `project-docs/qa/environment-startup-guide.md`: must include a roadshow deploy/start checklist.
- `project-docs/qa/roadshow-demo-guide.md`: must describe the presenter path and smoke checks.
- `project-docs/Saas/2026-05-15-liteasyclaw-d1-deployable-demo-cloud-plan.md`: tracks this milestone.

### Task 1: Stabilize deploy-time server configuration

**Files:**
- Modify: `LiteasyClaw/services/dev-cloud/server.mjs`
- Modify: `LiteasyClaw/services/dev-cloud/server.test.mjs`

- [ ] **Step 1: Add a failing server test for configurable host, port, and base URL assumptions**

Add a test that starts the server handler with a configurable host header and confirms returned index URLs and policy payloads are derived from request origin or deploy config rather than hard-coded localhost assumptions.

```js
test("derives deploy-safe origin values from the incoming request host", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "demo.liteasy.example"
    },
    url: "/"
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /demo\.liteasy\.example/);
});
```

- [ ] **Step 2: Run the server test to verify current assumptions**

Run: `node --test LiteasyClaw/services/dev-cloud/server.test.mjs`
Expected: either FAIL or expose remaining localhost-only assumptions that need tightening.

- [ ] **Step 3: Harden `server.mjs` deploy configuration**

Add explicit config handling for:

- host binding
- port binding
- default public origin override when needed
- clearer environment variable reading

Keep request-origin behavior for local correctness, but allow a deploy-safe override path.

- [ ] **Step 4: Re-run server tests**

Run: `node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit the deploy-safe server baseline**

```bash
git add LiteasyClaw/services/dev-cloud/server.mjs LiteasyClaw/services/dev-cloud/server.test.mjs
git commit -m "docs-plan: harden LiteasyClaw demo cloud deploy configuration"
```

### Task 2: Write the roadshow deployment guide

**Files:**
- Create: `project-docs/qa/roadshow-demo-guide.md`
- Modify: `README.md`
- Modify: `project-docs/qa/environment-startup-guide.md`

- [ ] **Step 1: Create the roadshow guide**

Write `project-docs/qa/roadshow-demo-guide.md` with:

- what is deployed
- what stays local
- required environment variables
- startup order
- smoke test URLs
- presenter-critical demo path
- fallback actions if a live endpoint misbehaves

- [ ] **Step 2: Link the guide from `README.md`**

Add a short section pointing roadshow users to:

- `project-docs/qa/roadshow-demo-guide.md`
- `project-docs/qa/environment-startup-guide.md`

- [ ] **Step 3: Update the environment guide**

Add a separate subsection for roadshow deployment:

- start server
- verify root index
- verify `/healthz`
- verify `/admin/`
- start desktop against the deployed endpoint

- [ ] **Step 4: Verify doc links and endpoint mentions**

Run: `rg -n "roadshow-demo-guide|healthz|/admin/|deploy|部署" README.md project-docs/qa/environment-startup-guide.md project-docs/qa/roadshow-demo-guide.md`
Expected: PASS with matches in all expected docs

- [ ] **Step 5: Commit the roadshow docs**

```bash
git add README.md project-docs/qa/environment-startup-guide.md project-docs/qa/roadshow-demo-guide.md
git commit -m "docs-plan: add LiteasyClaw roadshow deployment guide"
```

### Task 3: Add presenter-oriented smoke checks

**Files:**
- Modify: `project-docs/qa/roadshow-demo-guide.md`

- [ ] **Step 1: Add a minimal smoke-check checklist**

The checklist must include:

- server root responds
- `/healthz` responds
- `/admin/` responds
- desktop can log in
- organization view loads
- recommendation flow works
- assistant can answer

- [ ] **Step 2: Add a “do not demo” list**

Write a short list of unstable or still-demo-only flows that a presenter should avoid if they are not required for the roadshow narrative.

- [ ] **Step 3: Commit the smoke-check guide refinement**

```bash
git add project-docs/qa/roadshow-demo-guide.md
git commit -m "docs-plan: refine LiteasyClaw roadshow smoke checks"
```

## D1 Verification Checklist

Before declaring D1 complete, run all of these:

```bash
node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs
cd LiteasyClaw/desktop && npm test
cd LiteasyClaw/desktop && npm run build
```

Expected:

- server tests pass
- desktop tests pass
- desktop build passes
- docs clearly explain the roadshow deployment flow

## Follow-On Dependency

D2 roadshow hardening can start immediately after D1. F1 may proceed in parallel only if it does not delay:

- deployability
- presenter path stabilization
- cloud demo environment readiness
