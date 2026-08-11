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

This records the Phase 2 checkpoint, not production deployment acceptance. Generated modalities were still disabled at that checkpoint; Plans 4-6 have since completed the applicable Skill, Kernel, Validator, Renderer, accessibility, fallback, fixture, visual, and release gates recorded below.

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
- Phase 3 completed with generated modalities still disabled at that checkpoint. Plans 4-6 subsequently satisfied the release chains and real-provider smoke recorded below.

### Phase 4 - Static Science Renderers

Status: complete on branch `feat/thin-reading-multimodal-phase4-static` as of 2026-08-11; all four static entries are enabled in the shared production catalog.

- Static modalities implemented and gated: `semantic_graph`, `circuit`, `physics_diagram`, `biology_structure`.
- Commits: `b47fa54`, `582f909`, `6ddea4a`, `0d69a6e`, `7305466`, `0f61a89`, `74f9026`.
- Final gate before enabling: API compiler/runtime tests passed; desktop static modality tests passed; browser visual tests passed; desktop production build passed with generated schema and production asset verification.
- The shared production catalog enables the four generated static modalities only after the service compiler registry and complete desktop Skill/Kernel/Validator/Renderer/fixture chains agree.

### Phase 5 - Interactive Math Renderers

Status: complete as of 2026-08-11; all three interactive-math entries are enabled in the shared production catalog after the cross-plan decision-quality gate passed.

- Interactive math modalities implemented and gated: `function_plot`, `geometry_2d`, `geometry_3d`.
- Commits: `32b5c73`, `0b6800c`, `4479d39`, `7be9979`, `7f43d2d`, `ad0a862`, `e7501d6`.
- Final Phase 5 gate passed API compiler/runtime tests, desktop conformance/release/registry tests, browser visual tests for all three math modalities, and desktop production build.
- Desktop math availability is the intersection of an enabled shared catalog entry and the complete local Skill/Kernel/Validator/Renderer/fallback chain. The service compiler registry remains the authoritative publication boundary.
- `function_plot`, `geometry_2d`, and `geometry_3d` are enabled because the shared catalog, service compiler registry, desktop registration chain, browser checks, and expert-labelled decision gate now agree.

### Phase 6 - Process, Raster, And Release

Status: implementation tasks 1-6 and the code release gates are complete as of 2026-08-11. This is code release readiness, not production deployment acceptance.

- Process and raster renderer/compiler chains implemented and enabled: `physics_process`, `reaction_process`, `raster_illustration`.
- Commits through Task 5: `2c4e476`, `2a4e6a9`, `b85d3b1`, `55c4252`, `22aa03c`.
- Task 6 adds final API and desktop cross-modal release commands. The latest focused gates passed API 10/10 files and desktop 12 files / 40 tests.
- Provider smoke accepts independent structured and image routes. The mandatory `npm run test:provider-smoke` command fails closed when no route or secret is configured; an ordinary repository test may still report an explicit configuration skip and cannot be counted as provider acceptance.
- Broad PostgreSQL, API, desktop, Playwright, production-build, benchmark, cross-modal, real-provider, and expert-labelled decision gates have run successfully as recorded below.
- The shared catalog now enables all ten generated modalities. A real deployment still requires administrator-provisioned routes and credentials, quota and cost policies, outbound network access, and audit acceptance; a local `.env` and successful smoke test do not establish those deployment facts.

#### 2026-08-11 continuation verification

