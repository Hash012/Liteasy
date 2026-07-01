# LiteasyClaw D2-F1 Priority Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the roadshow-critical D2 hardening first, then start the first durable SaaS foundation milestone F1/M1 without mixing the two tracks.

**Architecture:** This plan is an execution coordinator, not a replacement for the detailed SaaS plan docs. It sequences the already-written D2 and M1 work against the current repository state: `LiteasyClaw/services/dev-cloud/server.mjs` still carries mixed responsibilities at 900+ lines, `desktop` still boots from seeded demo papers instead of a file-backed local library root, and the resource-scope modules described by M1 do not yet exist in code.

**Tech Stack:** Node.js, React, TypeScript, Tauri 2, Rust, Vitest, Node test runner, current `project-docs/Saas/` and `project-docs/qa/` documentation

---

## Source-of-Truth Documents

Execute this coordinator together with these two detailed plan docs:

- `project-docs/Saas/2026-05-15-liteasyclaw-d2-roadshow-core-user-loop-plan.md`
- `project-docs/Saas/2026-05-15-liteasyclaw-m1-resource-boundary-local-library-plan.md`

This file answers one question only: **what should be done next, in what order, and what must be true before switching tracks.**

## Current Starting State

At the time this plan was written, the repository state was:

- `LiteasyClaw/services/dev-cloud/server.mjs`: `953` lines
- `LiteasyClaw/desktop/src/app/layout/useAppShellStores.ts`: still seeds `starterPapers` into the workspace store on startup
- `LiteasyClaw/desktop/src-tauri/src/main.rs`: only registers `import::mock_import`
- `LiteasyClaw/desktop/src/app/features/resources/`: does not exist yet
- verification baseline:
  - `node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs`: PASS
  - `cd LiteasyClaw/desktop && npm test`: PASS
  - `cd LiteasyClaw/desktop && npm run build`: PASS

### Task 1: Lock the Baseline Before New Work

**Files:**
- Read: `project-docs/Saas/2026-05-15-liteasyclaw-d2-roadshow-core-user-loop-plan.md`
- Read: `project-docs/Saas/2026-05-15-liteasyclaw-m1-resource-boundary-local-library-plan.md`
- Read: `LiteasyClaw/services/dev-cloud/server.mjs`
- Read: `LiteasyClaw/desktop/src/app/layout/useAppShellStores.ts`
- Read: `LiteasyClaw/desktop/src-tauri/src/main.rs`
- Test: `LiteasyClaw/services/dev-cloud/server.test.mjs`
- Test: `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Reconfirm the current structural D2 hotspot**

Run:

```bash
wc -l LiteasyClaw/services/dev-cloud/server.mjs
```

Expected: line count remains above `900`, confirming the file is still too large to close D2 honestly.

- [ ] **Step 2: Reconfirm the current F1 hotspot**

Run:

```bash
rg -n "starterPapers|mock_import|generate_handler|createWorkspaceStore|features/resources" \
  LiteasyClaw/desktop/src/app/layout/useAppShellStores.ts \
  LiteasyClaw/desktop/src-tauri/src/main.rs \
  LiteasyClaw/desktop/src/app/features \
  LiteasyClaw/desktop/src/app/features/workspace/workspace.store.ts
```

Expected:

- `useAppShellStores.ts` still seeds `starterPapers`
- `main.rs` still only registers `mock_import`
- `features/resources` is still absent

- [ ] **Step 3: Reconfirm the green baseline before refactors**

Run:

```bash
node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: PASS

- [ ] **Step 4: Reconfirm the green desktop baseline before refactors**

Run:

```bash
cd LiteasyClaw/desktop && npm test
```

Expected: PASS

- [ ] **Step 5: Reconfirm the build baseline before refactors**

Run:

```bash
cd LiteasyClaw/desktop && npm run build
```

Expected: PASS

- [ ] **Step 6: Record the owned write scope for this phase**

Use this file ownership map during execution:

