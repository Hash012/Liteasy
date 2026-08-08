# LiteasyClaw SaaS Development Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a cloud-deployable LiteasyClaw demo quickly for roadshow use while building only those foundations that remain valid for the formal SaaS product after the roadshow.

**Architecture:** The roadmap is split into two coordinated tracks. The demo-delivery track focuses on a cloud-deployable, stable, presenter-friendly slice built from the current `desktop` customer entry point plus a deployable server and internal operations surface. The foundation track runs in parallel and formalizes only the resource boundaries, data ownership rules, and workflow seams that the later SaaS program will definitely keep.

**Tech Stack:** Existing `Tauri 2`, `React`, `TypeScript`, `Rust`, current `development/dev-cloud` Node service, plus incremental formalization of resource typing, deployability, and platform boundaries.

---

## Scope Boundary

This roadmap does not rename or rewrite the historical `phase0-4` documents.

This roadmap defines a new SaaS program line governed by:

- `docs/LiteasyClaw_功能与UI设计文档1.0.md`
- `docs/saas/LiteasyClaw_SaaS纠偏设计与调整方案.md`

## Delivery Objective

The next stage is not "finish the full SaaS". The next stage is:

1. Get a cloud-deployable roadshow version live quickly.
2. Avoid building roadshow-only hacks that must be thrown away immediately after the roadshow.
3. Lay down the minimum durable foundations needed for post-roadshow formal SaaS development.

## Program Principles

1. The `desktop` app remains the customer entry point, not the full product boundary.
2. Organization-side management stays inside the customer software; it is not split into a separate organization admin backend.
3. The internal operations console remains separate from organization-side management.
4. The five resource classes stay fixed:
   - local private
   - user cloud private
   - organization cloud shared
   - platform governance configuration
   - cloud cache
5. Demo acceleration is allowed only when the resulting work is reusable after the roadshow.
6. Historical `phase0-4` plans remain prototype-history documents; all new formal planning happens under `docs/saas/`.

## Dual-Track Plan

### Track D: Roadshow Delivery

This track is optimized for speed to first deployable demo.

#### D1: Deployable Demo Cloud Baseline

**Primary outcome:**

- Turn the current local-only dev-cloud into a clearly deployable roadshow environment.
- Stabilize environment config, endpoint assumptions, startup scripts, and operator-facing deployment notes.

**Why first:**

- Without a deployable service baseline, there is no roadshow environment to present.

**Deliverables:**

- deployable server configuration baseline
- environment-variable contract
- startup and smoke-test guide
- roadshow-focused QA flow

#### D2: Roadshow Core User Loop Hardening

**Primary outcome:**

- Make the presenter-critical user loop stable:
  - open workspace
  - select papers
  - run assistant
  - show recommendations
  - open organization space
  - show artifacts

**Why second:**

- The roadshow must survive live clicking, login, mode switching, and common retries.

**Deliverables:**

- polished demo path
- lower-friction demo data loading
- visible error handling and retry paths
- known-failure playbook for presenters

#### D3: Roadshow Internal Operations Surface

**Primary outcome:**

- Make the internal operations/maintenance demo reliable enough for presentation.
- Keep its semantics honest: internal platform view, not customer organization admin.

**Deliverables:**

- stable internal console demo
- clear platform metrics and three-end boundaries
- presenter script and smoke checks

### Track F: Durable SaaS Foundations

This track runs in parallel, but only on foundations that remain valid after the roadshow.

#### F1: Resource Boundary and Local Library Formalization

**Primary outcome:**

- Lock the five resource classes into code and documentation.
- Turn the prototype local library into a real file-backed local library root.

**Detailed plan:**

- `docs/saas/2026-05-15-liteasyclaw-m1-resource-boundary-local-library-plan.md`

#### F2: User Cloud Private Data and Cache Separation

**Primary outcome:**

- Separate favorites from cache in both product language and code boundaries.
- Define durable cloud-private data versus short-lived cloud cache.

#### F3: In-App Organization Management Formalization

**Primary outcome:**

- Preserve the rule that organization management stays inside the software.
- Formalize creation permission, join rules, role boundaries, and shared-library ownership.

#### F4: Workflow Runtime and Artifact Formalization

**Primary outcome:**

- Preserve the current `skill -> action` safety model while moving toward a formal workflow runtime and task lifecycle.

#### F5: Platform Governance Formalization

**Primary outcome:**

- Formalize the internal platform-governance layer after the roadshow baseline is stable.

## Recommended Execution Order

The two tracks should not be executed as a single serial chain.

Recommended near-term order:

1. D1 Deployable Demo Cloud Baseline
2. D2 Roadshow Core User Loop Hardening
3. F1 Resource Boundary and Local Library Formalization
4. D3 Roadshow Internal Operations Surface
5. F2 User Cloud Private Data and Cache Separation
6. F3 In-App Organization Management Formalization
7. F4 Workflow Runtime and Artifact Formalization
8. F5 Platform Governance Formalization

## Why This Order

- D1 and D2 maximize the chance that you can deploy and present quickly.
- F1 is pulled early because it is small enough to do soon and prevents future confusion around local library ownership.
- D3 finishes the roadshow package.
- F2 onward then build the real SaaS program on top of clearer boundaries.

## Acceptance Gates

### For Track D milestones

Each demo-delivery milestone must satisfy:

- the slice is deployable or demonstrable in a presenter-controlled environment
- the presenter path is documented
- visible failure states are acceptable for live demo use
- the slice does not introduce new architectural lies into the product language

### For Track F milestones

Each foundation milestone must satisfy:

- the boundary is written in docs and reflected in code
- focused tests exist and pass
- the work remains useful after the roadshow
- the work reduces, not increases, later migration risk

## Files and Document Responsibilities

- `docs/saas/LiteasyClaw_SaaS纠偏设计与调整方案.md`: SaaS alignment source.
- `docs/saas/2026-05-15-liteasyclaw-saas-development-roadmap.md`: dual-track roadmap for roadshow plus formal SaaS foundations.
- `docs/saas/2026-05-15-liteasyclaw-m1-resource-boundary-local-library-plan.md`: first formal foundation plan.
- `docs/saas/2026-05-15-liteasyclaw-d1-deployable-demo-cloud-plan.md`: first demo-delivery execution plan.

## Immediate Next Step

Execute two plans in parallel conceptually, but start with the demo line first:

1. `D1` to get a deployable roadshow baseline.
2. `F1` immediately after or in parallel only where it does not slow D1 and D2 materially.

