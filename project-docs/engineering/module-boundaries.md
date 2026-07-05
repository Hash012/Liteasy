# LiteasyClaw Module Boundaries

## Purpose

This document defines where new work belongs so LiteasyClaw can evolve without turning `AppShell`, broad pane props, or monolithic tests into shared bottlenecks.

## Dependency Direction

Allowed direction:

```text
shell -> controllers -> feature modules -> shared types / clients
```

Current mapping:

- `shell` currently maps to `LiteasyClaw/desktop/src/app/layout/`.
- `controllers` will be introduced under `LiteasyClaw/desktop/src/app/controllers/` during the modular foundation work.
- feature modules currently live under `LiteasyClaw/desktop/src/app/features/`.

Feature modules must not import `AppShell` or shell components.

## Module Rules

- `shell` owns layout, pane sizing, top bar, activity rail, and global dialog hosting.
- `dock` owns DockItem registration, tab groups, cross-region dragging, layout-tree persistence, region sizing, and empty-region presentation. The canonical placement rules live in `project-docs/engineering/dock-workbench-ui-placement.md`.
- `controllers` adapt feature modules into shell-ready models and actions.
- `workspace` owns workspace source, papers, revision, and folder-tree normalization.
- `selection` owns selected-document-set snapshots and readiness validation. This module is introduced by the modular foundation work; until then, selection state still lives in `workspace` as `selectedPaperIds` and `selectionLocked`.
- `ingestion` owns parse/chunk/index lifecycle and import job state. This is the product-domain name for the current `LiteasyClaw/desktop/src/app/features/import/` module.
- `retrieval` owns chunks, citations, and source-grounded lookup.
- `agent-runtime` owns context snapshots, intent routing, runtime events, skill execution contracts, and confirmation requests. This module is introduced by the AI-native interaction runtime work; current assistant behavior still lives under `assistant`, `skills`, and `models`.
- `actions` owns state-changing action contracts, policies, risk levels, and confirmation rules.
- `assistant` owns the right-pane interaction surface and renders runtime events.
- `artifacts` owns artifact tasks, tabs, previews, and renderer lifecycle.
- `cloud` owns account, model, collection, recommendation, cache, and metadata-sync clients/controllers.
- `knowledge-sync` is the shell-facing coordination layer for collection, recommendation, and metadata-sync state. It composes the underlying `collection`, `recommendations`, and `metadata` features without owning their domain logic.
- `organization` owns organization membership, summary, notifications, shared-library manifests, and governance summaries.

## Current Controllers

- `LiteasyClaw/desktop/src/app/controllers/useWorkspaceSelectionController.ts` owns the shell-facing workspace model: cloned workspace state, selected-document-set snapshot, workspace label, and local-library snapshot synchronization.
- `LiteasyClaw/desktop/src/app/controllers/useCloudAccountController.ts` owns the shell-facing account model: account session, account message/pending state, lightweight login dialog state, login reminder behavior, and cloud availability status.
- `LiteasyClaw/desktop/src/app/controllers/useArtifactWorkflowController.ts` owns the shell-facing artifact workflow model: artifact tasks, artifact tabs, direct modal analysis entry, and assistant-triggered artifact generation entry.
- `LiteasyClaw/desktop/src/app/controllers/useKnowledgeSyncController.ts` owns the shell-facing knowledge sync model: collection items/state, recommendation items/state, and document metadata sync state.
- `LiteasyClaw/desktop/src/app/controllers/useOrganizationShellController.ts` owns the shell-facing organization model: organization dialogs/actions, notifications, list/summary/governance data, and shared-library workspace entry points.

New controllers should follow the same rule: expose a small `model` object and a small `actions` object, while keeping feature modules free of shell imports.

Cross-module cleanup should stay in shell composition unless a dedicated controller owns both sides. For example, cloud account logout is exposed by `useCloudAccountController`, while organization notification/action reset is composed in `AppShell`.

## Mutation Rule

Any behavior that changes application state should be expressible as a registered action. Buttons, AI commands, and future keyboard shortcuts should converge on the same action contract.

## Selection Rule

Any feature that analyzes documents should depend on a `SelectedDocumentSetSnapshot`, not directly on checkbox UI state.

Until `SelectedDocumentSetSnapshot` is available, new code should avoid adding more direct checkbox-state coupling and should keep selection access isolated behind workspace helpers.

## Runtime Rule

AI-native interaction starts in `agent-runtime`. Assistant UI renders runtime events and should not infer hidden state-changing behavior from free-form text.

Until `agent-runtime` is available, new assistant behavior should be isolated so it can move behind runtime events without changing the UI contract.

## Test Placement

- New pure module behavior: create focused tests in `LiteasyClaw/desktop/src/tests/<module-name>*.test.ts`.
- New component behavior: create focused component tests in `LiteasyClaw/desktop/src/tests/<ComponentName>.test.tsx`.
- `AppShell.test.tsx` is reserved for smoke tests and high-value integration paths only.
- Service route behavior should live in domain route tests once routes are split.

## AppShell Rule

`AppShell` should compose controllers and panes. It should not keep accumulating domain-specific orchestration logic.

## Dock Placement Rule

New independently openable UI must first be classified as a `DockItem`; it must not be appended directly to a fixed pane.

- resource discovery and navigation default to the left region;
- primary reading, editing, and final visual artifacts default to the main region;
- contextual tools and assistant interaction default to the right region;
- tasks, logs, generation runs, and intermediate outputs default to the bottom region.

The left, right, and bottom region toggles only control region visibility. If a user expands one of those regions while it has no tabs, the region renders the shared Logo-only `DockEmptyState` and remains a valid drop target.

Feature state is independent from Dock location. Moving or closing a tab must not delete its domain data.
