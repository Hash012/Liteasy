# LiteasyClaw User Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the confirmed LiteasyClaw user-workbench UI and interaction model: a B1-style academic workbench, `24 / 52 / 24` resizable three-pane layout, unified lightweight login modal, and a local-reader fallback mode when cloud capability is unavailable.

**Architecture:** This plan works inside the existing desktop client and refines the customer-facing workbench layer without changing the larger product boundary. It introduces a persistent pane-layout model, a unified login-modal flow, local-reader fallback states across cloud-facing entry points, and a more disciplined, non-floating visual language grounded in the confirmed B1 design direction.

**Tech Stack:** Existing `Tauri 2`, `React`, `TypeScript`, `Vitest`, `Testing Library`, current desktop feature/layout modules

---

## Scope Summary

This plan implements the confirmed user-facing workbench behavior only.

It includes:

- B1 workbench visual refinement
- `24 / 52 / 24` default layout
- draggable and collapsible left/right panes
- unified lightweight login modal
- local-reader fallback states for cloud-dependent entry points
- top-bar cloud-capability indicator

It does not implement:

- formal production auth
- backend billing or subscription logic
- formal organization permission backend
- full artifact pipeline redesign

## File Responsibilities

- `LiteasyClaw/desktop/src/app/layout/AppShell.tsx`: top-level workbench composition and state wiring.
- `LiteasyClaw/desktop/src/app/layout/TopBar.tsx`: top-bar shell, cloud-capability indicator, and account entry.
- `LiteasyClaw/desktop/src/app/features/account/AccountStatusPanel.tsx`: account area visuals and login entry.
- `LiteasyClaw/desktop/src/app/layout/AppDialogs.tsx`: add or host the unified lightweight login modal if this is the existing dialog composition point.
- `LiteasyClaw/desktop/src/app/features/account/*`: login session hooks and lightweight login flow wiring.
- `LiteasyClaw/desktop/src/app/layout/LeftPane.tsx`: left-pane view composition.
- `LiteasyClaw/desktop/src/app/layout/ReaderPane.tsx`: center-pane rendering shell.
- `LiteasyClaw/desktop/src/app/layout/AssistantSidebar.tsx`: right-pane rendering shell.
- `LiteasyClaw/desktop/src/app/layout/useAppShellStores.ts`: if needed, persist pane-layout settings.
- `LiteasyClaw/desktop/src/app/features/settings/settings.store.ts`: if pane layout or “do not remind again” is persisted here.
- `LiteasyClaw/desktop/src/app/features/network/useConnectivity.ts`: local connectivity input.
- `LiteasyClaw/desktop/src/app/features/network/useCloudAvailabilityProbe.ts`: cloud reachability probe.
- `LiteasyClaw/desktop/src/app/layout/cloudAvailability.ts`: cloud-capability status derivation.
- `LiteasyClaw/desktop/src/app/features/recommendations/useRecommendations.ts`: recommendation fallback behavior.
- `LiteasyClaw/desktop/src/app/features/metadata/useDocumentMetadataSync.ts`: metadata-sync fallback behavior.
- `LiteasyClaw/desktop/src/app/features/organization/useOrganizationSummary.ts`: organization-space fallback behavior.
- `LiteasyClaw/desktop/src/app/features/organization/useOrganizationList.ts`: organization-list fallback behavior.
- `LiteasyClaw/desktop/src/app/features/organization/useOrganizationGovernance.ts`: organization-governance fallback behavior.
- `LiteasyClaw/desktop/src/app/features/organization/useOrganizationWorkspace.ts`: organization shared-library gating.
- `LiteasyClaw/desktop/src/app/styles/app.css`: confirmed B1 visual language and non-floating workbench styling.
- `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`: end-to-end shell behavior verification.
- `LiteasyClaw/desktop/src/tests/TopBar.test.tsx`: top-bar and cloud-capability indicator verification.
- `LiteasyClaw/desktop/src/tests/useRecommendations.test.ts`: recommendation fallback verification.
- `LiteasyClaw/desktop/src/tests/useOrganizationData.test.ts`: organization fallback verification.
- `LiteasyClaw/desktop/src/tests/useOrganizationWorkspace.test.ts`: organization shared-library gating verification.
- `LiteasyClaw/desktop/src/tests/useConnectivity.test.ts`: connectivity hook verification.
- `LiteasyClaw/desktop/src/tests/useCloudAvailabilityProbe.test.ts`: cloud probe verification.
- `LiteasyClaw/desktop/src/tests/cloudAvailability.test.ts`: cloud-capability state derivation verification.

