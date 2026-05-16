# Liteasy F3 In-App Organization Management Formalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize Liteasy organization management inside the software with explicit `owner / admin / member` roles, creation permission, role-gated invite/join/leave rules, and shared-library ownership semantics.

**Architecture:** This milestone keeps the existing desktop organization UI and shared-library workspace-switch flow, but replaces the current demo seam semantics with a formal role and ownership model. On the dev-cloud side, add a dedicated organization repository and explicit organization action endpoints so role rules are enforced in both desktop gating and server-side action handling.

**Tech Stack:** React, TypeScript, Vitest, Node.js, existing `services/dev-cloud` request-handler split, JSON-file-backed demo persistence

---

## File Responsibilities

### Desktop

- `desktop/src/app/features/organization/organization.types.ts`
  - formal organization role and ownership types
- `desktop/src/app/features/organization/useOrganizationActions.ts`
  - in-app organization action gating and dialog/action orchestration
- `desktop/src/app/features/organization/OrganizationSidebarPanel.tsx`
  - role-aware action visibility and button states
- `desktop/src/app/features/organization/useOrganizationWorkspace.ts`
  - workspace switching only, informed by formalized shared-library ownership/status
- `desktop/src/app/features/organization/organizationListClient.ts`
  - list client with formal role payload validation
- `desktop/src/app/features/organization/organizationSummaryClient.ts`
  - summary client with formal role and ownership payload validation
- `desktop/src/app/features/organization/organizationGovernanceClient.ts`
  - governance client remains read-model oriented
- `desktop/src/tests/useOrganizationActions.test.ts`
  - role-gated action behavior
- `desktop/src/tests/LeftPane.test.tsx`
  - role-aware button visibility/disabled state
- `desktop/src/tests/useOrganizationWorkspace.test.ts`
  - shared-library workspace semantics stay intact
- `desktop/src/tests/AppShell.test.tsx`
  - end-to-end organization create / invite / join / leave gating and shared-library behavior

### Dev-cloud

- `services/dev-cloud/db/organizationRepository.mjs`
  - durable organization, member role, and ownership persistence
- `services/dev-cloud/payloads/organizationPayloads.mjs`
  - read payloads based on formal organization repository data
- `services/dev-cloud/requestHandler.mjs`
  - explicit organization action endpoints for create, join, invite, leave
- `services/dev-cloud/server.test.mjs`
  - end-to-end organization route and role enforcement tests

### Docs

- `docs/qa/phase3-test-guide.md`
- `docs/qa/phase3-governance-limitations.md`
- `docs/qa/final-demo-handoff.md`

## Task 1: Formalize Desktop Role and Ownership Types

**Files:**
- Modify: `desktop/src/app/features/organization/organization.types.ts`
- Modify: `desktop/src/tests/LeftPane.test.tsx`
- Modify: `desktop/src/tests/useOrganizationWorkspace.test.ts`

- [ ] **Step 1: Write the failing type-driven tests for roles and ownership**

Add or update tests so they depend on explicit roles:

```ts
test("hides invite-member action when current role is member", () => {
  render(
    <LeftPane
      {...createProps({
        leftRailView: "organization",
        summary: {
          ...summary,
          myRole: "member"
        }
      })}
    />
  );

  const organizationPane = screen.getByLabelText("左边栏组织");
  expect(within(organizationPane).queryByRole("button", { name: "邀请成员" })).not.toBeInTheDocument();
});
```

Add a companion case for `admin` and `owner` if they are not already explicit.

- [ ] **Step 2: Run the focused desktop organization tests to verify failure**

Run:

```bash
cd desktop && npm test -- src/tests/LeftPane.test.tsx src/tests/useOrganizationWorkspace.test.ts
```

Expected: FAIL because organization role typing is still stringly-typed and not formally constrained.

- [ ] **Step 3: Add explicit role and ownership types**

Update `organization.types.ts` to define:

```ts
export type OrganizationRole = "owner" | "admin" | "member";

export type OrganizationMember = {
  id: string;
  name: string;
  role: OrganizationRole;
};
```

Also formalize:

- organization create permission field
- owner identity field
- shared-library ownership metadata field

Keep the file focused on shared domain contracts; do not put hook logic here.

- [ ] **Step 4: Run the focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/LeftPane.test.tsx src/tests/useOrganizationWorkspace.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the role model baseline**

```bash
git add desktop/src/app/features/organization/organization.types.ts desktop/src/tests/LeftPane.test.tsx desktop/src/tests/useOrganizationWorkspace.test.ts
git commit -m "feat: formalize Liteasy organization role and ownership types"
```

## Task 2: Formalize Desktop Action Gating for Create / Invite / Join / Leave

