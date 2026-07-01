# LiteasyClaw M1 Resource Boundary and Local Library Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize LiteasyClaw's first real SaaS-era foundation by turning the prototype local library into a real file-backed local library and codifying the five resource classes in the desktop app and local runtime seam.

**Architecture:** This milestone works entirely inside the existing desktop entry point and local runtime seam. It introduces explicit resource-scope types, a local-library Tauri capability, file-backed workspace loading, and action-policy guards so that later cloud favorites, organization resources, and cache services can build on stable ownership rules instead of demo semantics.

**Tech Stack:** `Tauri 2`, `React`, `TypeScript`, `Rust`, existing desktop test stack (`Vitest`, `Testing Library`)

---

## Scope Summary

This plan intentionally does not implement cloud favorites, organization shared-library persistence, or platform ops. It establishes the baseline required for those later milestones:

- a real local library root on disk
- a workspace loaded from the local library root
- resource-scope definitions shared by the desktop feature layer
- a first action-policy layer keyed by resource class and risk

## File Responsibilities

- `desktop/src/app/features/resources/resourceScope.types.ts`: defines the five resource classes and shared ownership metadata.
- `desktop/src/app/features/resources/resourceActionPolicy.ts`: maps actions to resource classes and risk rules.
- `desktop/src/app/features/library/localLibrary.types.ts`: typed local-library entries returned from the runtime seam.
- `desktop/src/app/features/library/localLibraryClient.ts`: thin UI-facing client for the Tauri local-library command.
- `desktop/src/app/features/library/useLocalLibrary.ts`: loads, refreshes, and normalizes the local library snapshot.
- `desktop/src/app/features/workspace/workspace.types.ts`: extends workspace state with source metadata and resource ownership fields.
- `desktop/src/app/features/workspace/workspace.store.ts`: stores the loaded workspace source and file-backed papers.
- `desktop/src/app/layout/AppShell.tsx`: wires local library loading into the app bootstrap path.
- `desktop/src/app/features/library/LibraryPane.tsx`: renders the local library root label and refresh affordance.
- `desktop/src-tauri/src/local_library.rs`: creates or opens the local library folder and returns a normalized snapshot.
- `desktop/src-tauri/src/main.rs`: registers the new local-library Tauri command.
- `desktop/src/tests/resourceActionPolicy.test.ts`: verifies resource-class and risk-policy rules.
- `desktop/src/tests/localLibraryClient.test.ts`: verifies local-library client payload parsing.
- `desktop/src/tests/AppShell.test.tsx`: verifies desktop bootstrap loads the local library workspace.
- `docs/qa/environment-startup-guide.md`: explains the local library root and how testers verify it exists.

### Task 1: Add five resource-class types and policy tests

**Files:**
- Create: `desktop/src/app/features/resources/resourceScope.types.ts`
- Create: `desktop/src/app/features/resources/resourceActionPolicy.ts`
- Test: `desktop/src/tests/resourceActionPolicy.test.ts`

- [ ] **Step 1: Write the failing resource-policy test**

```ts
import {
  getActionPolicy,
  requiresConfirmation,
} from "../app/features/resources/resourceActionPolicy";

test("requires confirmation for destructive local-library actions", () => {
  const policy = getActionPolicy("local_library.delete_file");

  expect(policy.resourceClass).toBe("local_private");
  expect(policy.riskLevel).toBe("high");
  expect(requiresConfirmation(policy)).toBe(true);
});

test("does not treat cloud cache invalidation as long-term user data deletion", () => {
  const policy = getActionPolicy("cloud_cache.invalidate_workspace_results");

  expect(policy.resourceClass).toBe("cloud_cache");
  expect(policy.riskLevel).toBe("medium");
  expect(requiresConfirmation(policy)).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && npm test -- src/tests/resourceActionPolicy.test.ts`
Expected: FAIL because the resource policy modules do not exist yet.

- [ ] **Step 3: Add the minimal resource-scope and policy modules**

