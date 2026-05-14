# Liteasy Phase 3 Organization and Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add organization space workflows, shared libraries, notifications, admin visibility, and governance controls on top of the synced product baseline.

**Architecture:** This plan depends on the Phase 2 sync and recommendation baseline being complete. It introduces multi-user state, shared resources, admin oversight, and audit surfaces while preserving the desktop-first user experience.

**Tech Stack:** Existing desktop stack plus cloud auth, org services, admin UI, audit logging, quotas, monitoring

---

## Scope Summary

- Depends on: `docs/superpowers/plans/2026-05-10-liteasy-phase2-sync-and-recommendation.md`
- Primary outcomes:
  - organization space in the desktop client
  - shared library browsing
  - membership and notification surfaces
  - admin console basics
  - task, quota, and audit visibility
- Required exit artifacts:
  - updated environment guide
  - Phase 3 test guide
  - governance limitations log

---

## Source of Truth

Phase 3 must stay grounded in `docs/Liteasy_功能与UI设计文档1.0.md`, especially:

- `左边栏` includes `组织、个人中心、设置`.
- `组织` lets users join or create organizations.
- An organization has shared cloud library space with a time window.
- The organization detail view shows members and notifications.
- Notifications include admin announcements, member uploads, and shared-library structure changes.
- Organization shared libraries can be opened in the literature reading workspace.

The product-blueprint spec is a technical interpretation of that source, not a replacement for it.

## Current Phase 3 Slice

Status: **organization-space summary, left-rail organization entry dialog, personal center profile prototype, academic archive page, clear-profile confirmation, joined organization list/switching, shared-library open, member/notification detail, governance summary, and registered organization action prototype slices implemented in the existing main working tree without committing**.

The current implemented slices introduce visible organization-space seams:

- Development cloud returns a demo organization summary.
- Desktop fetches the summary after cloud account login.
- Desktop shows a left-rail `组织` entry that opens an organization list/detail dialog grounded in the core UI spec.
- Desktop shows a left-rail `个人中心` panel with identity, team, profile sampling toggle, reading count, academic personality, archive, and clear-profile placeholders.
- Desktop shows a `学术档案` page seam with profile configuration, reading statistics, academic personality, and authorization status.
- Desktop shows a demo `清空用户画像` confirmation flow that preserves base identity and resets profile sampling state.
- Desktop shows the joined organization list and can switch between two demo organizations.
- Desktop shows organization name, role, member details, notification details, shared library status, governance quota, task, and audit visibility for the active organization.
- The active organization shared library entry includes demo documents and can be opened into the current workspace by button or registered assistant command.

Out of scope for this slice:

- Real organization creation or invite flows.
- Real organization authentication or authorization.
- Real cloud shared-library directory browsing, upload, deletion, and version control.
- Full admin backend CRUD.
- Paid subscription enforcement.

### Task 1: Organization summary cloud seam

**Files:**
- Create: `desktop/src/app/features/organization/organization.types.ts`
- Create: `desktop/src/app/features/organization/organizationSummaryClient.ts`
- Test: `desktop/src/tests/organizationSummaryClient.test.ts`
- Modify: `services/dev-cloud/server.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [x] **Step 1: Write the failing desktop client test**

Add `desktop/src/tests/organizationSummaryClient.test.ts`:

```ts
import { createOrganizationSummaryClient } from "../app/features/organization/organizationSummaryClient";

test("posts a session id to the organization summary endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createOrganizationSummaryClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          summary: {
            auditEvents: [
              {
                actor: "Admin",
                description: "更新共享文献库上传权限",
                id: "audit-1",
                occurredAt: "2026-05-14T10:30:00Z"
              }
            ],
            memberCount: 12,
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [
              {
                id: "notice-1",
                message: "管理员发布了本周阅读主题。",
                type: "announcement"
              }
            ],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  const summary = await client({ sessionId: "demo-session-1" });

  expect(summary.name).toBe("Liteasy AI Reading Lab");
  expect(summary.sharedLibrary.documentCount).toBe(48);
  expect(requests).toEqual([
    {
      body: JSON.stringify({ sessionId: "demo-session-1" }),
      url: "https://liteasy.example.com/control-plane/v1/org/summary"
    }
  ]);
});
```

- [x] **Step 2: Run the client test to verify it fails**

Run: `cd desktop && npm test -- src/tests/organizationSummaryClient.test.ts`

Expected: FAIL because `organizationSummaryClient` does not exist.

- [x] **Step 3: Add the cloud endpoint failing test**

Add a `returns a demo organization summary` test to `services/dev-cloud/server.test.mjs` that posts `{ "sessionId": "demo-session-1" }` to `/v1/org/summary` and expects the same fields shown in Step 1.

- [x] **Step 4: Run the cloud endpoint test to verify it fails**

Run: `node --test services/dev-cloud/server.test.mjs`

Expected: FAIL with `/v1/org/summary` returning `not_found`.

- [x] **Step 5: Implement the minimal desktop client and endpoint**

Create the organization types and client, then add `buildOrganizationSummaryPayload()` plus a `POST /v1/org/summary` branch in `services/dev-cloud/server.mjs`.

- [x] **Step 6: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/organizationSummaryClient.test.ts
node --test services/dev-cloud/server.test.mjs
```

Expected: both pass.

### Task 2: Organization space panel

