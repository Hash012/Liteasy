# LiteasyClaw Modular Foundation Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first modular foundation layer by extracting selection snapshots, adding agent-runtime and actions contracts, and moving the first workspace/selection wiring out of `AppShell`.

**Architecture:** This phase is intentionally narrow. It creates stable contracts around selected document sets, runtime context, runtime events, and action policy without changing visible product behavior. It then introduces one controller seam so future modules can move out of `AppShell` incrementally.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing LiteasyClaw desktop feature modules.

---

## File Responsibilities

- `docs/engineering/module-boundaries.md`: documents module ownership, dependency rules, and test placement rules.
- `products/liteasy/apps/desktop/src/app/features/selection/selection.types.ts`: defines selected-document-set snapshot types and validation result types.
- `products/liteasy/apps/desktop/src/app/features/selection/selectionSnapshot.ts`: builds a selected-document-set snapshot from workspace state.
- `products/liteasy/apps/desktop/src/app/features/selection/selectionValidation.ts`: validates selected-document-set readiness for agent and artifact flows.
- `products/liteasy/apps/desktop/src/tests/selectionSnapshot.test.ts`: verifies selection snapshot construction.
- `products/liteasy/apps/desktop/src/tests/selectionValidation.test.ts`: verifies missing, unlocked, and ready selection states.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`: defines runtime context, input, event, action request, task request, and artifact request contracts.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/contextValidation.ts`: validates runtime context before command execution.
- `products/liteasy/apps/desktop/src/tests/agentRuntimeContext.test.ts`: verifies context validation behavior.
- `products/liteasy/apps/desktop/src/app/features/actions/action.types.ts`: defines action request/result contracts.
- `products/liteasy/apps/desktop/src/app/features/actions/actionPolicy.ts`: adapts current resource action policy into the new action module.
- `products/liteasy/apps/desktop/src/tests/actionPolicyAdapter.test.ts`: verifies action policy mapping.
- `products/liteasy/apps/desktop/src/app/controllers/useWorkspaceSelectionController.ts`: wraps workspace and selection state for shell composition.
- `products/liteasy/apps/desktop/src/tests/useWorkspaceSelectionController.test.ts`: verifies controller model construction.
- `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx`: consumes the new controller without changing visible behavior.

## Task 1: Add Module Boundary Documentation

**Files:**
- Create: `docs/engineering/module-boundaries.md`

- [ ] **Step 1: Create the engineering docs directory if needed**

Run:

```bash
mkdir -p docs/engineering
```

Expected: command exits 0.

- [ ] **Step 2: Write the module boundary document**

Create `docs/engineering/module-boundaries.md` with this content:

```markdown
# LiteasyClaw Module Boundaries

## Purpose

This document defines where new work belongs so LiteasyClaw can evolve without turning `AppShell`, broad pane props, or monolithic tests into shared bottlenecks.

## Dependency Direction

Allowed direction:

```text
shell -> controllers -> feature modules -> shared types / clients
```

Feature modules must not import `AppShell` or shell components.

## Module Rules

- `shell` owns layout, pane sizing, top bar, activity rail, and global dialog hosting.
- `controllers` adapt feature modules into shell-ready models and actions.
- `workspace` owns workspace source, papers, revision, and folder-tree normalization.
- `selection` owns selected-document-set snapshots and readiness validation.
- `ingestion` owns parse/chunk/index lifecycle and import job state.
- `retrieval` owns chunks, citations, and source-grounded lookup.
- `agent-runtime` owns context snapshots, intent routing, runtime events, skill execution contracts, and confirmation requests.
- `actions` owns state-changing action contracts, policies, risk levels, and confirmation rules.
- `assistant` owns the right-pane interaction surface and renders runtime events.
- `artifacts` owns artifact tasks, tabs, previews, and renderer lifecycle.
- `cloud` owns account, model, collection, recommendation, cache, and metadata-sync clients/controllers.
- `organization` owns organization membership, summary, notifications, shared-library manifests, and governance summaries.

## Mutation Rule

Any behavior that changes application state should be expressible as a registered action. Buttons, AI commands, and future keyboard shortcuts should converge on the same action contract.

## Selection Rule

Any feature that analyzes documents should depend on a `SelectedDocumentSetSnapshot`, not directly on checkbox UI state.

## Runtime Rule

AI-native interaction starts in `agent-runtime`. Assistant UI renders runtime events and should not infer hidden state-changing behavior from free-form text.

## Test Placement

- New pure module behavior: create focused tests in `products/liteasy/apps/desktop/src/tests/<module-name>*.test.ts`.
- New component behavior: create focused component tests in `products/liteasy/apps/desktop/src/tests/<ComponentName>.test.tsx`.
- `AppShell.test.tsx` is reserved for smoke tests and high-value integration paths only.
- Service route behavior should live in domain route tests once routes are split.

## AppShell Rule

`AppShell` should compose controllers and panes. It should not keep accumulating domain-specific orchestration logic.
```

