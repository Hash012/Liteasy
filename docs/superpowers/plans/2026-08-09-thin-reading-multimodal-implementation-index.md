# Thin Reading Multimodal Visualization Implementation Plan Index

**Goal:** Deliver every modality and governance requirement in the approved thin-reading multimodal design through six independently reviewable implementation plans.

**Source spec:** `docs/superpowers/specs/2026-08-08-thin-reading-multimodal-visualization-design.md`

## Phase Status

### Phase 1 - Runtime Foundation

Status: implemented on main and covered by local contract/runtime tests as of 2026-08-11.

- Canonical v1 artifact types and JSON Schema, built-in catalog, validator/renderer registries, workflow harness, deterministic source-figure path, fallback semantics, and artifact persistence boundaries are present.
- This is infrastructure readiness, not generated-modality release. The production catalog still enables only `source_figure`.

### Phase 2 - Control Plane

Status: complete as of 2026-08-10.

- PostgreSQL gate: 22 migrations verified; visualization integration 2 passed, 0 failed, 0 skipped.
- API: 262 passed, with 2 opt-in PostgreSQL tests skipped outside the dedicated gate.
- Admin: `cd products/liteasy/apps/admin && npm test` 17/17 passed, 0 failed; `npm run build` exit 0, 3 assets.
- Desktop: `cd products/liteasy/apps/desktop && npm test` (loopback permitted) exit 0, 240 files passed / 2 config skips and 1484 tests passed / 4 config skips / 0 failed; `npm run build` exit 0, 4944 modules transformed and 129 assets verified (existing chunk-size warning only).
- Final review: 0 Critical and 0 Important findings after commit `53dffdd`.

This records local integration readiness, not production deployment acceptance. Generated modalities remain disabled until the applicable Plans 4-6 Skill, Kernel, Validator, Renderer, accessibility, fallback, fixture, visual, and release gates pass.

### Phase 3 - Reader Orchestration

Status: implementation and local gates complete as of 2026-08-10; formal closure pending an independent review required by the closure design.

- `ecfe70e`: canonical cross-runtime artifact schema and strict API publication validation.
- `d5095e6`: durable generation request state machine, lease recovery, cancellation, and account deletion coverage.
- `1ce9395`: subject-bound v2 intent/evidence resolution and atomic multi-source publication.
- `1da62e3`: allowlisted structured provider adapter, immutable server compiler registry, and shared disabled-by-default production catalog.
- `93cda38`: durable leased orchestration, cancellation races, partial success, strict result reload, and startup recovery.
- `fde8041`: authenticated account request routes with strict bodies and preserved confidential service boundaries.
- `c4b2064`: account-scoped desktop request client, reload recovery, strict persistence, and logout disposal composition.
- `911f24d`: PostgreSQL request-state concurrency, multi-source publication, account deletion, and public HTTP browser orchestration coverage.
- Final gate: PostgreSQL applied 23 migrations and passed 3/3 visualization integration tests with 0 skipped; API 338 tests (335 passed, 3 opt-in PostgreSQL skips); admin 17/17 tests and build asset verification; desktop 242 files (1508 passed, 4 config skips) and production build (4947 modules, 129 assets); existing thin-reading browser suite 18/18; orchestration browser suite 8/8.
- Current-session review found no Critical or Important findings. The separate independent closure review has not completed, so this phase must not be described as formally closed.
- Generated modalities remain disabled until Plans 4-6 satisfy their Skill, Kernel, Validator, Renderer, accessibility, fallback, fixture, visual, and release gates. Real-provider smoke remains assigned to Phase 6.

### Phase 4 - Static Science Renderers

Status: not started as of 2026-08-11; the post-merge implementation audit found only the shared v1 contracts and runtime foundation, not any Phase 4 kernel, renderer, generated Skill, modality validator, conformance fixture, or browser visual gate.