**Files:**
- Create: `desktop/src/app/features/organization/OrganizationSpacePanel.tsx`
- Create: `desktop/src/app/features/organization/useOrganizationSummary.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/styles/app.css`
- Test: `desktop/src/tests/AppShell.test.tsx`

- [x] **Step 1: Write the failing AppShell test**

Add a test that stubs `/v1/account/demo-login` and `/v1/org/summary`, logs in, and expects:

- `组织空间：Liteasy AI Reading Lab`
- `角色：研究员 · 成员 12 人`
- `共享文献库：组织共享文献库 · 48 篇`
- `通知：管理员发布了本周阅读主题。`
- `配额：38 / 100 GB，到期 2026-06-01T00:00:00Z`
- `治理：运行任务 2 个，失败任务 1 个`
- `最近审计：Admin 更新共享文献库上传权限`

- [x] **Step 2: Run the AppShell test to verify it fails**

Run: `cd desktop && npm test -- src/tests/AppShell.test.tsx -t "shows organization space summary after cloud account login"`

Expected: FAIL because the panel is not rendered.

- [x] **Step 3: Implement the hook and panel**

`useOrganizationSummary` mirrors the Phase 2 metadata-sync hook:

- unauthenticated: show `连接云账号后会加载组织空间。`
- loading: show `正在加载组织空间...`
- success: show summary fields.
- error: show a readable error message.

`OrganizationSpacePanel` renders a compact card in the right-pane stack above the assistant.

- [x] **Step 4: Wire AppShell props and rendering**

Add optional `organizationTransport` to `AppShellProps`, call the hook with `accountSession`, and render `OrganizationSpacePanel` between `DocumentMetadataSyncPanel` and `AssistantPane`.

- [x] **Step 5: Run focused AppShell test to verify green**

Run: `cd desktop && npm test -- src/tests/AppShell.test.tsx -t "shows organization space summary after cloud account login"`

Expected: PASS.

### Task 3: Open organization shared library in workspace

**Files:**
- Modify: `desktop/src/app/features/organization/organization.types.ts`
- Modify: `desktop/src/app/features/organization/organizationSummaryClient.ts`
- Modify: `desktop/src/app/features/organization/OrganizationSpacePanel.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `desktop/src/tests/organizationSummaryClient.test.ts`
- Modify: `services/dev-cloud/server.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [x] **Step 1: Write the failing shared-library open test**

Add an AppShell test that logs into the demo account, waits for `组织空间：Liteasy AI Reading Lab`, clicks `打开共享文献库`, and expects the left `我的文献库` workspace to switch to the organization shared-library root with:

- `Organization Reading List: Retrieval-Augmented Generation`
- `Team Notes on Long-Context Evaluation`
- `已打开组织共享文献库：组织共享文献库。`
- no local starter papers mixed into the organization workspace

- [x] **Step 2: Extend organization summary fixtures with shared documents**

Add `sharedLibrary.documents` to the desktop client test, AppShell test fixtures, and dev-cloud server test.

- [x] **Step 3: Extend the organization summary schema**

Add `OrganizationSharedLibraryDocument` and validate `sharedLibrary.documents` in `organizationSummaryClient.ts`.

- [x] **Step 4: Return demo shared-library documents from dev-cloud**

Update `/v1/org/summary` so the demo shared library includes two `org://org-demo-1/shared-library/...` documents.

- [x] **Step 5: Add the panel action and workspace wiring**

Add `打开共享文献库` to `OrganizationSpacePanel`, wire it through `AppShell`, and use `workspaceStore.openWorkspace()` so the shared documents replace the current workspace like opening a new folder. Add `返回本地文献库` to restore the starter local workspace explicitly.

- [x] **Step 6: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/organizationSummaryClient.test.ts src/tests/AppShell.test.tsx -t "organization space summary|opens the organization shared library|posts a session id"
node --test services/dev-cloud/server.test.mjs
```

Expected: both commands pass.

### Task 4: Organization member and notification details

**Files:**
- Modify: `desktop/src/app/features/organization/organization.types.ts`
- Modify: `desktop/src/app/features/organization/organizationSummaryClient.ts`
- Modify: `desktop/src/app/features/organization/OrganizationSpacePanel.tsx`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `desktop/src/tests/organizationSummaryClient.test.ts`
- Modify: `services/dev-cloud/server.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [x] **Step 1: Write the failing details test**

Add an AppShell test that logs into the demo account and expects:

- `组织成员：Liteasy Researcher（研究员）、Admin（管理员）`
- `通知：公告 · 管理员发布了本周阅读主题。`
- `通知：文献上传 · 成员上传了 Graph Neural Networks 综述。`
- `通知：文献库变更 · 共享文献库结构新增 RAG 目录。`

- [x] **Step 2: Extend organization summary fixtures with members and notification types**

Add `members` and three notification records to the desktop and dev-cloud tests.

- [x] **Step 3: Extend schema and dev-cloud payload**

Add `OrganizationMember`, validate `summary.members`, and return two demo members plus three notification types from `/v1/org/summary`.

- [x] **Step 4: Render details in the organization card**

Show the member list and labeled notification rows in `OrganizationSpacePanel`.

