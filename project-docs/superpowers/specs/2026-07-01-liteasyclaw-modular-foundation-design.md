# LiteasyClaw Modular Foundation Design

## 1. Goal

LiteasyClaw needs a modular foundation before the next wave of feature work.

The immediate objective is not to add more screens. The objective is to make the codebase support fast parallel development without letting core product concepts keep leaking through `AppShell`, broad pane props, and monolithic integration tests.

The target architecture is:

> Product-domain modules expose stable contracts. The shell composes them. Agent/runtime flows mutate state only through registered actions. Tests live close to the module they verify.

## 2. Current Problems To Fix

### 2.1 Overloaded Composition Root

`LiteasyClaw/desktop/src/app/layout/AppShell.tsx` currently composes most feature hooks directly. It is the natural place for every new feature to be wired, which makes it a merge-conflict hotspot.

Target:

- `AppShell` becomes a thin composition root.
- Feature orchestration moves into controller hooks.
- Cross-module communication happens through explicit contracts.

### 2.2 Wide Pane Props

`LeftPane.tsx` accepts many unrelated props for library, organization, profile, settings, metadata, recommendation, collection, and workspace behavior.

Target:

- pane components receive view models and action groups, not raw cross-product state.
- each left-rail view owns its own panel model.

### 2.3 Mixed Library Responsibilities

`LibraryPane.tsx` currently combines workspace tree, selected document set, import action, collection, recommendation, drag/drop, and local workspace return behavior.

Target:

- split by product responsibility:
  - workspace tree
  - selected set
  - cloud collection
  - recommendation cache
  - library drop behavior

### 2.4 Selection Is Not A First-Class Module

The selected document set is the main input to ingestion, QA, artifact generation, recommendations, and agent runtime. It should not remain just a workspace/library detail.

Target:

- create a first-class `selection` module.
- expose `SelectedDocumentSetSnapshot`.
- all analysis flows depend on selection snapshots, not UI state.

### 2.5 Agent Runtime Has No Stable Boundary Yet

The product goal is AI-native interaction. That requires a runtime boundary for intent, context, skills, actions, tasks, and confirmations.

Target:

- create `agent-runtime` as a formal module.
- assistant UI calls runtime and renders runtime events.
- runtime reads snapshots, not React component internals.

### 2.6 Tests Are Too Centralized

`AppShell.test.tsx` is too large and will keep absorbing unrelated scenarios unless new module test locations are enforced.

Target:

- `AppShell.test.tsx` keeps only smoke and a few full-path integration tests.
- new behavior gets module tests first.
- cross-module flows get narrow integration tests.

### 2.7 Dev Cloud Routing Is Still A Shared Hotspot

`LiteasyClaw/services/dev-cloud/requestHandler.mjs` is already better than the original server, but it still owns all route dispatch. `server.test.mjs` is also a shared hotspot.

Target:

- split route groups by domain.
- split tests by domain.
- keep `server.mjs` and `requestHandler.mjs` as thin wiring.

## 3. Target Desktop Module Map

The frontend should converge on these modules.

### 3.1 `shell`

Owns:

- app layout
- pane layout
- activity rail
- top bar
- global dialog host
- composition root

Does not own:

- workspace rules
- agent decisions
- import rules
- organization rules
- recommendation behavior

Target directory:

```text
LiteasyClaw/desktop/src/app/shell/
```

Migration source:

- `LiteasyClaw/desktop/src/app/layout/*`

### 3.2 `workspace`

Owns:

- workspace source
- local / organization / future cloud workspace identity
- workspace revision
- workspace papers
- folder tree normalization

Does not own:

- selected set lock rules
- import state
- recommendation cache
- organization membership

Target public contract:

```ts
type WorkspaceSource =
  | { type: "local"; rootPath: string }
  | { type: "organization"; organizationId: string; rootPath: string }
  | { type: "user_cloud"; rootPath: string };

type WorkspaceSnapshot = {
  papers: Paper[];
  revision: number;
  source: WorkspaceSource;
};
```

### 3.3 `selection`

Owns:

- selected document ids
- lock state
- selected document set validation
- selection snapshot for agent/runtime flows

Does not own:

- document parsing
- artifact generation
- recommendation fetching

Target public contract:

```ts
type SelectedDocumentSetSnapshot = {
  documentIds: string[];
  locked: boolean;
  workspaceRevision: number;
  workspaceSource: WorkspaceSource;
};
```

