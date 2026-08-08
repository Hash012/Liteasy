# LiteasyClaw D2 Roadshow Core User Loop Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the presenter-critical LiteasyClaw user loop for roadshow use while performing only the structural refactors that directly improve stability, deployability, and follow-on development speed.

**Architecture:** This milestone keeps the existing desktop app and deployable demo cloud baseline, but improves the live-demo path end-to-end: login, organization loading, recommendation flow, assistant answers, and artifact entry points. Structural cleanup is limited to high-value boundary splits, especially in `development/dev-cloud/server.mjs`, so the roadshow baseline becomes easier to maintain without losing momentum.

**Tech Stack:** Existing `desktop` stack, existing `development/dev-cloud` Node service, current `Vitest` and Node test runner suites

---

## Scope Summary

This plan is not a general cleanup pass.

It does two things only:

1. Stabilize the presenter-critical user path.
2. Fix file-structure problems that now directly hurt development speed or reliability.

## Required Structural Boundaries

This milestone should actively improve these current pain points:

- `development/dev-cloud/server.mjs` is too large and mixes configuration, payload construction, admin HTML, routing, and CLI startup.
- `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx` should not absorb additional orchestration logic without extracting helpers.
- `products/liteasy/apps/desktop/src/tests/AppShell.test.tsx` should not continue absorbing unrelated scenarios if focused topic-level test files can be introduced instead.

## File Responsibilities

- `development/dev-cloud/server.mjs`: should become a thinner composition/root file.
- `development/dev-cloud/config.mjs`: should own deployment/runtime config parsing.
- `development/dev-cloud/payloads/*.mjs`: should own demo response builders by domain.
- `development/dev-cloud/adminConsole.mjs`: should own admin HTML rendering.
- `development/dev-cloud/requestHandler.mjs`: should own route dispatch wiring if the split is justified by the current code shape.
- `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx`: should remain the assembly layer, not accumulate more domain behavior.
- `products/liteasy/apps/desktop/src/tests/*`: roadshow-critical tests should be added or split by concern when that reduces pressure on the monolithic `AppShell.test.tsx`.

## Execution Themes

### Theme 1: Dev-cloud structure split

**Primary outcome:**

- Reduce `server.mjs` to a clearer root entry and request wiring layer.

**Must keep working:**

- root service index
- `/healthz`
- `/admin/`
- model policy
- demo login
- recommendation
- organization endpoints

### Theme 2: Presenter-critical desktop loop hardening

**Primary outcome:**

- Make the following sequence reliable:
  - connect account
  - load organization panel
  - open organization or return to local workspace
  - show recommendation state
  - ask a question in assistant
  - open at least one artifact path

### Theme 3: Presentation-safe error handling

**Primary outcome:**

- Replace ambiguous error states with presenter-safe copy and retry guidance where needed.

## Immediate Implementation Order

1. Split `development/dev-cloud/server.mjs` by responsibility with tests kept green.
2. Add or isolate focused tests for the roadshow-critical desktop loop.
3. Make minimal desktop code changes needed to remove fragile presenter-path behavior.
4. Update roadshow docs only where the live path changes.

## Acceptance Gate

D2 can be considered complete only when:

- the presenter-critical user loop works in a controlled demo environment
- `development/dev-cloud/server.mjs` no longer remains a 1000+ line mixed-responsibility file
- tests still pass after the split
- docs still describe the live roadshow path correctly

## Follow-On Constraint

Do not use D2 as an excuse for broad cleanup.

Only perform refactors that satisfy at least one of these:

- they reduce live-demo risk
- they reduce immediate development friction in the next SaaS milestone
- they remove a file-structure hotspot that is already blocking clear ownership