```text
D2 write scope:
- LiteasyClaw/services/dev-cloud/server.mjs
- LiteasyClaw/services/dev-cloud/server.test.mjs
- LiteasyClaw/services/dev-cloud/requestHandler.mjs
- LiteasyClaw/services/dev-cloud/payloads/*.mjs
- LiteasyClaw/services/dev-cloud/README.md
- project-docs/qa/roadshow-demo-guide.md
- project-docs/qa/environment-startup-guide.md

F1 write scope:
- LiteasyClaw/desktop/src/app/features/resources/*
- LiteasyClaw/desktop/src/app/features/library/*
- LiteasyClaw/desktop/src/app/features/workspace/*
- LiteasyClaw/desktop/src/app/layout/AppShell.tsx
- LiteasyClaw/desktop/src/app/layout/useAppShellStores.ts
- LiteasyClaw/desktop/src/tests/*
- LiteasyClaw/desktop/src-tauri/src/local_library.rs
- LiteasyClaw/desktop/src-tauri/src/main.rs
- project-docs/qa/environment-startup-guide.md
```

Expected: no unrelated files are dragged into these two milestones.

### Task 2: Execute D2 First and Keep It Narrow

**Files:**
- Modify: `LiteasyClaw/services/dev-cloud/server.mjs`
- Create: `LiteasyClaw/services/dev-cloud/requestHandler.mjs`
- Create: `LiteasyClaw/services/dev-cloud/payloads/*.mjs`
- Modify: `LiteasyClaw/services/dev-cloud/server.test.mjs`
- Modify if needed: `LiteasyClaw/services/dev-cloud/README.md`
- Modify if behavior changes: `project-docs/qa/roadshow-demo-guide.md`

- [ ] **Step 1: Use the D2 plan as the code-level checklist**

Read and execute the detailed steps from:

```text
project-docs/Saas/2026-05-15-liteasyclaw-d2-roadshow-core-user-loop-plan.md
```

Required D2 outcome before moving on:

- `server.mjs` becomes a thin bootstrap/root file
- route dispatch no longer lives in the same file as every payload builder
- root index, `/healthz`, `/admin/`, recommendation, organization, audit, and policy routes still work

- [ ] **Step 2: Add or preserve route-level regression coverage before moving code**

Run:

```bash
node --test LiteasyClaw/services/dev-cloud/server.test.mjs
```

Then ensure the test suite still covers at least:

```text
- GET /
- GET /admin and /admin/
- GET /v1/admin/governance-dashboard
- GET /v1/admin/model-policy
- POST /v1/recommendations
- POST /v1/org/list
- POST /v1/org/summary
- POST /v1/org/shared-library/manifest
- POST /v1/org/governance-summary
- POST /v1/model/audit
```

Expected: coverage exists before extraction, so the refactor is protected.

- [ ] **Step 3: Extract payload builders by domain**

Use this target split:

```text
LiteasyClaw/services/dev-cloud/payloads/policyPayloads.mjs
LiteasyClaw/services/dev-cloud/payloads/recommendationPayloads.mjs
LiteasyClaw/services/dev-cloud/payloads/collectionPayloads.mjs
LiteasyClaw/services/dev-cloud/payloads/organizationPayloads.mjs
LiteasyClaw/services/dev-cloud/payloads/modelPayloads.mjs
```

Expected:

- `server.mjs` stops owning all response-building logic
- payload modules expose pure builders
- no route behavior changes yet

- [ ] **Step 4: Move route dispatch into a dedicated request handler**

Create:

```text
LiteasyClaw/services/dev-cloud/requestHandler.mjs
```

Expected responsibilities:

- own `OPTIONS` handling
- own method/path routing
- call extracted payload builders
- keep request parsing and response writing in one place

Keep `LiteasyClaw/services/dev-cloud/server.mjs` responsible only for:

- runtime config
- provider registry creation
- server creation
- CLI startup

- [ ] **Step 5: Re-run D2 verification immediately after the split**

Run:

```bash
node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: PASS

- [ ] **Step 6: Commit the D2 server split as a self-contained change**

```bash
git add LiteasyClaw/services/dev-cloud/server.mjs LiteasyClaw/services/dev-cloud/requestHandler.mjs LiteasyClaw/services/dev-cloud/payloads LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs
git commit -m "refactor: split LiteasyClaw dev cloud request handling"
```

Expected: one commit for the server split, with no F1 code mixed in.

### Task 3: Finish the Remaining D2 Presenter-Critical Hardening

**Files:**
- Modify if needed: `LiteasyClaw/desktop/src/app/features/network/cloudErrorMessage.ts`
- Modify if needed: `LiteasyClaw/desktop/src/app/features/organization/useOrganizationWorkspace.ts`
- Modify if needed: `LiteasyClaw/desktop/src/tests/cloudErrorMessage.test.ts`
- Modify if needed: `LiteasyClaw/desktop/src/tests/useOrganizationWorkspace.test.ts`
- Modify only if unavoidable: `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`
- Modify if behavior changes: `project-docs/qa/roadshow-demo-guide.md`

- [ ] **Step 1: Keep desktop D2 work limited to presenter-risk hotspots**

Only change desktop code for these D2 outcomes:

- clearer cloud-offline copy
- safer organization shared-library open/return flow
- less pressure on the giant `AppShell.test.tsx` file by moving focused cases to smaller test files when possible

Do **not** start F1 local-library work here.

- [ ] **Step 2: Re-run the focused roadshow-critical tests first**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/cloudErrorMessage.test.ts src/tests/useOrganizationWorkspace.test.ts src/tests/AppShell.test.tsx
```