This module should be introduced early because it reduces coupling across agent, ingestion, recommendation, and artifacts.

### 3.4 `library`

Owns:

- library-facing UI
- local library display
- workspace tree panel
- drag/drop into library
- local library refresh affordance

Does not own:

- selected set rules
- cloud collection persistence
- recommendation generation

Recommended split:

```text
features/library/
  LibraryPane.tsx
  WorkspaceTreePanel.tsx
  LibraryDropZone.tsx
  LocalLibraryStatus.tsx
  localLibraryClient.ts
  useLocalLibrary.ts
```

### 3.5 `ingestion`

Owns:

- import/ingestion jobs
- parse/chunk/index lifecycle
- document ingestion status
- future OCR and PDF extraction bridge

Current `import` module should be renamed conceptually to ingestion. File renaming can happen later if it is too disruptive now.

Target public contract:

```ts
type IngestionStatus = "not_started" | "queued" | "running" | "failed" | "ready";

type IngestionSnapshot = {
  byDocumentId: Record<string, IngestionStatus>;
};
```

### 3.6 `retrieval`

Owns:

- local retrieval
- source-grounded chunks
- citation/source location model
- future vector index bridge

Does not own:

- answer generation
- audit display
- artifact rendering

### 3.7 `agent-runtime`

Owns:

- context builder
- intent router
- skill executor
- runtime event types
- confirmation policy
- task request creation

Does not own:

- assistant UI
- direct store mutation
- artifact rendering

Target public contract:

```ts
type AgentContextSnapshot = {
  workspace: WorkspaceSnapshot;
  selection: SelectedDocumentSetSnapshot;
  ingestion: IngestionSnapshot;
  account: AccountSession | null;
  settings: SettingsState;
  organization?: OrganizationSummary | null;
};

type AgentRuntimeEvent =
  | { type: "assistant_reply"; message: string }
  | { type: "clarification_request"; question: string; missing: string[] }
  | { type: "confirmation_request"; summary: string; action: ActionRequest }
  | { type: "action_request"; action: ActionRequest }
  | { type: "task_request"; task: TaskRequest }
  | { type: "artifact_request"; artifact: ArtifactRequest }
  | { type: "runtime_error"; message: string; recovery?: string };
```

### 3.8 `actions`

Owns:

- action definitions
- action schemas
- resource class mapping
- risk policy
- confirmation requirements
- action execution result contract

This should absorb or wrap:

- current `features/skills/actionRegistry.ts`
- current `features/resources/resourceActionPolicy.ts`

Target rule:

> Buttons, AI commands, and future keyboard shortcuts must call the same registered actions when they mutate state.

### 3.9 `assistant`

Owns:

- right pane UI
- composer
- assistant history
- runtime event rendering
- context chips
- confirmation cards
- task status cards

Does not own:

- intent routing
- action execution
- artifact generation

### 3.10 `artifacts`

Owns:

- artifact tabs
- artifact task state
- artifact preview
- artifact open/close behavior
- future artifact renderer registry

Does not own:

- user intent
- document retrieval
- model generation

### 3.11 `cloud`

Owns cloud-facing client capability groups:

- account
- model gateway
- policy sync
- collection
- recommendation
- recommendation cache
- document metadata sync

The current separate feature directories can remain, but they should expose contracts through a cloud controller rather than being wired one by one inside `AppShell`.

### 3.12 `organization`

Owns:

- organization list
- organization summary
- organization actions
- notifications
- shared library manifest
- governance summary
- organization-side permissions

Does not directly mutate workspace. Opening a shared library must go through a registered action.

## 4. Controller Layer

Create controller hooks to keep `AppShell` thin.

Recommended controllers:

```text
LiteasyClaw/desktop/src/app/controllers/
  useWorkspaceController.ts
  useSelectionController.ts
  useIngestionController.ts
  useArtifactController.ts
  useAgentRuntimeController.ts
  useCloudController.ts
  useOrganizationController.ts
  useProfileController.ts
```

Each controller should return:

```ts
type ControllerOutput<Model, Actions> = {
  model: Model;
  actions: Actions;
};
```

The shell should compose controller outputs and pass them to panes.

## 5. Dependency Rules

### 5.1 Allowed Direction

Recommended dependency direction:

```text
shell
  -> controllers
    -> product modules
      -> shared types / clients
```

`assistant` may call `agent-runtime`.

`agent-runtime` may call `actions`, `retrieval`, and task creation contracts.

`actions` may call product module executors through injected dependencies.