```ts
// desktop/src/app/features/resources/resourceScope.types.ts
export type ResourceClass =
  | "local_private"
  | "user_cloud_private"
  | "organization_cloud_shared"
  | "platform_configuration"
  | "cloud_cache";

export type ResourceOwner =
  | { type: "device_user"; userId?: string }
  | { type: "user_account"; userId: string }
  | { type: "organization"; organizationId: string }
  | { type: "platform" }
  | { type: "cache_context"; scopeKey: string };

export type ResourceDescriptor = {
  owner: ResourceOwner;
  resourceClass: ResourceClass;
};
```

```ts
// desktop/src/app/features/resources/resourceActionPolicy.ts
import type { ResourceClass } from "./resourceScope.types";

export type ActionRiskLevel = "low" | "medium" | "high";

export type ActionPolicy = {
  actionId: string;
  requiresConfirmation: boolean;
  resourceClass: ResourceClass;
  riskLevel: ActionRiskLevel;
};

const policies: Record<string, ActionPolicy> = {
  "local_library.delete_file": {
    actionId: "local_library.delete_file",
    requiresConfirmation: true,
    resourceClass: "local_private",
    riskLevel: "high",
  },
  "cloud_cache.invalidate_workspace_results": {
    actionId: "cloud_cache.invalidate_workspace_results",
    requiresConfirmation: false,
    resourceClass: "cloud_cache",
    riskLevel: "medium",
  },
};

export function getActionPolicy(actionId: string): ActionPolicy {
  const policy = policies[actionId];
  if (!policy) {
    throw new Error(`Unknown action policy: ${actionId}`);
  }
  return policy;
}

export function requiresConfirmation(policy: ActionPolicy) {
  return policy.requiresConfirmation;
}
```

- [ ] **Step 4: Run the resource-policy test to verify it passes**

Run: `cd desktop && npm test -- src/tests/resourceActionPolicy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the resource-policy baseline**

```bash
git add desktop/src/app/features/resources desktop/src/tests/resourceActionPolicy.test.ts
git commit -m "docs-plan: define LiteasyClaw resource classes and action policies"
```

### Task 2: Add a file-backed local library runtime seam

**Files:**
- Create: `desktop/src/app/features/library/localLibrary.types.ts`
- Create: `desktop/src/app/features/library/localLibraryClient.ts`
- Create: `desktop/src/tests/localLibraryClient.test.ts`
- Create: `desktop/src-tauri/src/local_library.rs`
- Modify: `desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Write the failing local-library client test**

```ts
import { createLocalLibraryClient } from "../app/features/library/localLibraryClient";

test("normalizes a local library snapshot returned from the runtime seam", async () => {
  const client = createLocalLibraryClient(async () => ({
    entries: [
      {
        id: "paper-1",
        path: "/tmp/LiteasyLibrary/papers/attention-is-all-you-need.pdf",
        title: "Attention Is All You Need",
      },
    ],
    rootPath: "/tmp/LiteasyLibrary",
  }));

  const snapshot = await client();

  expect(snapshot.rootPath).toBe("/tmp/LiteasyLibrary");
  expect(snapshot.entries[0].title).toBe("Attention Is All You Need");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && npm test -- src/tests/localLibraryClient.test.ts`
Expected: FAIL because the local-library client files do not exist.

- [ ] **Step 3: Add the minimal client and Tauri command seam**

```ts
// desktop/src/app/features/library/localLibrary.types.ts
export type LocalLibraryEntry = {
  id: string;
  path: string;
  title: string;
};

export type LocalLibrarySnapshot = {
  entries: LocalLibraryEntry[];
  rootPath: string;
};
```

```ts
// desktop/src/app/features/library/localLibraryClient.ts
import { invoke } from "@tauri-apps/api/core";
import type { LocalLibrarySnapshot } from "./localLibrary.types";

type Loader = () => Promise<LocalLibrarySnapshot>;

export function createLocalLibraryClient(loader?: Loader) {
  return async function loadLocalLibrary(): Promise<LocalLibrarySnapshot> {
    const snapshot = loader
      ? await loader()
      : await invoke<LocalLibrarySnapshot>("load_local_library_snapshot");

    return {
      entries: snapshot.entries.map((entry) => ({
        id: entry.id,
        path: entry.path,
        title: entry.title,
      })),
      rootPath: snapshot.rootPath,
    };
  };
}
```