Expected: PASS before further edits, so behavior changes remain intentional.

- [ ] **Step 3: If you split test pressure out of `AppShell.test.tsx`, keep the end-to-end path intact**

Retain end-to-end coverage for:

```text
- login dialog / skip flow
- open organization panel
- open shared library
- return to local workspace
- assistant answer path
- at least one artifact entry path
```

Expected: smaller focused tests exist, but one real integration path still survives.

- [ ] **Step 4: Re-run all desktop tests and build after D2 desktop edits**

Run:

```bash
cd LiteasyClaw/desktop && npm test
cd LiteasyClaw/desktop && npm run build
```

Expected: PASS

- [ ] **Step 5: Commit the desktop D2 hardening separately**

```bash
git add LiteasyClaw/desktop/src/app/features/network/cloudErrorMessage.ts LiteasyClaw/desktop/src/app/features/organization/useOrganizationWorkspace.ts LiteasyClaw/desktop/src/tests/cloudErrorMessage.test.ts LiteasyClaw/desktop/src/tests/useOrganizationWorkspace.test.ts LiteasyClaw/desktop/src/tests/AppShell.test.tsx project-docs/qa/roadshow-demo-guide.md
git commit -m "test: harden LiteasyClaw roadshow-critical desktop loop"
```

Expected: one commit for D2 desktop hardening only.

### Task 4: Do Not Start F1 Until D2 Passes a Real Gate

**Files:**
- Read: `project-docs/qa/roadshow-demo-guide.md`
- Read: `project-docs/qa/final-demo-handoff.md`
- Test: `LiteasyClaw/services/dev-cloud/server.test.mjs`
- Test: `LiteasyClaw/desktop/src/tests/*`

- [ ] **Step 1: Run the full D2 verification gate**

Run:

```bash
node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs
cd LiteasyClaw/desktop && npm test
cd LiteasyClaw/desktop && npm run build
```

Expected: PASS

- [ ] **Step 2: Recheck the structural honesty condition**

Run:

```bash
wc -l LiteasyClaw/services/dev-cloud/server.mjs
```

Expected: materially reduced versus the `953`-line starting point, with payloads/request dispatch moved out.

- [ ] **Step 3: Recheck the presenter path documentation**

Run:

```bash
rg -n "roadshow|shared library|organization|assistant|artifact|/admin/" project-docs/qa/roadshow-demo-guide.md project-docs/qa/final-demo-handoff.md README.md
```

Expected: docs still match the live demo path after D2 changes.

- [ ] **Step 4: Only when all three D2 conditions are true, switch to F1**

D2 switch conditions:

```text
1. tests pass
2. build passes
3. `server.mjs` is no longer the mixed-responsibility hotspot
```

Expected: F1 starts from a stable demo baseline rather than while the roadshow path is still moving.

### Task 5: Start F1 by Executing M1 Tasks 1-2 Only

**Files:**
- Create: `LiteasyClaw/desktop/src/app/features/resources/resourceScope.types.ts`
- Create: `LiteasyClaw/desktop/src/app/features/resources/resourceActionPolicy.ts`
- Create: `LiteasyClaw/desktop/src/tests/resourceActionPolicy.test.ts`
- Create: `LiteasyClaw/desktop/src/app/features/library/localLibrary.types.ts`
- Create: `LiteasyClaw/desktop/src/app/features/library/localLibraryClient.ts`
- Create: `LiteasyClaw/desktop/src/tests/localLibraryClient.test.ts`
- Create: `LiteasyClaw/desktop/src-tauri/src/local_library.rs`
- Modify: `LiteasyClaw/desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Use the M1 plan as the code-level checklist**

Read and execute these exact sections:

```text
project-docs/Saas/2026-05-15-liteasyclaw-m1-resource-boundary-local-library-plan.md
- Task 1: Add five resource-class types and policy tests
- Task 2: Add a file-backed local library runtime seam
```

Expected:

- the five resource classes exist in code
- the first action-policy layer exists in code
- a Tauri command can return a local-library snapshot

- [ ] **Step 2: Run only the new M1-targeted tests after Tasks 1-2**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/resourceActionPolicy.test.ts src/tests/localLibraryClient.test.ts
```