`organization` may create an action request to switch workspace, but should not mutate workspace directly.

`artifacts` should accept task/artifact requests, not inspect assistant internals.

### 5.2 Disallowed Direction

Avoid:

- feature modules importing `AppShell`
- `agent-runtime` importing React components
- `assistant` directly mutating workspace, settings, organization, or artifact state
- `organization` directly writing workspace store
- UI panes directly calling dev-cloud clients when a controller exists
- new tests being added to `AppShell.test.tsx` unless they are true shell integration tests

## 6. Immediate Refactor Sequence

### Step 1: Add Module Boundary Documentation

Add a short `LiteasyClaw/desktop/src/app/README.md` or `project-docs/engineering/module-boundaries.md`.

It should state:

- module ownership
- dependency rules
- where new tests go
- when `AppShell.test.tsx` may be touched

### Step 2: Create `selection`

Extract selected document set behavior into a first-class module.

Deliverables:

- `features/selection/selection.types.ts`
- `features/selection/selectionSnapshot.ts`
- `features/selection/selectionValidation.ts`
- focused tests

### Step 3: Create `agent-runtime` Skeleton

Deliverables:

- runtime types
- context snapshot type
- no heavy implementation yet
- tests for missing-context validation

### Step 4: Create `actions`

Move toward a single action boundary.

Deliverables:

- action types
- action policy adapter around existing resource policy
- action registry wrapper
- tests for low/medium/high risk actions

### Step 5: Add Controllers

Start with controllers that reduce `AppShell` churn:

- `useWorkspaceController`
- `useSelectionController`
- `useCloudController`
- `useOrganizationController`

Do not rewrite everything at once. Move one concern at a time and keep tests passing.

### Step 6: Split Library UI

Break `LibraryPane` into smaller components while preserving current behavior.

Deliverables:

- `WorkspaceTreePanel`
- `SelectedSetPanel`
- `CollectionPanel`
- `RecommendationPanel`

### Step 7: Test Decomposition Rule

No new broad scenario should be added to `AppShell.test.tsx` without a reason.

Add focused tests near modules and keep only end-to-end smoke checks in `AppShell.test.tsx`.

### Step 8: Dev Cloud Route Split

Split by route group:

```text
LiteasyClaw/services/dev-cloud/routes/
  adminRoutes.mjs
  accountRoutes.mjs
  modelRoutes.mjs
  recommendationRoutes.mjs
  collectionRoutes.mjs
  documentRoutes.mjs
  organizationRoutes.mjs
```

Tests should follow:

```text
LiteasyClaw/services/dev-cloud/tests/
  adminRoutes.test.mjs
  modelRoutes.test.mjs
  recommendationRoutes.test.mjs
  organizationRoutes.test.mjs
```

## 7. Development Rules After This Refactor

1. New AI behavior starts in `agent-runtime`, not `AssistantPane`.
2. New state-changing behavior starts in `actions`, not random button handlers.
3. New artifact types start in `artifacts`, not `ReaderPane`.
4. New workspace source behavior starts in `workspace`, not `organization`.
5. New selected-document-set behavior starts in `selection`, not `LibraryPane`.
6. New cloud API clients live under `cloud` or the relevant cloud-facing feature, not shell.
7. New module tests are required before shell integration tests.

## 8. First Implementation Plan Scope

The first implementation plan should not try to finish all modularization.

It should cover only:

1. module boundary documentation
2. `selection` module extraction
3. `agent-runtime` type skeleton
4. `actions` module wrapper around current action/resource policy
5. first controller extraction from `AppShell`
6. no-regression tests

This gives the team a stable foundation quickly while avoiding a large rewrite.

## 9. Acceptance Criteria

The foundation is ready when:

- `AppShell` owns less business logic and mostly composes controllers.
- selected document set has a first-class snapshot type.
- agent runtime can receive a context snapshot and return typed events.
- all state-changing commands have a path through registered actions.
- `LibraryPane` is split enough that workspace tree, selection, collection, and recommendation can evolve independently.
- no new large behavior is added to `AppShell.test.tsx`.
- dev-cloud has a clear route-splitting plan and at least one route group extracted.

## 10. Non-Goals

This foundation phase does not:

- implement full cloud SaaS infrastructure
- finish PDF parsing and vector retrieval
- implement all multimodal artifacts
- redesign the UI visually
- rewrite the whole codebase in one pass
- remove existing working demo behavior

The goal is to make future work faster and safer, not to pause product development for a broad refactor.