- [x] **Step 5: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/organizationSummaryClient.test.ts src/tests/AppShell.test.tsx -t "members and notification|organization space summary|posts a session id"
```

Expected: command passes.

### Task 5: Organization governance summary seam

**Files:**
- Create: `desktop/src/app/features/organization/organizationGovernanceClient.ts`
- Create: `desktop/src/app/features/organization/useOrganizationGovernance.ts`
- Create: `desktop/src/app/features/organization/OrganizationGovernancePanel.tsx`
- Modify: `desktop/src/app/features/organization/organization.types.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Test: `desktop/src/tests/organizationGovernanceClient.test.ts`
- Test: `desktop/src/tests/AppShell.test.tsx`
- Modify: `services/dev-cloud/server.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [x] **Step 1: Write failing governance summary tests**

Add tests for `createOrganizationGovernanceClient`, `/v1/org/governance-summary`, and AppShell rendering:

- `治理后台：待复核 3 项，高风险 1 项`
- `组织配额：存储 38 / 100 GB，模型调用 4200 / 10000`
- `后台任务：组织共享文献库索引刷新（running）`
- `审计队列：Admin 更新共享文献库上传权限（medium）`

- [x] **Step 2: Implement the governance client and hook**

Post `{ organizationId, sessionId }` to `/v1/org/governance-summary` and validate audit queue, quota, task, and audit event fields.

- [x] **Step 3: Add the governance panel**

Render a compact `组织治理` card in the right-pane stack after organization summary loads.

- [x] **Step 4: Implement the dev-cloud endpoint**

Return deterministic demo quota, task, and audit queue data from `/v1/org/governance-summary`.

- [x] **Step 5: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/organizationGovernanceClient.test.ts src/tests/AppShell.test.tsx -t "governance summary"
node --test services/dev-cloud/server.test.mjs
```

Expected: both pass.

### Task 6B: Joined organization list and switching seam

**Files:**
- Create: `desktop/src/app/features/organization/organizationListClient.ts`
- Create: `desktop/src/app/features/organization/useOrganizationList.ts`
- Modify: `desktop/src/app/features/organization/organization.types.ts`
- Modify: `desktop/src/app/features/organization/organizationSummaryClient.ts`
- Modify: `desktop/src/app/features/organization/useOrganizationSummary.ts`
- Modify: `desktop/src/app/features/organization/OrganizationSpacePanel.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Test: `desktop/src/tests/organizationListClient.test.ts`
- Test: `desktop/src/tests/organizationSummaryClient.test.ts`
- Test: `desktop/src/tests/AppShell.test.tsx`
- Modify: `services/dev-cloud/server.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [x] **Step 1: Write failing organization-list tests**

Add tests for:

- `createOrganizationListClient` posts `{ sessionId }` to `/v1/org/list`.
- AppShell renders `已加入组织：Liteasy AI Reading Lab、Liteasy Literature Ops`.
- Clicking `查看 Liteasy Literature Ops` reloads organization details and governance for `org-demo-2`.
- Dev-cloud returns a deterministic two-organization demo list.

- [x] **Step 2: Implement organization list client and hook**

Create a list client and `useOrganizationList` hook that loads after cloud account login and validates organization id, name, role, member count, and shared-library name.

- [x] **Step 3: Thread selected organization into summary and governance**

Allow `organizationSummaryClient` to post optional `organizationId`, store `selectedOrganizationId` in `AppShell`, and pass the active organization into summary/governance hooks.

- [x] **Step 4: Render joined organizations and switch buttons**

Show the joined organization list in `OrganizationSpacePanel`, disable the current organization button, and switch the active organization from the panel.

- [x] **Step 5: Extend dev-cloud demo data**

Add `/v1/org/list`, add a second demo organization (`Liteasy Literature Ops`), and return organization-specific summary/governance payloads.

- [x] **Step 6: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/organizationListClient.test.ts src/tests/organizationSummaryClient.test.ts src/tests/organizationGovernanceClient.test.ts src/tests/AppShell.test.tsx -t "organization|组织|governance|共享"
node --test --test-name-pattern "demo organization list|organization-specific governance|demo organization summary|demo organization governance" services/dev-cloud/server.test.mjs
```

Expected: both pass.

### Task 6: Registered organization shared-library action

**Files:**
- Modify: `desktop/src/app/features/assistant/commandRouter.ts`
- Modify: `desktop/src/app/features/assistant/AssistantPane.tsx`
- Modify: `desktop/src/app/features/skills/actionRegistry.ts`
- Modify: `desktop/src/app/features/skills/skillRegistry.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Test: `desktop/src/tests/commandRouter.test.ts`
- Test: `desktop/src/tests/actionRegistry.test.ts`
- Test: `desktop/src/tests/AppShell.test.tsx`

- [x] **Step 1: Write failing command/action tests**

Add tests for:

- `打开组织共享文献库` routes to `organization.open_shared_library`.
- `organization.open_shared_library` executes only through `actionRegistry`.
- AppShell command mode opens the shared library and displays `已打开组织共享文献库：组织共享文献库。`.

- [x] **Step 2: Register the command and skill**

Map the natural-language command to `organization.open_shared_library` in `commandRouter.ts` and `skillRegistry.ts`.

- [x] **Step 3: Add the registered action**

Add `organization.open_shared_library` to `ActionInvocation` and execute it through `openOrganizationSharedLibrary` in `ActionContext`.

- [x] **Step 4: Wire AssistantPane and AppShell**

Pass `onOpenOrganizationSharedLibrary` into `AssistantPane`, then into `executeSkill` context.