Expected: PASS

- [ ] **Step 3: Re-run service-neutral desktop verification after the new seam lands**

Run:

```bash
cd LiteasyClaw/desktop && npm test
```

Expected: PASS

- [ ] **Step 4: Commit the first F1 slice separately**

```bash
git add LiteasyClaw/desktop/src/app/features/resources LiteasyClaw/desktop/src/app/features/library/localLibrary.types.ts LiteasyClaw/desktop/src/app/features/library/localLibraryClient.ts LiteasyClaw/desktop/src/tests/resourceActionPolicy.test.ts LiteasyClaw/desktop/src/tests/localLibraryClient.test.ts LiteasyClaw/desktop/src-tauri/src/local_library.rs LiteasyClaw/desktop/src-tauri/src/main.rs
git commit -m "feat: add LiteasyClaw resource classes and local library seam"
```

Expected: the first F1 commit contains only resource typing and runtime seam work.

### Task 6: Finish F1 by Executing M1 Tasks 3-5

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/layout/AppShell.tsx`
- Modify: `LiteasyClaw/desktop/src/app/layout/useAppShellStores.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/library/LibraryPane.tsx`
- Modify: `LiteasyClaw/desktop/src/app/features/workspace/workspace.types.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/workspace/workspace.store.ts`
- Modify: `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`
- Modify: `LiteasyClaw/desktop/src/tests/LeftPane.test.tsx`
- Modify: `project-docs/qa/environment-startup-guide.md`

- [ ] **Step 1: Execute the remaining M1 sections in order**

Read and execute these exact sections:

```text
project-docs/Saas/2026-05-15-liteasyclaw-m1-resource-boundary-local-library-plan.md
- Task 3: Load the workspace from the local library root
- Task 4: Surface the local library root in the left pane
- Task 5: Document local library verification
```

Expected:

- workspace boot no longer depends on seeded `starterPapers`
- left pane can show the local library root and refresh affordance
- QA docs explain how to verify the local library folder exists

- [ ] **Step 2: Run the targeted F1 verification commands from the M1 plan**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/resourceActionPolicy.test.ts
cd LiteasyClaw/desktop && npm test -- src/tests/AppShell.test.tsx -t "loads the LiteasyClaw local library root on startup"
cd LiteasyClaw/desktop && npm test -- src/tests/LeftPane.test.tsx -t "shows the local library root and refresh affordance"
```

Expected: PASS

- [ ] **Step 3: Run the full final verification for the combined D2+F1 state**

Run:

```bash
node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs
cd LiteasyClaw/desktop && npm test
cd LiteasyClaw/desktop && npm run build
```

Expected: PASS

- [ ] **Step 4: Commit the second F1 slice separately**

```bash
git add LiteasyClaw/desktop/src/app/layout/AppShell.tsx LiteasyClaw/desktop/src/app/layout/useAppShellStores.ts LiteasyClaw/desktop/src/app/features/library/LibraryPane.tsx LiteasyClaw/desktop/src/app/features/workspace/workspace.types.ts LiteasyClaw/desktop/src/app/features/workspace/workspace.store.ts LiteasyClaw/desktop/src/tests/AppShell.test.tsx LiteasyClaw/desktop/src/tests/LeftPane.test.tsx project-docs/qa/environment-startup-guide.md
git commit -m "feat: bootstrap LiteasyClaw from a file-backed local library"
```

Expected: the second F1 commit contains only workspace bootstrap, UI surfacing, and docs.

## Completion Gate

Do not claim this plan complete until all of the following are true:

- D2 server split is landed and verified
- D2 desktop roadshow-critical path is still green
- F1 resource classes are in code
- F1 local-library runtime seam is in code
- desktop workspace boot is driven by the local library root instead of seeded demo papers
- `node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs` passes
- `cd LiteasyClaw/desktop && npm test` passes
- `cd LiteasyClaw/desktop && npm run build` passes