- [ ] **Step 3: Verify the document exists**

Run:

```bash
test -f docs/engineering/module-boundaries.md && rg -n "Selection Rule|Runtime Rule|AppShell Rule" docs/engineering/module-boundaries.md
```

Expected: three matching lines.

- [ ] **Step 4: Commit**

```bash
git add docs/engineering/module-boundaries.md
git commit -m "docs: define LiteasyClaw module boundaries"
```

## Task 2: Create Selection Snapshot Types

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/selection/selection.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/selection/selectionSnapshot.ts`
- Test: `products/liteasy/apps/desktop/src/tests/selectionSnapshot.test.ts`

- [ ] **Step 1: Write the failing snapshot test**

Create `products/liteasy/apps/desktop/src/tests/selectionSnapshot.test.ts`:

```ts
import { buildSelectedDocumentSetSnapshot } from "../app/features/selection/selectionSnapshot";
import type { WorkspaceState } from "../app/features/workspace/workspace.types";

function createWorkspaceState(): WorkspaceState {
  return {
    papers: [
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/papers/attention.pdf",
        title: "Attention Is All You Need"
      },
      {
        id: "paper-2",
        sourcePath: "/tmp/LiteasyLibrary/papers/bert.pdf",
        title: "BERT"
      }
    ],
    selectedPaperIds: ["paper-2", "paper-1"],
    selectionLocked: true,
    workspaceRevision: 7,
    workspaceSource: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  };
}