- Real isolated PostgreSQL verification passed for the multimodal branch before integration. After merging main's literature-normalization migration, the production sequence contains 27 migrations: `026_normalize_library_literature_references.sql` followed by `027_visualization_reservation_groups.sql`. The visualization PostgreSQL suite passed 3/3 with zero skips and covers governance transactions, grouped structured/image reservations under one concurrency slot, atomic two-reservation settlement/publication, stale-route rollback, provider accounting, and durable generation requests.
- Liteasy API `npm test` passed 417 tests with 3 explicitly reported configuration-dependent skips; `npm run test:multimodal-release` passed all 10 files. `npm run test:provider-smoke` is now a mandatory, fail-closed live-provider command: absent route or secret configuration exits nonzero rather than being reported as acceptance.
- Desktop `npm test` was recaptured with the JSON reporter after catalog enablement: 292 files passed, with 1,857 tests passed, 4 explicitly reported live/manual skips, and 0 failures out of 1,861 total tests. `npm run test:multimodal-release` passed 12 files / 40 tests; the production build verified 151 emitted files.
- Full Playwright passed 55/55 browser tests, including desktop/mobile pixel and interaction coverage for function plots, 2D/3D geometry, physics/reaction processes, and decoded raster output.
- The latest measured local-fixture renderer projection benchmark passed with deterministic replay `1`, factual evidence binding `1`, first-render P95 `5.769 ms`, initial static transfer `3,770,464` bytes, and Three.js excluded from the initial chunk. This is not provider generation latency or browser first-paint latency.
- A real DNS-pinned structured-generation smoke passed against `https://nowcoding.ai/v1/responses` using the production `openai-compatible` adapter and `gpt-5.4-mini`. The required provider command passed 3/3 without skips and returned the exact schema-constrained result; its response SHA-256 is `a29ee2b15c494311c52521766e44af56a3ad2248e7a8ab465e5206463c13d288`.
- That run exposed a production transport defect: Node can release `response.socket` before the response body's `end` event. `pinnedHttpsFetch` now captures the peer address when response headers arrive and handles a missing socket without dereferencing it; focused regressions cover both cases.
- nowcoding's current entitlement advertises only text models. A real request to `https://nowcoding.ai/v1/images/generations` with `gpt-image-1` failed closed as `visualization_provider_unavailable`; it is not raster-provider acceptance. An image-capable provider must still return a base64 PNG that passes exact dimensions, local OCR for `CELL`, SHA-256 identity, and immutable-storage integrity before `raster_illustration` can be enabled.
- The replacement provider's authenticated `https://vip.auto-code.net/v1/models` endpoint returned HTTP 200 and advertised 18 models, including `gpt-image-1`, `gpt-image-1.5`, and `gpt-image-2`. Advertising was not treated as acceptance: `gpt-image-1` returned HTTP 503 `No available compatible accounts`, and `gpt-image-1.5` also failed closed as unavailable.
- The production DNS-pinned image smoke passed 3/3 without skips against `https://vip.auto-code.net/v1/images/generations` with `gpt-image-2`. It produced a decoded 1,231,311-byte 1024x1024 PNG, local Tesseract verified the exact `CELL` label, and immutable-storage integrity passed with SHA-256 `a6572a96e7e22abce1d97b2cf96b43ea789930b16efb8eb134e3fccd75f7b787`.
- The same provider also passed the production structured smoke 3/3 against `https://vip.auto-code.net/v1/responses` with `gpt-5.4-mini`; its exact schema-constrained response SHA-256 was `a29ee2b15c494311c52521766e44af56a3ad2248e7a8ab465e5206463c13d288`. These observations validate the configured test endpoint and credential at the recorded time; they are not a claim that a production deployment has provisioned or accepted the routes.
- A final post-catalog provider rerun also passed 3/3 without skips. Structured generation retained response SHA-256 `a29ee2b15c494311c52521766e44af56a3ad2248e7a8ab465e5206463c13d288`; the newly generated 1,520,112-byte 1024x1024 PNG passed exact `CELL` OCR and immutable-storage verification with SHA-256 `ae5fa1de70c145f1b05bbe329378d7f62c79651fe7c39e5e98e906b0621d5c9c`. A changed image hash is expected for a new generative sample; integrity is checked per returned asset.
- The original combined thin-reading prompt was not accepted as production decision quality. Its observed necessary-generation recall was unstable across real runs (`60%`, then `80%`, then `40%`), even though its unnecessary-generation rate remained `0%`; the obsolete v1 recording has therefore been removed rather than presented as release evidence.
- Production now uses a dedicated evidence-bounded visualization decision planner after thin-reading evidence review. It reads only evidence adopted by the node, uses a strict JSON schema and controlled decision-basis enum, maps bases deterministically to candidate modalities, allows one bounded repair, fails closed, overrides the provisional prose-generation intent, and persists the decision audit. Both real desktop entry points enable this planner explicitly.
- `planner-decision-evaluation.v2.json` records ten real `gpt-5.4-mini` decisions through the production planner and gateway. Two consecutive real runs against `https://vip.auto-code.net/v1/responses` returned the same 10/10 decisions, with five justified generations, five justified omissions, and no repair attempts; v2 retains the latest provider response and integrity hashes.
- The independent Chinese blind review was completed by domain expert `science-viz-expert-01` without exposing provider outputs during labelling. The measured decision accuracy is `100%`, necessary-generation recall is `100%`, unnecessary-generation rate is `0%`, and `qualityGatePassed` is true against thresholds of `90%`, `85%`, and `5%` respectively.
- Expert labels remain attached when unchanged cases are re-recorded and provider response hashes change. With the planner gate passed and all implementation chains aligned, `function_plot`, `geometry_2d`, `geometry_3d`, `physics_process`, `reaction_process`, and `raster_illustration` are enabled alongside the four static generated modalities.

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
| Necessary-generation recall and unnecessary-generation rate gates, plus a mandatory real-provider smoke command that fails closed without configuration | 06 |