### Task 1: Add a persistent pane-layout model with `24 / 52 / 24` default ratio

**Files:**
- Create: `LiteasyClaw/desktop/src/app/layout/paneLayout.types.ts`
- Create: `LiteasyClaw/desktop/src/app/layout/paneLayout.storage.ts`
- Create: `LiteasyClaw/desktop/src/app/layout/usePaneLayout.ts`
- Test: `LiteasyClaw/desktop/src/tests/usePaneLayout.test.ts`
- Modify: `LiteasyClaw/desktop/src/app/layout/AppShell.tsx`

- [ ] **Step 1: Write the failing pane-layout persistence test**

```ts
import { act, renderHook } from "@testing-library/react";
import { usePaneLayout } from "../app/layout/usePaneLayout";

test("starts with the confirmed default layout and persists user changes", () => {
  const { result } = renderHook(() => usePaneLayout());

  expect(result.current.layout).toEqual({
    center: 52,
    left: 24,
    right: 24,
  });

  act(() => {
    result.current.setLayout({ center: 58, left: 22, right: 20 });
  });

  expect(result.current.layout).toEqual({
    center: 58,
    left: 22,
    right: 20,
  });
});
```

- [ ] **Step 2: Run the pane-layout test to verify it fails**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/usePaneLayout.test.ts`
Expected: FAIL because the pane-layout hook does not exist yet.

- [ ] **Step 3: Add the minimal pane-layout types, storage, and hook**

```ts
// LiteasyClaw/desktop/src/app/layout/paneLayout.types.ts
export type PaneLayout = {
  center: number;
  left: number;
  right: number;
};

export const defaultPaneLayout: PaneLayout = {
  center: 52,
  left: 24,
  right: 24,
};
```

```ts
// LiteasyClaw/desktop/src/app/layout/paneLayout.storage.ts
import { defaultPaneLayout, type PaneLayout } from "./paneLayout.types";

const storageKey = "liteasy.ui.pane-layout.v1";

export function loadPaneLayout(): PaneLayout {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return defaultPaneLayout;
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.left === "number" &&
      typeof parsed?.center === "number" &&
      typeof parsed?.right === "number"
    ) {
      return parsed;
    }
  } catch {}

  return defaultPaneLayout;
}

export function savePaneLayout(layout: PaneLayout) {
  window.localStorage.setItem(storageKey, JSON.stringify(layout));
}
```

```ts
// LiteasyClaw/desktop/src/app/layout/usePaneLayout.ts
import { useState } from "react";
import { loadPaneLayout, savePaneLayout } from "./paneLayout.storage";
import type { PaneLayout } from "./paneLayout.types";

export function usePaneLayout() {
  const [layout, setLayoutState] = useState(loadPaneLayout);

  function setLayout(next: PaneLayout) {
    setLayoutState(next);
    savePaneLayout(next);
  }

  return {
    layout,
    setLayout,
  };
}
```

- [ ] **Step 4: Run the pane-layout test to verify it passes**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/usePaneLayout.test.ts`
Expected: PASS

- [ ] **Step 5: Wire AppShell to read the layout state**

Update `AppShell.tsx` to call `usePaneLayout()` and pass the current ratios into the shell grid style.

- [ ] **Step 6: Commit the pane-layout baseline**

```bash
git add LiteasyClaw/desktop/src/app/layout/paneLayout.types.ts LiteasyClaw/desktop/src/app/layout/paneLayout.storage.ts LiteasyClaw/desktop/src/app/layout/usePaneLayout.ts LiteasyClaw/desktop/src/tests/usePaneLayout.test.ts LiteasyClaw/desktop/src/app/layout/AppShell.tsx
git commit -m "docs-plan: add persistent LiteasyClaw pane layout state"
```

### Task 2: Implement draggable left/right pane resizing and collapse rails