test("builds a selected document set snapshot from workspace state", () => {
  const snapshot = buildSelectedDocumentSetSnapshot(createWorkspaceState());

  expect(snapshot).toEqual({
    documentIds: ["paper-2", "paper-1"],
    documents: [
      {
        id: "paper-2",
        sourcePath: "/tmp/LiteasyLibrary/papers/bert.pdf",
        title: "BERT"
      },
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/papers/attention.pdf",
        title: "Attention Is All You Need"
      }
    ],
    locked: true,
    workspaceRevision: 7,
    workspaceSource: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/selectionSnapshot.test.ts
```

Expected: FAIL because `selectionSnapshot` does not exist.

- [ ] **Step 3: Add selection types**

Create `products/liteasy/apps/desktop/src/app/features/selection/selection.types.ts`:

```ts
import type { WorkspaceSource } from "../workspace/workspace.types";

export type SelectedDocumentSummary = {
  id: string;
  sourcePath: string;
  title: string;
};

export type SelectedDocumentSetSnapshot = {
  documentIds: string[];
  documents: SelectedDocumentSummary[];
  locked: boolean;
  workspaceRevision: number;
  workspaceSource: WorkspaceSource;
};

export type SelectionReadinessIssue =
  | "selection_empty"
  | "selection_unlocked"
  | "documents_missing";

export type SelectionReadiness =
  | { ok: true }
  | {
      issues: SelectionReadinessIssue[];
      ok: false;
    };
```

- [ ] **Step 4: Add snapshot builder**

Create `products/liteasy/apps/desktop/src/app/features/selection/selectionSnapshot.ts`:

```ts
import type { WorkspaceState } from "../workspace/workspace.types";
import type { SelectedDocumentSetSnapshot } from "./selection.types";

export function buildSelectedDocumentSetSnapshot(
  workspaceState: WorkspaceState
): SelectedDocumentSetSnapshot {
  const documents = workspaceState.selectedPaperIds
    .map((paperId) => workspaceState.papers.find((paper) => paper.id === paperId))
    .filter((paper): paper is NonNullable<typeof paper> => paper !== undefined)
    .map((paper) => ({
      id: paper.id,
      sourcePath: paper.sourcePath,
      title: paper.title
    }));

  return {
    documentIds: [...workspaceState.selectedPaperIds],
    documents,
    locked: workspaceState.selectionLocked,
    workspaceRevision: workspaceState.workspaceRevision,
    workspaceSource: workspaceState.workspaceSource
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/selectionSnapshot.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/selection products/liteasy/apps/desktop/src/tests/selectionSnapshot.test.ts
git commit -m "feat: add selected document set snapshots"
```

## Task 3: Add Selection Readiness Validation

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/selection/selectionValidation.ts`
- Test: `products/liteasy/apps/desktop/src/tests/selectionValidation.test.ts`

- [ ] **Step 1: Write the failing validation test**

Create `products/liteasy/apps/desktop/src/tests/selectionValidation.test.ts`:

```ts
import { validateSelectedDocumentSet } from "../app/features/selection/selectionValidation";
import type { SelectedDocumentSetSnapshot } from "../app/features/selection/selection.types";

function createSnapshot(
  overrides: Partial<SelectedDocumentSetSnapshot> = {}
): SelectedDocumentSetSnapshot {
  return {
    documentIds: ["paper-1"],
    documents: [
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
        title: "Paper 1"
      }
    ],
    locked: true,
    workspaceRevision: 1,
    workspaceSource: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    },
    ...overrides
  };
}

test("requires at least one selected document", () => {
  expect(
    validateSelectedDocumentSet(
      createSnapshot({
        documentIds: [],
        documents: []
      })
    )
  ).toEqual({
    issues: ["selection_empty"],
    ok: false
  });
});

test("requires the selected document set to be locked", () => {
  expect(validateSelectedDocumentSet(createSnapshot({ locked: false }))).toEqual({
    issues: ["selection_unlocked"],
    ok: false
  });
});

test("detects selected ids without document summaries", () => {
  expect(
    validateSelectedDocumentSet(
      createSnapshot({
        documentIds: ["paper-1", "paper-2"],
        documents: [
          {
            id: "paper-1",
            sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
            title: "Paper 1"
          }
        ]
      })
    )
  ).toEqual({
    issues: ["documents_missing"],
    ok: false
  });
});

test("accepts a locked selected document set with document summaries", () => {
  expect(validateSelectedDocumentSet(createSnapshot())).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/selectionValidation.test.ts
```

Expected: FAIL because `selectionValidation` does not exist.

- [ ] **Step 3: Add selection validation**

Create `products/liteasy/apps/desktop/src/app/features/selection/selectionValidation.ts`:

```ts
import type {
  SelectedDocumentSetSnapshot,
  SelectionReadiness,
  SelectionReadinessIssue
} from "./selection.types";

export function validateSelectedDocumentSet(
  snapshot: SelectedDocumentSetSnapshot
): SelectionReadiness {
  const issues: SelectionReadinessIssue[] = [];

  if (snapshot.documentIds.length === 0) {
    issues.push("selection_empty");
  }

  if (!snapshot.locked) {
    issues.push("selection_unlocked");
  }

  if (snapshot.documentIds.length !== snapshot.documents.length) {
    issues.push("documents_missing");
  }

  if (issues.length > 0) {
    return {
      issues,
      ok: false
    };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/selectionValidation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/selection/selectionValidation.ts products/liteasy/apps/desktop/src/tests/selectionValidation.test.ts
git commit -m "feat: validate selected document set readiness"
```

## Task 4: Add Agent Runtime Contracts And Context Validation

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/agent-runtime/contextValidation.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentRuntimeContext.test.ts`

- [ ] **Step 1: Write the failing runtime context test**

Create `products/liteasy/apps/desktop/src/tests/agentRuntimeContext.test.ts`:

```ts
import { validateAgentContextForDocumentWork } from "../app/features/agent-runtime/contextValidation";
import type { AgentContextSnapshot } from "../app/features/agent-runtime/agentRuntime.types";

function createContext(overrides: Partial<AgentContextSnapshot> = {}): AgentContextSnapshot {
  return {
    account: null,
    ingestion: {
      byDocumentId: {
        "paper-1": "ready"
      }
    },
    organization: null,
    selection: {
      documentIds: ["paper-1"],
      documents: [
        {
          id: "paper-1",
          sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
          title: "Paper 1"
        }
      ],
      locked: true,
      workspaceRevision: 1,
      workspaceSource: {
        rootPath: "/tmp/LiteasyLibrary",
        type: "local_library"
      }
    },
    settings: {
      "models.control_plane_endpoint": "http://127.0.0.1:8787",
      "models.default_provider": "openai",
      "models.local_direct_enabled": false,
      "models.local_direct_endpoint": "mock://local",
      "models.model_access_mode": "cloud_proxy",
      "models.policy_version": "test",
      "models.synced_at": "2026-07-01T00:00:00.000Z",
      "network.recommendation.enabled": true,
      "network.recommendation.sort_mode": "relevance",
      "profile.enabled": false
    },
    workspace: {
      papers: [
        {
          id: "paper-1",
          sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
          title: "Paper 1"
        }
      ],
      revision: 1,
      source: {
        rootPath: "/tmp/LiteasyLibrary",
        type: "local_library"
      }
    },
    ...overrides
  };
}

test("accepts document work when selection is locked and ingested", () => {
  expect(validateAgentContextForDocumentWork(createContext())).toEqual({ ok: true });
});

test("asks for selection when selected document set is empty", () => {
  expect(
    validateAgentContextForDocumentWork(
      createContext({
        selection: {
          documentIds: [],
          documents: [],
          locked: false,
          workspaceRevision: 1,
          workspaceSource: {
            rootPath: "/tmp/LiteasyLibrary",
            type: "local_library"
          }
        }
      })
    )
  ).toEqual({
    missing: ["selected_document_set"],
    ok: false
  });
});

test("asks for ingestion when selected documents are not ready", () => {
  expect(
    validateAgentContextForDocumentWork(
      createContext({
        ingestion: {
          byDocumentId: {
            "paper-1": "running"
          }
        }
      })
    )
  ).toEqual({
    missing: ["ingested_documents"],
    ok: false
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeContext.test.ts
```

Expected: FAIL because `agent-runtime` files do not exist.

- [ ] **Step 3: Add runtime types**

Create `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`:

```ts
import type { AccountSession } from "../account/account.types";
import type { OrganizationSummary } from "../organization/organization.types";
import type { SelectedDocumentSetSnapshot } from "../selection/selection.types";
import type { SettingsState } from "../settings/settings.types";
import type { Paper, WorkspaceSource } from "../workspace/workspace.types";

export type IngestionStatus = "not_started" | "queued" | "running" | "failed" | "ready";

export type IngestionSnapshot = {
  byDocumentId: Record<string, IngestionStatus>;
};

export type WorkspaceSnapshot = {
  papers: Paper[];
  revision: number;
  source: WorkspaceSource;
};

export type AgentContextSnapshot = {
  account: AccountSession | null;
  ingestion: IngestionSnapshot;
  organization: OrganizationSummary | null;
  selection: SelectedDocumentSetSnapshot;
  settings: SettingsState;
  workspace: WorkspaceSnapshot;
};

export type ActionRequest = {
  actionId: string;
  payload: Record<string, unknown>;
};

export type TaskRequest = {
  payload: Record<string, unknown>;
  taskType: string;
};

export type ArtifactRequest = {
  artifactType: string;
  payload: Record<string, unknown>;
};

export type AgentRuntimeEvent =
  | { message: string; type: "assistant_reply" }
  | { missing: string[]; question: string; type: "clarification_request" }
  | { action: ActionRequest; summary: string; type: "confirmation_request" }
  | { action: ActionRequest; type: "action_request" }
  | { task: TaskRequest; type: "task_request" }
  | { artifact: ArtifactRequest; type: "artifact_request" }
  | { message: string; recovery?: string; type: "runtime_error" };

export type AgentContextValidation =
  | { ok: true }
  | {
      missing: string[];
      ok: false;
    };
```

- [ ] **Step 4: Add context validation**

Create `products/liteasy/apps/desktop/src/app/features/agent-runtime/contextValidation.ts`:

```ts
import { validateSelectedDocumentSet } from "../selection/selectionValidation";
import type { AgentContextSnapshot, AgentContextValidation } from "./agentRuntime.types";

export function validateAgentContextForDocumentWork(
  context: AgentContextSnapshot
): AgentContextValidation {
  const missing: string[] = [];
  const selectionReadiness = validateSelectedDocumentSet(context.selection);

  if (!selectionReadiness.ok) {
    missing.push("selected_document_set");
  }

  const allSelectedDocumentsReady = context.selection.documentIds.every(
    (documentId) => context.ingestion.byDocumentId[documentId] === "ready"
  );

  if (context.selection.documentIds.length > 0 && !allSelectedDocumentsReady) {
    missing.push("ingested_documents");
  }

  if (missing.length > 0) {
    return {
      missing,
      ok: false
    };
  }

  return { ok: true };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeContext.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-runtime products/liteasy/apps/desktop/src/tests/agentRuntimeContext.test.ts
git commit -m "feat: add agent runtime context contracts"
```

## Task 5: Add Actions Module Policy Adapter

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/actions/action.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/actions/actionPolicy.ts`
- Test: `products/liteasy/apps/desktop/src/tests/actionPolicyAdapter.test.ts`

- [ ] **Step 1: Write the failing action policy adapter test**

Create `products/liteasy/apps/desktop/src/tests/actionPolicyAdapter.test.ts`:

```ts
import { getRegisteredActionPolicy } from "../app/features/actions/actionPolicy";

test("adapts local library delete policy into the actions module", () => {
  expect(getRegisteredActionPolicy("local_library.delete_file")).toEqual({
    actionId: "local_library.delete_file",
    requiresConfirmation: true,
    resourceClass: "local_private",
    riskLevel: "high"
  });
});

test("adapts cloud cache invalidation policy into the actions module", () => {
  expect(getRegisteredActionPolicy("cloud_cache.invalidate_workspace_results")).toEqual({
    actionId: "cloud_cache.invalidate_workspace_results",
    requiresConfirmation: false,
    resourceClass: "cloud_cache",
    riskLevel: "medium"
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/actionPolicyAdapter.test.ts
```

Expected: FAIL because `features/actions` does not exist.

- [ ] **Step 3: Add action types**

Create `products/liteasy/apps/desktop/src/app/features/actions/action.types.ts`:

```ts
import type { ActionRiskLevel } from "../resources/resourceActionPolicy";
import type { ResourceClass } from "../resources/resourceScope.types";

export type RegisteredActionPolicy = {
  actionId: string;
  requiresConfirmation: boolean;
  resourceClass: ResourceClass;
  riskLevel: ActionRiskLevel;
};

export type RegisteredActionRequest = {
  actionId: string;
  payload: Record<string, unknown>;
};

export type RegisteredActionResult =
  | {
      message: string;
      ok: true;
    }
  | {
      message: string;
      ok: false;
      recovery?: string;
    };
```

- [ ] **Step 4: Add action policy adapter**

Create `products/liteasy/apps/desktop/src/app/features/actions/actionPolicy.ts`:

```ts
import { getActionPolicy } from "../resources/resourceActionPolicy";
import type { RegisteredActionPolicy } from "./action.types";

export function getRegisteredActionPolicy(actionId: string): RegisteredActionPolicy {
  const policy = getActionPolicy(actionId);

  return {
    actionId: policy.actionId,
    requiresConfirmation: policy.requiresConfirmation,
    resourceClass: policy.resourceClass,
    riskLevel: policy.riskLevel
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/actionPolicyAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/actions products/liteasy/apps/desktop/src/tests/actionPolicyAdapter.test.ts
git commit -m "feat: add actions policy adapter"
```

## Task 6: Add Workspace Selection Controller

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/controllers/useWorkspaceSelectionController.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useWorkspaceSelectionController.test.ts`

- [ ] **Step 1: Write the failing controller test**

Create `products/liteasy/apps/desktop/src/tests/useWorkspaceSelectionController.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";
import { useWorkspaceSelectionController } from "../app/controllers/useWorkspaceSelectionController";

test("exposes workspace state and selected document set snapshot", () => {
  const workspaceStore = createWorkspaceStore();
  workspaceStore.openWorkspace(
    [
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
        title: "Paper 1"
      }
    ],
    {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  );
  workspaceStore.toggleSelection("paper-1");
  workspaceStore.lockSelection();

  const { result } = renderHook(() =>
    useWorkspaceSelectionController({
      workspaceStore
    })
  );

  expect(result.current.model.selectedDocumentSet).toEqual({
    documentIds: ["paper-1"],
    documents: [
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
        title: "Paper 1"
      }
    ],
    locked: true,
    workspaceRevision: 1,
    workspaceSource: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/useWorkspaceSelectionController.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Add the controller**

Create `products/liteasy/apps/desktop/src/app/controllers/useWorkspaceSelectionController.ts`:

```ts
import { useMemo, useState } from "react";
import { buildSelectedDocumentSetSnapshot } from "../features/selection/selectionSnapshot";
import type { SelectedDocumentSetSnapshot } from "../features/selection/selection.types";
import type { WorkspaceState } from "../features/workspace/workspace.types";
import type { createWorkspaceStore } from "../features/workspace/workspace.store";
import { cloneWorkspaceState } from "../features/workspace/workspaceStateHelpers";

export type WorkspaceSelectionModel = {
  selectedDocumentSet: SelectedDocumentSetSnapshot;
  workspaceState: WorkspaceState;
};

export type WorkspaceSelectionActions = {
  setWorkspaceState: (workspaceState: WorkspaceState) => void;
};

type UseWorkspaceSelectionControllerInput = {
  workspaceStore: ReturnType<typeof createWorkspaceStore>;
};

export function useWorkspaceSelectionController({
  workspaceStore
}: UseWorkspaceSelectionControllerInput): {
  actions: WorkspaceSelectionActions;
  model: WorkspaceSelectionModel;
} {
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() =>
    cloneWorkspaceState(workspaceStore.getState())
  );
  const selectedDocumentSet = useMemo(
    () => buildSelectedDocumentSetSnapshot(workspaceState),
    [workspaceState]
  );

  return {
    actions: {
      setWorkspaceState
    },
    model: {
      selectedDocumentSet,
      workspaceState
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/useWorkspaceSelectionController.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/controllers/useWorkspaceSelectionController.ts products/liteasy/apps/desktop/src/tests/useWorkspaceSelectionController.test.ts
git commit -m "feat: add workspace selection controller"
```

## Task 7: Wire Workspace Selection Controller Into AppShell

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/AppShell.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/useWorkspaceSelectionController.test.ts`

- [ ] **Step 1: Run current shell tests before wiring**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/useWorkspaceSelectionController.test.ts src/tests/AppShell.test.tsx
```

Expected: PASS before refactor.

- [ ] **Step 2: Import the controller in AppShell**

Modify `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx` imports by adding:

```ts
import { useWorkspaceSelectionController } from "../controllers/useWorkspaceSelectionController";
```

- [ ] **Step 3: Replace local workspace state initialization with controller**

In `AppShell`, replace:

```ts
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() =>
    cloneWorkspaceState(workspaceStoreRef.current.getState())
  );
```

with:

```ts
  const workspaceSelection = useWorkspaceSelectionController({
    workspaceStore: workspaceStoreRef.current
  });
  const workspaceState = workspaceSelection.model.workspaceState;
  const setWorkspaceState = workspaceSelection.actions.setWorkspaceState;
```

- [ ] **Step 4: Remove unused imports if TypeScript reports them**

If `WorkspaceState` or `cloneWorkspaceState` becomes unused in `AppShell.tsx`, remove those imports.

The imports should no longer include:

```ts
import type { WorkspaceState } from "../features/workspace/workspace.types";
import { cloneWorkspaceState } from "../features/workspace/workspaceStateHelpers";
```

if TypeScript reports them as unused.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/useWorkspaceSelectionController.test.ts src/tests/AppShell.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run build**

Run:

```bash
cd products/liteasy/apps/desktop && npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/layout/AppShell.tsx products/liteasy/apps/desktop/src/app/controllers/useWorkspaceSelectionController.ts products/liteasy/apps/desktop/src/tests/useWorkspaceSelectionController.test.ts
git commit -m "refactor: route workspace selection through controller"
```

## Task 8: Add No-New-AppShell-Test Rule To README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the development rule**

In `README.md`, under `## 7. 当前协作建议`, add this bullet:

```markdown
- 新功能优先写模块级测试，不要继续把普通场景塞进 `products/liteasy/apps/desktop/src/tests/AppShell.test.tsx`；该文件只保留 smoke 和关键集成路径。
```

- [ ] **Step 2: Verify the rule is present**

Run:

```bash
rg -n "AppShell.test.tsx|模块级测试" README.md docs/engineering/module-boundaries.md
```

Expected: matches in both files.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document module-level test rule"
```

## Task 9: Run Phase 1 Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run focused new tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/selectionSnapshot.test.ts src/tests/selectionValidation.test.ts src/tests/agentRuntimeContext.test.ts src/tests/actionPolicyAdapter.test.ts src/tests/useWorkspaceSelectionController.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full desktop tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test
```

Expected: PASS.

- [ ] **Step 3: Run desktop build**

Run:

```bash
cd products/liteasy/apps/desktop && npm run build
```

Expected: PASS.

- [ ] **Step 4: Run dev-cloud tests to catch unrelated shared regressions**

Run:

```bash
node --test development/dev-cloud/server.test.mjs development/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: PASS.

## Phase 1 Completion Criteria

Phase 1 is complete when:

- module boundary documentation exists
- selected document set snapshots are first-class
- selection readiness validation exists
- agent runtime context contracts exist
- actions module policy adapter exists
- `AppShell` uses the first controller seam
- README tells contributors not to add ordinary feature tests to `AppShell.test.tsx`
- all focused tests, full desktop tests, desktop build, and dev-cloud tests pass

## Follow-Up Plan

After this phase, create a Phase 2 plan for:

- extracting `LibraryPane` into `WorkspaceTreePanel`, `SelectedSetPanel`, `CollectionPanel`, and `RecommendationPanel`
- adding the first executable `agent-runtime` intent route
- turning one current assistant command into runtime events plus a registered action
- splitting the first dev-cloud route group and route test