```rust
// desktop/src-tauri/src/local_library.rs
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct LocalLibraryEntry {
    pub id: String,
    pub path: String,
    pub title: String,
}

#[derive(Serialize)]
pub struct LocalLibrarySnapshot {
    pub entries: Vec<LocalLibraryEntry>,
    pub root_path: String,
}

#[tauri::command]
pub fn load_local_library_snapshot() -> Result<LocalLibrarySnapshot, String> {
    let home = std::env::var("HOME").map_err(|error| error.to_string())?;
    let root = PathBuf::from(home).join("LiteasyLibrary");
    fs::create_dir_all(root.join("papers")).map_err(|error| error.to_string())?;

    Ok(LocalLibrarySnapshot {
        entries: vec![],
        root_path: root.display().to_string(),
    })
}
```

```rust
// desktop/src-tauri/src/main.rs
mod import;
mod local_library;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            import::mock_import,
            local_library::load_local_library_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running LiteasyClaw desktop");
}
```

- [ ] **Step 4: Run the focused tests to verify green**

Run: `cd desktop && npm test -- src/tests/localLibraryClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the local-library seam**

```bash
git add desktop/src/app/features/library/localLibrary.types.ts desktop/src/app/features/library/localLibraryClient.ts desktop/src/tests/localLibraryClient.test.ts desktop/src-tauri/src/local_library.rs desktop/src-tauri/src/main.rs
git commit -m "docs-plan: add LiteasyClaw local library runtime seam"
```

### Task 3: Load the workspace from the local library root

**Files:**
- Create: `desktop/src/app/features/library/useLocalLibrary.ts`
- Modify: `desktop/src/app/features/workspace/workspace.types.ts`
- Modify: `desktop/src/app/features/workspace/workspace.store.ts`
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Test: `desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Write the failing AppShell bootstrap test**

```ts
test("loads the LiteasyClaw local library root on startup", async () => {
  render(<AppShell />);

  expect(await screen.findByText(/当前工作区：.*LiteasyLibrary/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && npm test -- src/tests/AppShell.test.tsx -t "loads the LiteasyClaw local library root on startup"`
Expected: FAIL because startup still uses static starter workspace data only.

- [ ] **Step 3: Add a local-library hook and workspace source metadata**

```ts
// desktop/src/app/features/library/useLocalLibrary.ts
import { useEffect, useState } from "react";
import { createLocalLibraryClient } from "./localLibraryClient";
import type { LocalLibrarySnapshot } from "./localLibrary.types";

export function useLocalLibrary() {
  const [snapshot, setSnapshot] = useState<LocalLibrarySnapshot | null>(null);

  useEffect(() => {
    const load = async () => {
      const client = createLocalLibraryClient();
      setSnapshot(await client());
    };

    void load();
  }, []);

  return snapshot;
}
```

```ts
// desktop/src/app/features/workspace/workspace.types.ts
export type WorkspaceSourceType = "local_library" | "organization_shared";
```

Update the workspace state shape to include:

```ts
workspaceSource: {
  rootPath: string;
  type: WorkspaceSourceType;
}
```

In `AppShell.tsx`, load the snapshot and replace the startup label with the returned local-library root path.

- [ ] **Step 4: Run the focused AppShell test to verify green**

Run: `cd desktop && npm test -- src/tests/AppShell.test.tsx -t "loads the LiteasyClaw local library root on startup"`
Expected: PASS

- [ ] **Step 5: Commit the file-backed workspace bootstrap**