**Files:**
- Modify: `desktop/src/app/features/organization/useOrganizationActions.ts`
- Modify: `desktop/src/tests/useOrganizationActions.test.ts`
- Modify: `desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Write failing action-gating tests**

Add tests like:

```ts
test("blocks owner leave because owner transfer is out of scope", () => {
  const onAnalysisHint = vi.fn();
  const { result } = renderHook(() => useOrganizationActions({ onAnalysisHint }));

  act(() =>
    result.current.openLeaveDialog({
      ...organizationSummary,
      myRole: "owner"
    })
  );

  act(() => result.current.createOrganizationLeaveRequest());

  expect(result.current.actionMessage).toBe(
    "当前组织 owner 不能直接退出；请先转移 owner，当前版本暂未开放该流程。"
  );
});
```

Add companion tests for:

- `member` cannot invite
- `admin` can invite
- create action must respect create permission

- [ ] **Step 2: Run the organization action tests to verify failure**

Run:

```bash
cd desktop && npm test -- src/tests/useOrganizationActions.test.ts
```

Expected: FAIL because the hook still only returns demo seam messages and does not enforce role rules.

- [ ] **Step 3: Implement role-aware action gating in `useOrganizationActions.ts`**

Implementation requirements:

- keep dialog state management local to the hook
- gate invite by role
- gate create by create-permission flag
- gate owner leave with explicit block message
- keep the hook as an action-policy boundary, not a repository

Do not introduce network calls yet in this task. Only formalize the desktop decision layer and feedback semantics.

- [ ] **Step 4: Run the organization action tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/useOrganizationActions.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the desktop action-gating layer**

```bash
git add desktop/src/app/features/organization/useOrganizationActions.ts desktop/src/tests/useOrganizationActions.test.ts desktop/src/tests/AppShell.test.tsx
git commit -m "feat: add role-aware organization action gating"
```

## Task 3: Add a Dedicated Organization Repository in Dev-Cloud

**Files:**
- Create: `services/dev-cloud/db/organizationRepository.mjs`
- Modify: `services/dev-cloud/payloads/organizationPayloads.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [ ] **Step 1: Write failing server tests for create / join / invite / leave**

Add tests like:

```js
test("creates an organization and assigns the creator as owner", async () => {
  const handler = createDevCloudRequestHandler();

  const response = await invokeHandler({
    body: JSON.stringify({
      name: "Liteasy F3 Lab",
      sessionId: "demo-session-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/org/create"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.organization.ownerUserId, "demo-session-1");
  assert.equal(response.json.organization.myRole, "owner");
});
```

Add companion tests for:

- `member` invite rejected
- `admin` invite allowed
- join assigns `member`
- owner leave rejected

- [ ] **Step 2: Run the server tests to verify failure**

Run:

```bash
node --test services/dev-cloud/server.test.mjs
```

Expected: FAIL because organization action endpoints and repository do not exist yet.

- [ ] **Step 3: Add `organizationRepository.mjs`**

Repository responsibilities:

- persist organizations
- persist member role assignments
- persist owner relationship
- apply create / join / invite / leave business rules

Use the existing JSON persistence pattern already established in `services/dev-cloud/db/`.

Do not let HTTP formatting leak into this file.

- [ ] **Step 4: Rebuild read payloads to use formal repository data**

Update `organizationPayloads.mjs` so:

- `list` payload reflects explicit roles
- `summary` payload reflects `owner / admin / member`
- shared-library ownership data is explicit in the returned organization model

Keep generation of display payloads separate from the repository’s business rules.

- [ ] **Step 5: Run the server tests to verify green**

Run:

```bash
node --test services/dev-cloud/server.test.mjs
```

Expected: PASS

- [ ] **Step 6: Commit the dev-cloud organization repository layer**

```bash
git add services/dev-cloud/db/organizationRepository.mjs services/dev-cloud/payloads/organizationPayloads.mjs services/dev-cloud/server.test.mjs
git commit -m "feat: add formal organization repository and role rules"
```

## Task 4: Wire Explicit Organization Action Endpoints into Dev-Cloud

**Files:**
- Modify: `services/dev-cloud/requestHandler.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [ ] **Step 1: Extend the failing endpoint list and route tests**

Add the new endpoints to the root index expectation:

- `POST /v1/org/create`
- `POST /v1/org/join`
- `POST /v1/org/invite`
- `POST /v1/org/leave`

Also add one route-level method test to ensure the root index advertises them.

- [ ] **Step 2: Run the server tests to verify failure**

Run:

```bash
node --test services/dev-cloud/server.test.mjs
```

Expected: FAIL because the new routes are not wired yet.

- [ ] **Step 3: Add the explicit organization action routes**

In `requestHandler.mjs`, add:

- `POST /v1/org/create`
- `POST /v1/org/join`
- `POST /v1/org/invite`
- `POST /v1/org/leave`

Each route must:

- parse JSON
- delegate to repository-backed payload/action helper
- return `400` for invalid input
- return `403` for role/ownership rule violations where appropriate

Do not re-implement the business rules inline in the route branches.

- [ ] **Step 4: Re-run server tests**

Run:

```bash
node --test services/dev-cloud/server.test.mjs services/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit the dev-cloud route wiring**

```bash
git add services/dev-cloud/requestHandler.mjs services/dev-cloud/server.test.mjs
git commit -m "feat: wire formal organization action endpoints"
```