- [x] **Step 5: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/commandRouter.test.ts src/tests/actionRegistry.test.ts src/tests/AppShell.test.tsx -t "organization shared|打开组织共享|registered assistant command"
```

Expected: command passes.

### Task 6C: Left-rail organization entry dialog

**Files:**
- Create: `desktop/src/app/features/organization/OrganizationEntryDialog.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/styles/app.css`
- Test: `desktop/src/tests/AppShell.test.tsx`

- [x] **Step 1: Write failing organization-entry dialog test**

Add an AppShell test that logs into the demo cloud account, clicks the left `组织` entry, expects a `组织窗口` dialog, then clicks `打开 Liteasy Literature Ops 详情` and verifies:

- `组织详情：Liteasy Literature Ops`
- `成员：Liteasy Researcher（管理员）、Ops Reviewer（审核员）`
- `通知：文献库变更 · 文献运营共享库新增 QA 目录。`
- `共享文献库：文献运营共享库 · 16 篇`

- [x] **Step 2: Create the organization entry dialog**

Render a lightweight dialog matching the core spec's `组织 → 用户加入的组织列表 → 组织详情` flow. Keep it prototype-only and reuse the existing organization list/summary data.

- [x] **Step 3: Add the left-rail organization entry**

Add `组织 / 个人中心 / 设置` actions at the top of the left pane. Only `组织` opens the new dialog in this slice; `个人中心` and `设置` remain visual placeholders.

- [x] **Step 4: Wire selection and shared-library action**

Clicking an organization inside the dialog updates `selectedOrganizationId`, refreshes the active summary/governance flow, and exposes `在工作区打开共享文献库`.

- [x] **Step 5: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/AppShell.test.tsx -t "organization|组织|governance|共享|entry dialog"
```

Expected: organization dialog and existing organization tests pass.

### Task 6D: Left-rail personal center profile prototype

**Files:**
- Create: `desktop/src/app/features/profile/PersonalCenterPanel.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/styles/app.css`
- Test: `desktop/src/tests/AppShell.test.tsx`

- [x] **Step 1: Write failing personal-center test**

Add an AppShell test that logs into the demo account, clicks `个人中心`, and verifies the left pane is replaced by `左边栏个人中心` containing nickname, user id, team, profile settings, and `用户画像：已关闭`.

- [x] **Step 2: Implement the personal center panel**

Create a left-pane panel that follows the core spec: basic identity, team, gender/age/stage placeholders, a user-profile sampling toggle, reading count, academic personality, academic archive button, and clear-profile button.

- [x] **Step 3: Wire the left-rail view state**

Add `leftRailView` and `profileSamplingEnabled` state to `AppShell`; clicking `个人中心` replaces the library workspace in the left pane, and `返回文献库` restores it.

- [x] **Step 4: Keep data prototype-only**

Use current account session, active organization summary, and local workspace paper count only. Do not add persistence, real profile sampling, local app data collection, or auth-gated deletion in this slice.

- [x] **Step 5: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/AppShell.test.tsx -t "personal center|organization entry dialog|organization|组织"
```

Expected: personal center and existing left-rail organization tests pass.

### Task 6E: Academic archive page seam

**Files:**
- Create: `desktop/src/app/features/profile/AcademicArchiveDialog.tsx`
- Modify: `desktop/src/app/features/profile/PersonalCenterPanel.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/styles/app.css`
- Test: `desktop/src/tests/AppShell.test.tsx`

- [x] **Step 1: Write failing academic-archive test**

Add an AppShell test that opens `个人中心`, enables `用户画像`, clicks `学术档案`, and expects a `学术档案页面` dialog with owner, identity configuration, reading statistics, academic personality, and authorization status.

- [x] **Step 2: Create the academic archive dialog**

Render a lightweight modal page for user-profile configuration files. Keep the data demo-only and use the current account name plus local workspace paper count.

- [x] **Step 3: Wire the personal center archive button**

Add `onOpenAcademicArchive` to `PersonalCenterPanel`, manage `academicArchiveOpen` in `AppShell`, and keep this independent from real local-data authorization.

- [x] **Step 4: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/AppShell.test.tsx -t "personal center|academic archive|organization entry dialog|organization|组织"
```

Expected: academic archive, personal center, and existing organization UI tests pass.

### Task 6F: Clear-profile confirmation seam

**Files:**
- Create: `desktop/src/app/features/profile/ClearProfileConfirmDialog.tsx`
- Modify: `desktop/src/app/features/profile/PersonalCenterPanel.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/styles/app.css`
- Test: `desktop/src/tests/AppShell.test.tsx`

- [x] **Step 1: Write failing clear-profile test**

Add an AppShell test that opens `个人中心`, enables `用户画像`, clicks `清空用户画像（需鉴权）`, expects `清空用户画像确认`, then clicks `确认清空用户画像`.

- [x] **Step 2: Create the confirmation dialog**

Render a demo confirmation dialog explaining that gender, age, stage, reading statistics, and academic personality cache are cleared while nickname, user id, and avatar are retained.

- [x] **Step 3: Wire the clearing state flow**

Add `clearProfileConfirmOpen` and `profileClearMessage` to `AppShell`; confirming clears the dialog, turns profile sampling off, and displays `用户画像已清空，基础身份信息已保留。`.

- [x] **Step 4: Keep auth prototype-only**

Do not implement real password, biometric, OAuth, or cloud-side deletion. This slice only makes the required auth-gated action visible and safe in the prototype.