```bash
git add desktop/src/app/features/library/useLocalLibrary.ts desktop/src/app/features/workspace/workspace.types.ts desktop/src/app/features/workspace/workspace.store.ts desktop/src/app/layout/AppShell.tsx desktop/src/tests/AppShell.test.tsx
git commit -m "docs-plan: bootstrap workspace from LiteasyClaw local library root"
```

### Task 4: Surface the local library root in the left pane

**Files:**
- Modify: `desktop/src/app/features/library/LibraryPane.tsx`
- Modify: `desktop/src/app/features/library/library.css`
- Test: `desktop/src/tests/LeftPane.test.tsx`

- [ ] **Step 1: Write the failing library-pane test**

```ts
test("shows the local library root and refresh affordance", () => {
  render(
    <LibraryPane
      canReturnToLocalWorkspace={false}
      collectionItems={[]}
      importJobs={{}}
      onAddExternalPaper={() => {}}
      onClearRecommendations={() => {}}
      onCollectRecommendation={() => {}}
      onImportSelectedSet={() => {}}
      onReturnToLocalWorkspace={() => {}}
      onToggleLock={() => {}}
      onToggleSelection={() => {}}
      papers={[]}
      recommendationItems={[]}
      recommendationMessage="ok"
      recommendationPending={false}
      recommendationStatus="idle"
      selectedPaperIds={[]}
      selectionLocked={false}
      workspaceLabel="/home/test/LiteasyLibrary"
    />
  );

  expect(screen.getByText("工作区母目录：/home/test/LiteasyLibrary")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "刷新本地文献库" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && npm test -- src/tests/LeftPane.test.tsx -t "shows the local library root and refresh affordance"`
Expected: FAIL because the refresh affordance does not exist yet.

- [ ] **Step 3: Add the refresh affordance and root-path copy**

In `LibraryPane.tsx`, add:

```tsx
<button className="library-button ghost" type="button">
  刷新本地文献库
</button>
```

Keep `工作区母目录：{workspaceLabel}` visible as the canonical local root label.

- [ ] **Step 4: Run the focused left-pane test**

Run: `cd desktop && npm test -- src/tests/LeftPane.test.tsx -t "shows the local library root and refresh affordance"`
Expected: PASS

- [ ] **Step 5: Commit the UI clarification**

```bash
git add desktop/src/app/features/library/LibraryPane.tsx desktop/src/app/features/library/library.css desktop/src/tests/LeftPane.test.tsx
git commit -m "docs-plan: surface local library root in library pane"
```

### Task 5: Update tester-facing documentation

**Files:**
- Modify: `docs/qa/environment-startup-guide.md`

- [ ] **Step 1: Add the local-library verification section**

Add a section stating that after startup the tester should verify:

- a `LiteasyLibrary` folder exists under the user's home directory
- the left pane shows that root path
- the desktop workspace now reflects file-backed local-library semantics rather than only starter fixture semantics

- [ ] **Step 2: Verify the guide mentions the local-library root**

Run: `rg -n "LiteasyLibrary|本地文献库" docs/qa/environment-startup-guide.md`
Expected: at least one match for the new local-library instructions

- [ ] **Step 3: Commit the guide update**

```bash
git add docs/qa/environment-startup-guide.md
git commit -m "docs-plan: document LiteasyClaw local library root verification"
```

## M1 Verification Checklist

Before declaring M1 complete, run all of these:

```bash
cd desktop && npm test -- src/tests/resourceActionPolicy.test.ts
cd desktop && npm test -- src/tests/localLibraryClient.test.ts
cd desktop && npm test -- src/tests/AppShell.test.tsx -t "loads the LiteasyClaw local library root on startup"
cd desktop && npm test -- src/tests/LeftPane.test.tsx -t "shows the local library root and refresh affordance"
cd desktop && npm run build
```

Expected:

- all focused tests pass
- desktop build passes
- the app can show a file-backed local library root on startup

## Follow-On Dependency

Do not start cloud favorites or cloud cache formalization until M1 is complete. M2 depends on:

- the five resource classes being present in code
- a file-backed local library root being available
- workspace source metadata distinguishing local vs organization resources
