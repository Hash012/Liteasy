# Thin Reading Multimodal Visualization Implementation Plan Index

**Goal:** Deliver every modality and governance requirement in the approved thin-reading multimodal design through six independently reviewable implementation plans.

**Source spec:** `docs/superpowers/specs/2026-08-08-thin-reading-multimodal-visualization-design.md`

## Phase Status

### Phase 2 - Control Plane

Status: complete as of 2026-08-10.

- PostgreSQL gate: 22 migrations verified; visualization integration 2 passed, 0 failed, 0 skipped.
- API: 262 passed, with 2 opt-in PostgreSQL tests skipped outside the dedicated gate.
- Admin: `cd products/liteasy/apps/admin && npm test` 17/17 passed, 0 failed; `npm run build` exit 0, 3 assets.
- Desktop: `cd products/liteasy/apps/desktop && npm test` (loopback permitted) exit 0, 240 files passed / 2 config skips and 1484 tests passed / 4 config skips / 0 failed; `npm run build` exit 0, 4944 modules transformed and 129 assets verified (existing chunk-size warning only).
- Final review: 0 Critical and 0 Important findings after commit `53dffdd`.

This records local integration readiness, not production deployment acceptance. Generated modalities remain disabled until the applicable Plans 4-6 Skill, Kernel, Validator, Renderer, accessibility, fallback, fixture, visual, and release gates pass.

## Why This Is A Plan Suite

The specification spans six subsystems with different ownership and verification commands. A single linear patch would mix PostgreSQL transactions, Agent contracts, React rendering, scientific kernels, WebGL, provider integration, and release evaluation. The suite keeps each review boundary coherent while preserving one shared contract.

## Execution Order

1. `2026-08-09-thin-reading-multimodal-01-runtime-foundation.md`
   - Typed artifact contracts, schema validation, built-in Skill packages, validator registry, workflow harness, renderer registry.
2. `2026-08-09-thin-reading-multimodal-02-control-plane.md`
   - Formal API migrations, entitlement, preferences, quota reservations, provider routing, capability projection, administrator UI.
3. `2026-08-09-thin-reading-multimodal-03-reader-integration.md`
   - Thin-reading v2, old-node compatibility, top/body/bottom layout, source-figure selection, semantic-object deep dive, cancellation.
4. `2026-08-09-thin-reading-multimodal-04-static-science-renderers.md`
   - Semantic graphs, circuits, physics diagrams, biology structures, deterministic SVG and accessibility projections.
5. `2026-08-09-thin-reading-multimodal-05-interactive-math-renderers.md`
   - Function plots, 2D geometry, lazy Three.js 3D geometry, bounded interactions and worker execution.
6. `2026-08-09-thin-reading-multimodal-06-process-raster-release.md`
   - Physics and chemistry processes, raster generation, route evaluation, benchmark gates, real-provider smoke verification.

## Cross-Plan Release Rule

Each plan may merge after its own tests pass, but a modality remains disabled in `availableModalities` until its Skill, Kernel, Validator, Renderer, accessibility projection, fallback, fixtures, and visual tests all exist. The overall feature is complete only after plan 6 passes the cross-modality release gate.

## Workspace Rule

The current checkout contains user changes in thin-reading and association files. Before execution, use the `using-git-worktrees` skill and preserve those changes explicitly. Do not copy, reset, or overwrite them. If the changes must be part of the implementation baseline, integrate them through a user-approved commit or a carefully reviewed patch before starting plan 3.

## Verification Matrix

| Plan | Focused verification | Broad verification |
| --- | --- | --- |
| 01 | visualization schemas, registry, harness | desktop `npm test`, `npm run build` |
| 02 | API repository/service/server; admin capability UI | API `npm test`; admin `npm test`, `npm run build`; desktop capability tests |
| 03 | thin-reading migration, layout, deep dive | desktop thin-reading tests, Playwright, `npm run build` |
| 04 | four static modality kernels/renderers | desktop modality tests, browser screenshots, `npm run build` |
| 05 | function/2D/3D kernels and interaction | desktop tests, WebGL pixel tests, `npm run build` |
| 06 | process/raster/evaluation/benchmarks | all affected suites, production asset checks, real-provider smoke test |

## Requirement Coverage Check

| Requirement | Plan coverage |
| --- | --- |
| Fixed order, persisted toggle, unauthorized off state, in-flight cancellation, and three deep-dive target kinds | 02, 03 |
| `platform_admin` provider/API configuration, user entitlement, modality allowlist, weighted daily/monthly/concurrency quota, audit, idempotency, rollback, and separate provider-cost ledger | 02 |
| Typed built-in Skills with no remote runtime dependency, one repair, hard/advisory validators, fallback, lazy loading, and Agent Core integration | 01 |
| Flowchart, mindmap, causal/timeline graph, circuit, physics diagram, biology/neural structure, deterministic SVG/Canvas, keyboard and accessibility projection | 04 |
| Function plot, 2D geometry, lazy interactive 3D geometry, bounded AST/evaluator, worker isolation, WebGL checks, and 2D fallback | 05 |
| Physics animation, chemistry balancing/animation, raster provider route, image/OCR/source checks, reduced motion, offline read-only, revalidation, and release evaluation | 06 |
| Necessary-generation recall and unnecessary-generation rate gates, plus real-provider smoke test that can explicitly be skipped without configuration | 06 |