- [x] **Step 5: Run focused tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/AppShell.test.tsx -t "personal center|academic archive|clearing the user profile|organization entry dialog|organization|组织"
```

Expected: clear-profile, personal center, academic archive, and organization UI tests pass.

### Task 7: Phase 3 tester-facing docs

**Files:**
- Create: `docs/qa/phase3-test-guide.md`
- Create: `docs/qa/phase3-governance-limitations.md`
- Modify: `docs/qa/environment-startup-guide.md`
- Modify: `README.md`

- [x] **Step 1: Document the manual organization-space walkthrough**

Create `docs/qa/phase3-test-guide.md` with steps to start dev-cloud, start desktop, connect the demo cloud account, and verify the organization-space card fields.

- [x] **Step 2: Document governance limitations**

Create `docs/qa/phase3-governance-limitations.md` stating that organization membership, shared library browsing, quota, audit, and task visibility are demo seams without production auth or persistence.

- [x] **Step 3: Update startup and README references**

Add Phase 3 organization-space notes to `docs/qa/environment-startup-guide.md` and `README.md` without removing Phase 2 instructions.

- [x] **Step 4: Run documentation presence checks**

Run:

```bash
test -f docs/qa/phase3-test-guide.md
test -f docs/qa/phase3-governance-limitations.md
rg "组织空间" README.md docs/qa/environment-startup-guide.md docs/qa/phase3-test-guide.md docs/qa/phase3-governance-limitations.md
```

Expected: all commands pass and print organization-space references.

### Task 8: Phase 3 slice verification

**Files:**
- Modify: `docs/superpowers/plans/2026-05-10-liteasy-phase3-organization-and-governance.md`

- [x] **Step 1: Run the focused test suite**

Run:

```bash
cd desktop && npm test -- src/tests/organizationSummaryClient.test.ts src/tests/AppShell.test.tsx
node --test services/dev-cloud/server.test.mjs
```

- [x] **Step 2: Run the desktop build**

Run: `cd desktop && npm run build`

- [x] **Step 3: Run the dev-cloud provider tests**

Run: `node --test services/dev-cloud/server.test.mjs services/dev-cloud/providers/openaiResponses.test.mjs`

- [x] **Step 4: Update current status**

Mark the first organization-space slice as complete in this plan only after the commands above pass.

### Task 9: Left-rail information architecture correction

**Context:** Product review clarified that `左边栏` is a VSCode-like far-left activity bar, while `左栏` is the content pane. The right pane must stay as a minimal AI assistant conversation area.

**Files:**
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/styles/app.css`
- Create: `desktop/src/app/features/organization/OrganizationSidebarPanel.tsx`
- Modify: `desktop/src/app/features/library/LibraryPane.tsx`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `services/dev-cloud/server.mjs`
- Modify: `services/dev-cloud/server.test.mjs`
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`
- Modify: `docs/qa/environment-startup-guide.md`
- Modify: `README.md`

- [x] **Step 1: Add red tests for the corrected layout**

Add AppShell tests proving that the right pane is only `右栏AI助手`, admin cards are not inside it, model details live in `左边栏设置`, and organization/governance live in `左边栏组织`.

- [x] **Step 2: Make dev-cloud root helpful**

Add a `GET /` service index so opening `http://127.0.0.1:8787/` returns endpoint guidance instead of `not_found`.

- [x] **Step 3: Split activity bar from left pane**

Render a far-left activity bar with `文献库 / 组织 / 个人中心 / 设置`; keep `我的文献库` in the adjacent left pane and remove the low-value `关闭工作区` button.

- [x] **Step 4: Move settings out of the right pane**

Keep model policy and document metadata sync inside `左边栏设置`; retain only a small topbar model indicator on the main page.

- [x] **Step 5: Move organization governance to organization page**

Move organization summary and governance cards to `左边栏组织`; keep `组织窗口` as a detail dialog launched from that page.

- [x] **Step 6: Keep right pane minimal**

Render the right pane as the AI assistant conversation only, without organization, governance, model policy, or metadata sync cards.

- [x] **Step 7: Update docs for the new information architecture**

Update README and QA docs to distinguish `左边栏` from `左栏`, document the dev-cloud root index, and remove outdated right-card instructions.


### Task 10: Organization notification read-state seam

**Context:** Product review and Phase 3 limitations call out notification state. This slice keeps it local and demo-only while exposing the intended interaction.

**Files:**
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/features/organization/OrganizationSidebarPanel.tsx`
- Modify: `desktop/src/app/features/organization/OrganizationSpacePanel.tsx`
- Modify: `desktop/src/app/styles/app.css`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`

- [x] **Step 1: Add the failing notification read-state test**

Add an AppShell test that loads the organization page, expects `未读通知：2 条`, clicks `全部标记已读`, and expects `未读通知：0 条` plus `组织通知已全部标记为已读。`.

- [x] **Step 2: Add local read-state wiring**

Store read notification ids in `AppShell` state, pass them through the organization sidebar, and render per-notification status in `OrganizationSpacePanel`.

- [x] **Step 3: Preserve existing notification detail behavior**

Keep the existing `通知：类型 · 文案` rows unchanged while rendering read/unread status as a separate footnote.

- [x] **Step 4: Update tester-facing docs and limitations**

Document that this is a session-local demo seam, not persisted notification state.


### Task 11: Organization notification read-state hardening

