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
- `organization` owns organization membership, summary, notifications, shared-library manifests, and governance summaries.

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