- Do not count schema branches or generic artifact fixtures as a completed static modality.
- The Phase 4 plan was corrected after the audit to include authoritative API compiler descriptors and server domain hard validators. Desktop validation alone cannot authorize publication.
- Static modality availability is the intersection of an enabled shared catalog entry, a matching server compiler, and a complete desktop Skill/Kernel/Validator/Renderer/fixture chain.
- The production catalog still enables only `source_figure`; no generated modality is enabled before the corrected Phase 4 release gate passes.

### Phases 5-6 - Interactive, Process, Raster, And Release

Status: not started as of 2026-08-11.

- Function/geometry/Three.js renderers, physics/chemistry process renderers, raster provider integration, cross-modality benchmarks, and real-provider release smoke remain planned work.
- Schema branches and orchestration fixtures do not count as completed modality implementations.

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
   - Semantic graphs, circuits, physics diagrams, biology structures, deterministic SVG, accessibility projections, authoritative service compilers, and the shared catalog gate.
5. `2026-08-09-thin-reading-multimodal-05-interactive-math-renderers.md`
   - Function plots, 2D geometry, lazy Three.js 3D geometry, bounded interactions and worker execution.
6. `2026-08-09-thin-reading-multimodal-06-process-raster-release.md`
   - Physics and chemistry processes, raster generation, route evaluation, benchmark gates, real-provider smoke verification.

## Cross-Plan Release Rule

Each plan may merge after its own tests pass, but a modality remains disabled in `availableModalities` until its Skill, Kernel, server compiler and hard validators, desktop validators and Renderer, accessibility projection, fallback, fixtures, and visual tests all exist. Enabling requires exact agreement among the shared production catalog, the API compiler registry, and the complete desktop registration chain; any missing or mismatched element fails closed. The overall feature is complete only after plan 6 passes the cross-modality release gate.

## Workspace Rule

The current checkout contains user changes in thin-reading and association files. Before execution, use the `using-git-worktrees` skill and preserve those changes explicitly. Do not copy, reset, or overwrite them. If the changes must be part of the implementation baseline, integrate them through a user-approved commit or a carefully reviewed patch before starting plan 3.

## Verification Matrix

| Plan | Focused verification | Broad verification |
| --- | --- | --- |
| 01 | visualization schemas, registry, harness | desktop `npm test`, `npm run build` |
| 02 | API repository/service/server; admin capability UI | API `npm test`; admin `npm test`, `npm run build`; desktop capability tests |
| 03 | thin-reading migration, layout, deep dive | desktop thin-reading tests, Playwright, `npm run build` |
| 04 | four static modality kernels/renderers; API compiler/domain validators; catalog consistency | API compiler/runtime tests; desktop modality tests; browser screenshots; `npm run build` |
| 05 | function/2D/3D kernels and interaction | desktop tests, WebGL pixel tests, `npm run build` |
| 06 | process/raster/evaluation/benchmarks | all affected suites, production asset checks, real-provider smoke test |

## Requirement Coverage Check

| Requirement | Plan coverage |
| --- | --- |
| Fixed order, persisted toggle, unauthorized off state, in-flight cancellation, and three deep-dive target kinds | 02, 03 |
| `platform_admin` provider/API configuration, user entitlement, modality allowlist, weighted daily/monthly/concurrency quota, audit, idempotency, rollback, and separate provider-cost ledger | 02 |
| Typed built-in Skills with no remote runtime dependency, one repair, hard/advisory validators, fallback, lazy loading, and Agent Core integration | 01 |
| Flowchart, mindmap, causal/timeline graph, circuit, physics diagram, biology/neural structure, authoritative compilation, deterministic SVG/Canvas, keyboard and accessibility projection | 04 |
| Function plot, 2D geometry, lazy interactive 3D geometry, bounded AST/evaluator, worker isolation, WebGL checks, and 2D fallback | 05 |
| Physics animation, chemistry balancing/animation, raster provider route, image/OCR/source checks, reduced motion, offline read-only, revalidation, and release evaluation | 06 |
| Necessary-generation recall and unnecessary-generation rate gates, plus real-provider smoke test that can explicitly be skipped without configuration | 06 |