**Context:** Additional QA found a realistic edge case: multiple organizations may emit the same notification id, so read-state must not be keyed by notification id alone.

**Files:**
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/features/organization/OrganizationSpacePanel.tsx`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`

- [x] **Step 1: Reproduce the cross-organization read-state bug**

Add an AppShell test where `org-demo-1` and `org-demo-2` both return `notice-1`; marking org 1 notifications read must not make org 2 notifications read.

- [x] **Step 2: Key read state by organization and notification**

Store/read notification ids as `organizationId:notificationId` keys in both the AppShell marker and the organization panel unread calculation.

- [x] **Step 3: Run focused regression tests**

Run the read-state focused AppShell tests and verify both the original mark-all-read path and the cross-organization isolation path pass.


### Task 12: Organization notification local persistence

**Context:** After read-state isolation, the next bug-prevention slice is preserving local notification read state across remounts/reloads without claiming cloud persistence.

**Files:**
- Create: `desktop/src/app/features/organization/organizationNotificationStorage.ts`
- Create: `desktop/src/tests/organizationNotificationStorage.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/features/models/usePolicySync.ts`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`

- [x] **Step 1: Add notification storage unit tests**

Verify storage deduplicates valid `organizationId:notificationId` keys and ignores malformed localStorage payloads.

- [x] **Step 2: Add AppShell restore regression test**

Mark organization notifications read, unmount/remount `AppShell`, and verify the same organization notification remains read from localStorage.

- [x] **Step 3: Wire storage into AppShell**

Initialize `readOrganizationNotificationIds` from storage and store updated keys when notifications are marked read.

- [x] **Step 4: Harden async policy sync during unmount**

Guard policy-sync state updates after unmount to avoid test-environment teardown warnings and false positives.


### Task 13: Organization notification logout cleanup

**Context:** Local notification read-state persistence should not leak across account switches. Logging out of the cloud account must clear local organization notification state.

**Files:**
- Modify: `desktop/src/app/features/organization/organizationNotificationStorage.ts`
- Modify: `desktop/src/tests/organizationNotificationStorage.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`

- [x] **Step 1: Add storage clear test**

Verify `clearStoredOrganizationReadNotificationKeys()` removes the localStorage payload.

- [x] **Step 2: Add logout cleanup regression test**

Seed local notification read-state, log into the demo account, click `断开云账号`, and verify notification read-state storage is removed.

- [x] **Step 3: Wire logout cleanup**

Wrap cloud logout in `AppShell` so it clears in-memory read ids, removes local notification storage, and resets the selected organization id.


### Task 14: Organization invite confirmation seam

**Context:** Phase 3 organization work needs visible seams for membership workflows without pretending real invitation backends exist.

**Files:**
- Create: `desktop/src/app/features/organization/OrganizationInviteConfirmDialog.tsx`
- Modify: `desktop/src/app/features/organization/OrganizationSidebarPanel.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/styles/app.css`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`

- [x] **Step 1: Add failing invite confirmation tests**

Cover the organization page `邀请成员` button, confirmation dialog, send path, and cancel path.

- [x] **Step 2: Add the invite confirmation dialog**

Render `OrganizationInviteConfirmDialog` with explicit demo-only copy and no real email/backend side effect.

- [x] **Step 3: Wire AppShell demo invite state**

Track the organization being invited, show the dialog, clear it on cancel/send, and show a center-pane hint after sending the demo invite.

- [x] **Step 4: Document demo boundaries**

Update QA and limitations to say invitations are UI seams only until membership and permission backends exist.


### Task 15: Organization leave confirmation seam

**Context:** Membership workflows need destructive-action affordances without pretending demo organizations can be truly removed. Exiting an organization should require explicit confirmation and leave the demo data intact until a real membership backend exists.

**Files:**
- Create: `desktop/src/app/features/organization/OrganizationLeaveConfirmDialog.tsx`
- Modify: `desktop/src/app/features/organization/OrganizationSidebarPanel.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`

- [x] **Step 1: Add failing leave confirmation tests**

Cover the organization page `退出组织` button, confirmation dialog, confirm path, and cancel path before implementation.

- [x] **Step 2: Add the leave confirmation dialog**

Render `OrganizationLeaveConfirmDialog` with explicit demo-only copy and no real membership or shared-library side effect.

- [x] **Step 3: Wire AppShell demo leave state**

Track the organization being left, show the dialog, clear it on cancel/confirm, and show a center-pane hint after creating the demo leave request.

- [x] **Step 4: Document demo boundaries**

Update QA and limitations to clarify that leaving an organization is a UI seam only until membership and permission backends exist.


### Task 16: Organization creation request seam

**Context:** The core UI spec says users can create organizations, but Phase 3 still has no membership, billing, or cloud-space backend. Add an explicit creation-request seam instead of mutating the demo organization list.