**Files:**
- Create: `LiteasyClaw/desktop/src/app/layout/PaneResizer.tsx`
- Modify: `LiteasyClaw/desktop/src/app/layout/AppShell.tsx`
- Modify: `LiteasyClaw/desktop/src/app/styles/app.css`
- Test: `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Write the failing AppShell layout test**

Add a focused AppShell test that verifies:

- the main shell starts at the default `24 / 52 / 24`
- left and right collapse affordances exist
- collapsing a side reduces it to a rail rather than removing it entirely

Use test ids or accessible labels such as:

```ts
expect(screen.getByLabelText("折叠左栏")).toBeInTheDocument();
expect(screen.getByLabelText("折叠右栏")).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused AppShell test to verify it fails**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/AppShell.test.tsx -t "supports the confirmed workbench pane layout"`
Expected: FAIL because resizers and collapse rails do not exist yet.

- [ ] **Step 3: Add resizer and collapse UI**

Implement:

- left collapse rail
- right collapse rail
- left and right collapse buttons
- persisted collapsed state
- resizer components between left/center and center/right

Constraints:

- center pane remains the priority pane
- left and right do not collapse to zero
- collapsed state becomes a narrow visible rail

- [ ] **Step 4: Run the focused AppShell test to verify green**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/AppShell.test.tsx -t "supports the confirmed workbench pane layout"`
Expected: PASS

- [ ] **Step 5: Commit the workbench layout behavior**

```bash
git add LiteasyClaw/desktop/src/app/layout/PaneResizer.tsx LiteasyClaw/desktop/src/app/layout/AppShell.tsx LiteasyClaw/desktop/src/app/styles/app.css LiteasyClaw/desktop/src/tests/AppShell.test.tsx
git commit -m "docs-plan: add LiteasyClaw resizable and collapsible workbench panes"
```

### Task 3: Add the unified lightweight login modal

**Files:**
- Create: `LiteasyClaw/desktop/src/app/features/account/LightweightLoginDialog.tsx`
- Modify: `LiteasyClaw/desktop/src/app/layout/AppDialogs.tsx`
- Modify: `LiteasyClaw/desktop/src/app/features/account/useAccountSession.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/account/AccountStatusPanel.tsx`
- Test: `LiteasyClaw/desktop/src/tests/AppDialogs.test.tsx`
- Test: `LiteasyClaw/desktop/src/tests/useAccountSession.test.ts`

- [ ] **Step 1: Write the failing login-dialog test**

Add a dialog test that expects:

- the dialog opens on startup when user is not logged in
- it contains:
  - `一键 Demo 登录`
  - `跳过，进入本地阅读器`
  - `不再提醒`

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/AppDialogs.test.tsx -t "shows the lightweight login dialog for logged-out startup"`
Expected: FAIL because the login dialog does not exist yet.

- [ ] **Step 3: Implement the minimal login dialog**

The dialog should:

- open on startup when no session exists
- be dismissible by skip
- allow “do not remind again” to persist locally
- use the same login handler as the top-right login button

- [ ] **Step 4: Update account-session hook for reminder preference**

Extend the local startup flow so:

- if the reminder is disabled, startup does not auto-open the dialog
- if the reminder is enabled and user is logged out, startup opens the dialog

- [ ] **Step 5: Run focused login-dialog tests**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/AppDialogs.test.tsx -t "shows the lightweight login dialog for logged-out startup"
cd LiteasyClaw/desktop && npm test -- src/tests/useAccountSession.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the unified login entry**

```bash
git add LiteasyClaw/desktop/src/app/features/account/LightweightLoginDialog.tsx LiteasyClaw/desktop/src/app/layout/AppDialogs.tsx LiteasyClaw/desktop/src/app/features/account/useAccountSession.ts LiteasyClaw/desktop/src/app/features/account/AccountStatusPanel.tsx LiteasyClaw/desktop/src/tests/AppDialogs.test.tsx LiteasyClaw/desktop/src/tests/useAccountSession.test.ts
git commit -m "docs-plan: add unified LiteasyClaw lightweight login dialog"
```

### Task 4: Implement local-reader fallback states in left rail and organization entry

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/library/LibraryPane.tsx`
- Modify: `LiteasyClaw/desktop/src/app/features/organization/OrganizationSidebarPanel.tsx`
- Modify: `LiteasyClaw/desktop/src/app/features/recommendations/useRecommendations.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/organization/useOrganizationSummary.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/organization/useOrganizationList.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/organization/useOrganizationGovernance.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/organization/useOrganizationWorkspace.ts`
- Test: `LiteasyClaw/desktop/src/tests/useRecommendations.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/useOrganizationData.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/useOrganizationWorkspace.test.ts`

- [ ] **Step 1: Write the failing fallback-behavior assertions**

Ensure tests cover:

- favorites and recommendations stay visible but greyed/locked when logged out
- organization entry shows capability explanation with login entry
- shared-library open action says login is required

