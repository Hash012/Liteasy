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

### Phase 3 - Reader Orchestration

Status: complete as of 2026-08-10; Tasks 1-8 of the orchestration closure are complete.

- `ecfe70e`: canonical cross-runtime artifact schema and strict API publication validation.
- `d5095e6`: durable generation request state machine, lease recovery, cancellation, and account deletion coverage.
- `1ce9395`: subject-bound v2 intent/evidence resolution and atomic multi-source publication.
- `1da62e3`: allowlisted structured provider adapter, immutable server compiler registry, and shared disabled-by-default production catalog.
- `93cda38`: durable leased orchestration, cancellation races, partial success, strict result reload, and startup recovery.
- `fde8041`: authenticated account request routes with strict bodies and preserved confidential service boundaries.
- `c4b2064`: account-scoped desktop request client, reload recovery, strict persistence, and logout disposal composition.
- `911f24d`: PostgreSQL request-state concurrency, multi-source publication, account deletion, and public HTTP browser orchestration coverage.
- Final gate: PostgreSQL applied 23 migrations and passed 3/3 visualization integration tests with 0 skipped; API 338 tests (335 passed, 3 opt-in PostgreSQL skips); admin 17/17 tests and build asset verification; desktop 242 files (1508 passed, 4 config skips) and production build (4947 modules, 129 assets); existing thin-reading browser suite 18/18; orchestration browser suite 8/8.
- Final review: current-session coordinator review found no Critical or Important findings. Independent-agent review was intentionally not run because this session disabled Superpowers and new subagent delegation.
- Phase 3 is complete, but generated modalities remain disabled until Plans 4-6 satisfy their Skill, Kernel, Validator, Renderer, accessibility, fallback, fixture, visual, and release gates. Real-provider smoke remains assigned to Phase 6.

### Phase 4 - Static Science Renderers

Status: complete on branch `feat/thin-reading-multimodal-phase4-static` as of 2026-08-11.

- Static modalities implemented and gated: `semantic_graph`, `circuit`, `physics_diagram`, `biology_structure`.
- Commits: `b47fa54`, `582f909`, `6ddea4a`, `0d69a6e`, `7305466`, `0f61a89`, `74f9026`.
- Final gate before enabling: API compiler/runtime tests passed; desktop static modality tests passed; browser visual tests passed; desktop production build passed with generated schema and production asset verification.
- The shared production catalog enables the four generated static modalities only after the service compiler registry and complete desktop Skill/Kernel/Validator/Renderer/fixture chains agree.

### Phase 5 - Interactive Math Renderers

Status: complete on branch `feat/thin-reading-multimodal-phase4-static` as of 2026-08-11.

- Interactive math modalities implemented and gated: `function_plot`, `geometry_2d`, `geometry_3d`.
- Commits: `32b5c73`, `0b6800c`, `4479d39`, `7be9979`, `7f43d2d`, `ad0a862`, `e7501d6`.
- Final Phase 5 gate passed API compiler/runtime tests, desktop conformance/release/registry tests, browser visual tests for all three math modalities, and desktop production build.
- Desktop math availability is the intersection of an enabled shared catalog entry and the complete local Skill/Kernel/Validator/Renderer/fallback chain. The service compiler registry remains the authoritative publication boundary.

### Phase 6 - Process, Raster, And Release

Status: implementation tasks 1-6 complete on branch `feat/thin-reading-multimodal-phase4-static` as of 2026-08-11; final broad release gate still pending.

- Process and raster modalities implemented and gated: `physics_process`, `reaction_process`, `raster_illustration`.
- Commits through Task 5: `2c4e476`, `2a4e6a9`, `b85d3b1`, `55c4252`, `22aa03c`.
- Task 6 adds final API and desktop cross-modal release commands. Observed focused gates: API `npm run test:multimodal-release` passed 9/9 subtests; desktop `npm run test:multimodal-release` passed 11 files / 27 tests.
- Provider smoke is wired to execute only when `LITEASY_VISUALIZATION_SMOKE_ROUTE` is configured; current local focused gate records `skipped_configuration` because that route is not configured.
- Final completion still requires the broad PostgreSQL, API, admin, desktop, Playwright, production build, and cross-modal release gates. Do not declare the overall feature complete until those pass.

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
   - Function plots, 2D geometry, lazy Three.js 3D geometry, bounded interactions, worker execution, authoritative service compilers, and the shared catalog gate.
6. `2026-08-09-thin-reading-multimodal-06-process-raster-release.md`
   - Physics and chemistry processes, raster generation, authoritative service compilers, route evaluation, benchmark gates, shared catalog gate, and real-provider smoke verification.

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
| 05 | function/2D/3D kernels and interaction; API compiler/domain validators; catalog consistency | API compiler tests; desktop tests; WebGL pixel tests; `npm run build` |
| 06 | process/raster/evaluation/benchmarks; API compiler/domain validators; catalog consistency | all affected suites, production asset checks, real-provider smoke test |

## Requirement Coverage Check

| Requirement | Plan coverage |
| --- | --- |
| Fixed order, persisted toggle, unauthorized off state, in-flight cancellation, and three deep-dive target kinds | 02, 03 |
| `platform_admin` provider/API configuration, user entitlement, modality allowlist, weighted daily/monthly/concurrency quota, audit, idempotency, rollback, and separate provider-cost ledger | 02 |
| Typed built-in Skills with no remote runtime dependency, one repair, hard/advisory validators, fallback, lazy loading, and Agent Core integration | 01 |
| Flowchart, mindmap, causal/timeline graph, circuit, physics diagram, biology/neural structure, authoritative compilation, deterministic SVG/Canvas, keyboard and accessibility projection | 04 |
| Function plot, 2D geometry, lazy interactive 3D geometry, bounded AST/evaluator, worker isolation, WebGL checks, 2D fallback, authoritative service compilers, and catalog release gate | 05 |
| Physics animation, chemistry balancing/animation, raster provider route, image/OCR/source checks, reduced motion, offline read-only, revalidation, authoritative service compilers, catalog release gate, and release evaluation | 06 |
| Necessary-generation recall and unnecessary-generation rate gates, plus real-provider smoke test that can explicitly be skipped without configuration | 06 |