**Files:**
- Create: `desktop/src/app/features/organization/OrganizationCreateDialog.tsx`
- Modify: `desktop/src/app/features/organization/OrganizationSidebarPanel.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/styles/app.css`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`

- [x] **Step 1: Add failing creation seam tests**

Cover the organization page `创建组织` button, default organization name, demo-only copy, confirm path, and cancel path before implementation.

- [x] **Step 2: Add the creation dialog**

Render `OrganizationCreateDialog` with a small organization-name field and explicit copy that no real backend, cloud-space, package, or billing workflow runs.

- [x] **Step 3: Wire AppShell demo creation state**

Show the dialog from the organization page, clear it on cancel/confirm, and show a center-pane hint after creating the demo organization request without changing the joined organization list.

- [x] **Step 4: Document demo boundaries**

Update QA and limitations to clarify that organization creation is a UI seam only until membership, billing, and permission backends exist.


### Task 17: Organization join request seam

**Context:** The core UI spec says users can join organizations, but Phase 3 still has no invitation lifecycle, membership write model, or admin approval backend. Add an explicit join-request seam with a demo invite code.

**Files:**
- Create: `desktop/src/app/features/organization/OrganizationJoinDialog.tsx`
- Modify: `desktop/src/app/features/organization/OrganizationSidebarPanel.tsx`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `docs/qa/phase3-test-guide.md`
- Modify: `docs/qa/phase3-governance-limitations.md`

- [x] **Step 1: Add failing join seam tests**

Cover the organization page `加入组织` button, default invite code, demo-only copy, confirm path, and cancel path before implementation.

- [x] **Step 2: Add the join dialog**

Render `OrganizationJoinDialog` with an invite-code field and explicit copy that no real invite validation, membership write, or approval workflow runs.

- [x] **Step 3: Wire AppShell demo join state**

Show the dialog from the organization page, clear it on cancel/confirm, and show a center-pane hint after creating the demo join request without changing the joined organization list.

- [x] **Step 4: Document demo boundaries**

Update QA and limitations to clarify that organization joining is a UI seam only until invitation, membership, and permission backends exist.


### Task 18: Organization action state hook extraction

**Context:** After adding create, join, invite, and leave seams, `AppShell` was carrying too much organization action state. Extracting that state into a dedicated hook keeps the prototype easier to review and reduces risk when replacing demo seams with real backends.

**Files:**
- Create: `desktop/src/app/features/organization/useOrganizationActions.ts`
- Create: `desktop/src/tests/useOrganizationActions.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `docs/superpowers/plans/2026-05-10-liteasy-phase3-organization-and-governance.md`

- [x] **Step 1: Add failing hook tests**

Cover create, join, invite, leave, and reset behavior at the hook boundary before implementation.

- [x] **Step 2: Implement the hook**

Move dialog state and demo message generation into `useOrganizationActions` without changing visible behavior.

- [x] **Step 3: Wire AppShell to the hook**

Replace local AppShell organization action state with hook outputs and preserve logout cleanup.

- [x] **Step 4: Run focused and full verification**

Run hook tests, focused organization AppShell tests, full desktop tests, desktop build, and dev-cloud tests.


### Task 19: Organization notification state hook extraction

**Context:** Notification read-state persistence and logout cleanup were still wired directly through `AppShell`. Extracting them into a dedicated hook keeps AppShell focused on layout orchestration and gives notification state an isolated test boundary.

**Files:**
- Create: `desktop/src/app/features/organization/useOrganizationNotifications.ts`
- Create: `desktop/src/tests/useOrganizationNotifications.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `docs/superpowers/plans/2026-05-10-liteasy-phase3-organization-and-governance.md`

- [x] **Step 1: Add failing notification hook tests**

Cover organization-scoped read keys, localStorage persistence, restore, and clear behavior before implementation.

- [x] **Step 2: Implement the notification hook**

Move read-state initialization, mark-all-read behavior, storage writes, and clear behavior into `useOrganizationNotifications`.

- [x] **Step 3: Wire AppShell to the hook**

Replace AppShell's local notification state with hook outputs while preserving organization page rendering and logout cleanup.

- [x] **Step 4: Run focused and full verification**

Run notification hook tests, focused AppShell notification/logout tests, full desktop tests, desktop build, and dev-cloud tests.


### Task 20: Organization shared-library workspace hook extraction

**Context:** Opening an organization shared library and returning to the local library are core workspace transitions. Extracting this behavior from `AppShell` keeps the VSCode-like workspace-switch semantics isolated and easier to replace with a real cloud library backend later.

**Files:**
- Create: `desktop/src/app/features/organization/useOrganizationWorkspace.ts`
- Create: `desktop/src/tests/useOrganizationWorkspace.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `docs/superpowers/plans/2026-05-10-liteasy-phase3-organization-and-governance.md`

- [x] **Step 1: Add failing workspace hook tests**

Cover opening organization shared-library documents as a replacement workspace, returning to starter local papers, and the missing-summary guard.

- [x] **Step 2: Implement the workspace hook**

Move workspace replacement, label updates, left-rail switching, and analysis hints into `useOrganizationWorkspace`.

- [x] **Step 3: Wire AppShell to the hook**

Replace AppShell's inline shared-library and local-library functions with hook outputs while preserving the organization panel, dialog, and assistant command paths.

- [x] **Step 4: Fix hook ordering regression**

Keep the hook call after `useOrganizationSummary` so the default organization summary is initialized before the workspace hook receives it.

- [x] **Step 5: Run focused and full verification**

Run workspace hook tests, focused AppShell shared-library tests, full desktop tests, desktop build, and dev-cloud tests.


### Task 21: Profile action state hook extraction

**Context:** Personal center profile state was still managed directly in `AppShell`. Extracting profile sampling, academic archive, and clear-profile confirmation state into a dedicated hook keeps profile behavior independently testable and reduces AppShell surface area.