## Task 5: Connect Desktop Dialog Flows to the Formalized Role Rules

**Files:**
- Modify: `desktop/src/app/features/organization/OrganizationSidebarPanel.tsx`
- Modify: `desktop/src/tests/LeftPane.test.tsx`
- Modify: `desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Write failing UI behavior tests**

Add or update tests so they explicitly reflect:

- owner create button visible / enabled when permitted
- admin invite button visible / enabled
- member invite button hidden or disabled
- owner leave shows blocked message rather than fake success path

Use existing panel tests where possible rather than creating a new UI harness.

- [ ] **Step 2: Run the focused UI tests to verify failure**

Run:

```bash
cd desktop && npm test -- src/tests/LeftPane.test.tsx src/tests/AppShell.test.tsx -t "organization"
```

Expected: FAIL because the current UI still reflects mostly demo seam semantics.

- [ ] **Step 3: Update the organization sidebar behavior**

Implementation requirements:

- button visibility and button disabled states must follow explicit role fields
- no new side panels or major layout changes
- keep organization management inside the software UI

Do not add a separate backend-management concept to the customer flow.

- [ ] **Step 4: Re-run the focused UI tests**

Run:

```bash
cd desktop && npm test -- src/tests/LeftPane.test.tsx src/tests/AppShell.test.tsx -t "organization"
```

Expected: PASS

- [ ] **Step 5: Commit the UI rule alignment**

```bash
git add desktop/src/app/features/organization/OrganizationSidebarPanel.tsx desktop/src/tests/LeftPane.test.tsx desktop/src/tests/AppShell.test.tsx
git commit -m "feat: align organization UI with formal role rules"
```

## Task 6: Keep Shared-Library Workspace Switching Semantics Intact

**Files:**
- Modify: `desktop/src/app/features/organization/useOrganizationWorkspace.ts`
- Modify: `desktop/src/tests/useOrganizationWorkspace.test.ts`
- Modify: `desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Write a failing ownership-aware shared-library test**

Add a test that verifies:

- role/summary data may gate whether the shared library can be opened
- when allowed, opening still replaces the current workspace
- returning to local library still works

Use the current hook tests as the main seam.

- [ ] **Step 2: Run the shared-library tests to verify failure**

Run:

```bash
cd desktop && npm test -- src/tests/useOrganizationWorkspace.test.ts
```

Expected: FAIL if the hook does not yet consume the new formalized ownership/status semantics.

- [ ] **Step 3: Update `useOrganizationWorkspace.ts` minimally**

Implementation requirements:

- preserve current workspace-switch behavior
- consume formalized summary/shared-library semantics
- do not absorb generic organization governance logic

- [ ] **Step 4: Re-run shared-library tests**

Run:

```bash
cd desktop && npm test -- src/tests/useOrganizationWorkspace.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the shared-library semantic preservation**

```bash
git add desktop/src/app/features/organization/useOrganizationWorkspace.ts desktop/src/tests/useOrganizationWorkspace.test.ts desktop/src/tests/AppShell.test.tsx
git commit -m "feat: preserve shared-library workspace switching under formal roles"
```

## Task 7: Update QA and Handoff Docs

**Files:**
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`
- Modify: `docs/qa/final-demo-handoff.md`

- [ ] **Step 1: Update the docs to match the formalized in-app organization model**

Required wording changes:

- organization management remains inside the software
- `/admin/` is not the customer organization admin surface
- roles are `owner / admin / member`
- owner leave is blocked in this milestone
- create and invite are role-gated

- [ ] **Step 2: Verify the docs mention the new role model**

Run:

```bash
rg -n "owner|admin|member|组织管理|共享文献库|/admin/" docs/qa/phase3-test-guide.md docs/qa/phase3-governance-limitations.md docs/qa/final-demo-handoff.md
```

Expected: matches for the new in-app organization model language.

- [ ] **Step 3: Commit the docs**

```bash
git add docs/qa/phase3-test-guide.md docs/qa/phase3-governance-limitations.md docs/qa/final-demo-handoff.md
git commit -m "docs: align organization docs with formal in-app role model"
```

## Final Verification

- [ ] **Step 1: Run focused organization tests**

```bash
cd desktop && npm test -- src/tests/useOrganizationActions.test.ts src/tests/useOrganizationWorkspace.test.ts src/tests/LeftPane.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run desktop full test suite**

```bash
cd desktop && npm test
```

Expected: PASS

- [ ] **Step 3: Run desktop build**

```bash
cd desktop && npm run build
```

Expected: PASS

- [ ] **Step 4: Run dev-cloud tests**

```bash
node --test services/dev-cloud/server.test.mjs services/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: PASS

- [ ] **Step 5: Verify the product boundary still holds**

Manual checklist:

- organization management actions remain inside the desktop software
- `/admin/` still reads as platform-internal only
- role gates are enforced in both UI and dev-cloud action paths
- shared-library switching still behaves like workspace replacement