- [ ] **Step 2: Run focused tests to verify gaps**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/useRecommendations.test.ts
cd LiteasyClaw/desktop && npm test -- src/tests/useOrganizationData.test.ts
cd LiteasyClaw/desktop && npm test -- src/tests/useOrganizationWorkspace.test.ts
```

Expected: FAIL on the newly added fallback behavior assertions.

- [ ] **Step 3: Implement the local-reader fallback UI**

Required behavior:

- `我的文献库` remains usable
- `收藏` and `关联推荐` remain visible but unavailable
- organization page explains locked cloud capabilities
- login entry inside organization page opens the same lightweight login dialog

- [ ] **Step 4: Re-run focused fallback tests**

Run the same three test commands again.
Expected: PASS

- [ ] **Step 5: Commit fallback-mode behavior**

```bash
git add LiteasyClaw/desktop/src/app/features/library/LibraryPane.tsx LiteasyClaw/desktop/src/app/features/organization/OrganizationSidebarPanel.tsx LiteasyClaw/desktop/src/app/features/recommendations/useRecommendations.ts LiteasyClaw/desktop/src/app/features/organization/useOrganizationSummary.ts LiteasyClaw/desktop/src/app/features/organization/useOrganizationList.ts LiteasyClaw/desktop/src/app/features/organization/useOrganizationGovernance.ts LiteasyClaw/desktop/src/app/features/organization/useOrganizationWorkspace.ts LiteasyClaw/desktop/src/tests/useRecommendations.test.ts LiteasyClaw/desktop/src/tests/useOrganizationData.test.ts LiteasyClaw/desktop/src/tests/useOrganizationWorkspace.test.ts
git commit -m "docs-plan: add LiteasyClaw local-reader fallback behavior"
```

### Task 5: Finalize B1 workbench styling without floating panels

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/styles/app.css`
- Test: `LiteasyClaw/desktop/src/tests/TopBar.test.tsx`
- Test: `LiteasyClaw/desktop/src/tests/SettingsPane.test.tsx`
- Test: `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Add the failing visual-structure expectation where needed**

Add or refine tests around:

- top bar account status indicator
- absence of dev-cloud-specific user-facing controls
- continued shell usability after style changes

- [ ] **Step 2: Run focused shell tests**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/TopBar.test.tsx src/tests/SettingsPane.test.tsx
cd LiteasyClaw/desktop && npm test -- src/tests/AppShell.test.tsx -t "shows organization space summary after cloud account login"
```

Expected: PASS or fail only on the newly tightened visual assertions.

- [ ] **Step 3: Refine the stylesheet to fully match B1**

Ensure style rules satisfy:

- no heavy card-floating effect between left/center/right panes
- warm paper-neutral palette
- stronger structural separators
- center pane visual dominance
- softer but not decorative controls

- [ ] **Step 4: Re-run focused shell tests**

Run the same commands again.
Expected: PASS

- [ ] **Step 5: Commit the final workbench style pass**

```bash
git add LiteasyClaw/desktop/src/app/styles/app.css LiteasyClaw/desktop/src/tests/TopBar.test.tsx LiteasyClaw/desktop/src/tests/SettingsPane.test.tsx LiteasyClaw/desktop/src/tests/AppShell.test.tsx
git commit -m "docs-plan: finalize LiteasyClaw B1 workbench styling"
```

## Verification Checklist

Before claiming the plan has been implemented, run all of these:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/usePaneLayout.test.ts
cd LiteasyClaw/desktop && npm test -- src/tests/TopBar.test.tsx src/tests/useAccountSession.test.ts src/tests/useConnectivity.test.ts src/tests/useCloudAvailabilityProbe.test.ts src/tests/cloudAvailability.test.ts
cd LiteasyClaw/desktop && npm test -- src/tests/useRecommendations.test.ts src/tests/useOrganizationData.test.ts src/tests/useOrganizationWorkspace.test.ts
cd LiteasyClaw/desktop && npm test -- src/tests/SettingsPane.test.tsx src/tests/AppDialogs.test.tsx src/tests/AppShell.test.tsx
cd LiteasyClaw/desktop && npm run build
```

Expected:

- all focused tests pass
- desktop build passes
- the workbench starts logged out
- the lightweight login dialog appears on startup unless reminder is disabled
- the workbench can visibly degrade into local-reader mode
- the center pane remains the dominant work area

## Follow-On Notes

After this plan is complete, the next logical plan should cover:

- formalizing favorites as user cloud private data
- adding formal organization creation/join flows inside the workbench
- replacing demo login with real auth on the same entry surface