**Files:**
- Create: `desktop/src/app/features/profile/useProfileActions.ts`
- Create: `desktop/src/tests/useProfileActions.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `docs/superpowers/plans/2026-05-10-liteasy-phase3-organization-and-governance.md`

- [x] **Step 1: Add failing profile hook tests**

Cover academic archive open/close, profile sampling toggles, clear-profile confirmation open/close, and confirmed clearing behavior.

- [x] **Step 2: Implement the profile hook**

Move profile sampling state, clear-profile message, archive dialog state, and clear confirmation state into `useProfileActions`.

- [x] **Step 3: Wire AppShell to the hook**

Replace AppShell's local profile state and callbacks with hook outputs while preserving the personal center and dialog behavior.

- [x] **Step 4: Run focused and full verification**

Run profile hook tests, focused AppShell profile tests, full desktop tests, desktop build, and dev-cloud tests.


### Task 22: Left-rail navigation hook extraction

**Context:** The VSCode-like activity bar state was still managed directly in `AppShell`. Extracting it into a dedicated hook gives the left-rail navigation a small test boundary and keeps layout orchestration easier to reason about.

**Files:**
- Create: `desktop/src/app/layout/useLeftRailNavigation.ts`
- Create: `desktop/src/tests/useLeftRailNavigation.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `docs/superpowers/plans/2026-05-10-liteasy-phase3-organization-and-governance.md`

- [x] **Step 1: Add failing navigation hook tests**

Cover default library view, activity-bar transitions, pane header labels, and direct setter support for workspace-switching hooks.

- [x] **Step 2: Implement the navigation hook**

Move left-rail view state, activity-bar open helpers, and pane header derivation into `useLeftRailNavigation`.

- [x] **Step 3: Wire AppShell to the hook**

Replace AppShell's local left-rail state with hook outputs while preserving organization, profile, settings, and shared-library navigation behavior.

- [x] **Step 4: Run focused and full verification**

Run navigation hook tests, focused AppShell layout tests, full desktop tests, desktop build, and dev-cloud tests.


### Task 23: Organization UI state hook extraction

**Context:** Organization dialog open state and selected organization id were still managed directly in `AppShell`. Extracting them into a small hook keeps organization UI state isolated from organization data fetching and action seams.

**Files:**
- Create: `desktop/src/app/features/organization/useOrganizationUiState.ts`
- Create: `desktop/src/tests/useOrganizationUiState.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `docs/superpowers/plans/2026-05-10-liteasy-phase3-organization-and-governance.md`

- [x] **Step 1: Add failing organization UI hook tests**

Cover organization dialog open/close, selecting an organization, deriving the active organization id from selection or list fallback, and resetting selection.

- [x] **Step 2: Implement the organization UI hook**

Move organization dialog state, selected organization id, selection reset, and active-id derivation into `useOrganizationUiState`.

- [x] **Step 3: Wire AppShell to the hook**

Replace AppShell's local organization dialog and selection state with hook outputs while preserving organization list, details, governance, and logout cleanup behavior.

- [x] **Step 4: Run focused and full verification**

Run organization UI hook tests, focused AppShell organization tests, full desktop tests, desktop build, and dev-cloud tests.


### Task 24: Organization data hook aggregation

**Context:** `AppShell` still orchestrated organization list, summary, and governance hooks directly. Aggregating these into a feature-level hook keeps the organization data flow together and reduces layout coupling before replacing demo endpoints with real services.

**Files:**
- Create: `desktop/src/app/features/organization/useOrganizationData.ts`
- Create: `desktop/src/tests/useOrganizationData.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `docs/superpowers/plans/2026-05-10-liteasy-phase3-organization-and-governance.md`

- [x] **Step 1: Add failing organization data hook tests**

Cover loading joined organizations, deriving the selected active organization, requesting the selected organization summary, and then requesting selected organization governance.

- [x] **Step 2: Implement the organization data hook**

Compose `useOrganizationList`, `useOrganizationSummary`, and `useOrganizationGovernance` behind `useOrganizationData`.

- [x] **Step 3: Wire AppShell to the aggregate hook**

Replace AppShell's direct organization data hook calls with `useOrganizationData` while preserving organization page, dialog, governance, and shared-library behavior.

- [x] **Step 4: Run focused and full verification**

Run organization data hook tests, focused AppShell organization tests, full desktop tests, desktop build, and dev-cloud tests.


### Task 25: Collection state hook extraction

**Context:** Local collection state and persistence were still managed directly in `AppShell`. Extracting them into a collection hook keeps library recommendation collection behavior independently testable and reduces AppShell state surface.

**Files:**
- Create: `desktop/src/app/features/collection/useCollectionItems.ts`
- Create: `desktop/src/tests/useCollectionItems.test.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `docs/superpowers/plans/2026-05-10-liteasy-phase3-organization-and-governance.md`

- [x] **Step 1: Add failing collection hook tests**

Cover restoring stored collection items, collecting a recommendation at the top, replacing duplicates, and writing the next collection to localStorage.

- [x] **Step 2: Implement the collection hook**

Move collection initialization, recommendation collection, duplicate replacement, and persistence into `useCollectionItems`.

- [x] **Step 3: Wire AppShell to the hook**

Replace AppShell's local collection state and collect callback with hook outputs while preserving LibraryPane behavior.

- [x] **Step 4: Run focused and full verification**

Run collection hook tests, focused AppShell library/recommendation tests, full desktop tests, desktop build, and dev-cloud tests.
