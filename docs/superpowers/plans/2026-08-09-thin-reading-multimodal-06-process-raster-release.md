# Thin Reading Process, Raster, And Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete physics and chemistry process animations, governed raster illustration generation, authoritative process/raster compilers, cross-modality evaluation, performance benchmarks, and the final release gate for thin-reading multimodality.

**Architecture:** Process artifacts use deterministic state timelines produced by bounded workers; the renderer only projects validated states into Canvas/SVG. The Liteasy API compiler remains the publication authority for `physics_process`, `reaction_process`, and `raster_illustration`: provider output can only be typed specs or normalized image assets and must pass service hard validation before publication. Raster generation is an optional provider operation behind the control-plane route, with strict image dimensions, content, OCR, source-separation, and evidence checks. A fixture-driven evaluator measures correctness, evidence binding, accessibility, latency, bundle cost, and fallback behavior before any modality is advertised.

**Tech Stack:** TypeScript 5.8, Node.js 20, Canvas/SVG, Web Workers, Sharp (existing image boundary if available), provider gateway from plan 02, Vitest, Node test runner, Playwright, npm build tooling.

## Global Constraints

- Provider/API configuration remains deployment-admin-only through the existing `platform_admin` path; desktop never receives secrets.
- Provider failure, cancellation, timeout, validation failure, or entitlement loss rolls back all user reservations; operational provider cost remains in its separate ledger.
- No remote dependency on EduLab, SchemaTex, stem-illustration-skill, or ink-graph is introduced.
- Every animation is bounded, reproducible, cancellable, and labelled as a model projection rather than proof of real-world completeness.
- Raster pixels are never evidence; factual labels and relationships remain bound to typed evidence and pass the same hard gates as vector artifacts.
- Release checks fail closed and preserve the fixed order: generated visualization above prose, original paper figures below prose.
- Generated process and raster modalities remain disabled in the shared production catalog until their service compiler, service hard validator, desktop Skill, Kernel or validator, Renderer, accessibility projection, fallback, normal/refusal/interaction fixtures, desktop/mobile visual tests, and catalog gate all pass.

---

### Task 1: Physics Process Kernel, Worker, And Animation Renderer

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/kernels/physicsProcessKernel.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/workers/physicsProcess.worker.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/physicsProcessRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/physics-process/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/physics-process/fixtures/projectile-motion.json`
- Test: `products/liteasy/apps/desktop/src/tests/physicsProcessKernel.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/physicsProcessWorker.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/browser/physicsProcess.browser.spec.ts`

**Interfaces:**
- Consumes: `PhysicsProcessSpecV1`, bounded expression evaluator from plan 05, `AbortSignal`, and `VisualizationWorkflowHarness`.
- Produces: `simulatePhysicsProcess()`, worker protocol `{ requestId, spec } -> { requestId, frames, diagnostics }`, `renderPhysicsProcess()`.

- [ ] **Step 1: Write failing deterministic and conservation tests**

```ts
const projectileFixture = {
  modality: "physics_process", duration: 2, frameRate: 30, initialState: { x: 0, y: 0, vx: 10, vy: 10 },
  parameters: [{ id: "g", value: 9.8, unit: "m/s^2", min: 9, max: 10 }],
  equations: [{ id: "x", expression: "x + vx * dt" }, { id: "y", expression: "y + vy * dt - 0.5 * g * dt^2" }],
  events: [], invariants: [{ id: "ground", expression: "y >= 0" }], evidenceBindings: ["claim-projectile"]
} as const;
test("replays the same seeded timeline byte-for-byte", () => expect(simulatePhysicsProcess(projectileFixture, "seed-1")).toEqual(simulatePhysicsProcess(projectileFixture, "seed-1")));
test("fails the hard gate when accumulated error exceeds the declared threshold", () => expect(() => simulatePhysicsProcess({ ...projectileFixture, errorTolerance: 0 }, "seed-1")).toThrow("physics_error_tolerance_exceeded"));
```

- [ ] **Step 2: Run tests and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/physicsProcessKernel.test.ts src/tests/physicsProcessWorker.test.ts`

Expected: FAIL because the process kernel and worker do not exist.

- [ ] **Step 3: Implement bounded integration and replay metadata**

Prefer closed-form equations when declared; otherwise use a fixed-step integrator capped at 120 frames and the spec's maximum step count. Check finite state, units, boundary conditions, invariant error, and monotonic event times. Persist algorithm ID, seed, precision, and tolerance in the artifact diagnostics.

- [ ] **Step 4: Implement cancellable worker and observation-only renderer**

Worker messages include request IDs and reject stale responses. The Canvas renderer supports play, pause, single-step, timeline scrub, bounded parameter sliders, trajectory highlighting, and keyboard controls. It honors `prefers-reduced-motion` by starting paused and exposing keyframes without automatic playback. A static keyframe fallback is generated from the same validated states when animation is unavailable.

- [ ] **Step 5: Run browser checks and commit**

Playwright checks that play/pause changes pixels, single-step advances exactly one frame, cancellation leaves no committed artifact, controls remain usable at 390x844, and the canvas is nonblank.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/kernels/physicsProcessKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/workers/physicsProcess.worker.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/physicsProcessRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/physics-process products/liteasy/apps/desktop/src/tests/physicsProcessKernel.test.ts products/liteasy/apps/desktop/src/tests/physicsProcessWorker.test.ts products/liteasy/apps/desktop/src/tests/browser/physicsProcess.browser.spec.ts
git commit -m "feat: add bounded physics process animation"
```

### Task 2: Chemical Reaction Kernel And Animation Renderer

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/kernels/reactionProcessKernel.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/reactionProcessRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/reaction-process/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/reaction-process/fixtures/combustion.json`
- Test: `products/liteasy/apps/desktop/src/tests/reactionProcessKernel.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/reactionProcessRenderer.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/browser/reactionProcess.browser.spec.ts`

**Interfaces:**
- Consumes: `ReactionProcessSpecV1`, evidence bindings, and deterministic scene helpers.
- Produces: `parseChemicalFormula()`, `balanceReaction()`, `validateReactionProcess()`, `renderReactionProcess()`.

- [ ] **Step 1: Write failing conservation tests**

```ts
const combustionFixture = { modality: "reaction_process", species: [{ id: "ch4", formula: "CH4", state: "g" }, { id: "o2", formula: "O2", state: "g" }, { id: "co2", formula: "CO2", state: "g" }, { id: "h2o", formula: "H2O", state: "l" }], steps: [{ id: "overall", reactants: [{ speciesId: "ch4", coefficient: 1 }, { speciesId: "o2", coefficient: 2 }], products: [{ speciesId: "co2", coefficient: 1 }, { speciesId: "h2o", coefficient: 2 }], evidenceClaimIds: ["reaction-claim"] }], conditions: [], atomMap: [] } as const;
test("balances and conserves atoms", () => expect(balanceReaction(combustionFixture.steps[0])).toEqual({ ch4: 1, o2: 2, co2: 1, h2o: 2 }));
test("rejects a claimed mechanism without mechanism evidence", () => expect(() => validateReactionProcess({ ...combustionFixture, steps: [{ ...combustionFixture.steps[0], mechanism: [{ id: "m1", label: "radical", evidenceClaimIds: [] }] }] })).toThrow("reaction_mechanism_unbound"));
```

- [ ] **Step 2: Run test and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/reactionProcessKernel.test.ts src/tests/reactionProcessRenderer.test.tsx`

Expected: FAIL because reaction modules do not exist.

- [ ] **Step 3: Implement formula parsing, balancing, and atom-map checks**

Parse element symbols, nested groups, charges, and state suffixes with bounded nesting. Balance integer coefficients using exact rational arithmetic, then verify element and charge conservation. Validate atom maps only when every mapped atom exists on both sides. If evidence contains only a total reaction, reject added mechanism steps.

- [ ] **Step 4: Render a time-sequenced reaction projection**

Render species, coefficients, conditions, and step transitions as escaped SVG/Canvas. Provide play, pause, step, species highlighting, and keyboard focus. Fallback sequence is mechanism animation -> reaction-level animation -> balanced equation and state table, each with its own validation report.

- [ ] **Step 5: Run visual tests and commit**

Playwright asserts coefficients and state labels remain readable, playback changes frame state, no element is shown as an unsupported 3D molecule, and the artifact remains selectable for deep dive.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/kernels/reactionProcessKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/reactionProcessRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/reaction-process products/liteasy/apps/desktop/src/tests/reactionProcessKernel.test.ts products/liteasy/apps/desktop/src/tests/reactionProcessRenderer.test.tsx products/liteasy/apps/desktop/src/tests/browser/reactionProcess.browser.spec.ts
git commit -m "feat: add evidence-bound reaction animation"
```

### Task 3: Raster Provider Route And Image Validator

**Files:**
- Create: `products/liteasy/services/api/src/visualizationRasterService.mjs`
- Create: `products/liteasy/services/api/src/visualizationRasterService.test.mjs`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/validators/rasterValidators.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/rasterIllustrationRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/raster-illustration/skill.json`
- Test: `products/liteasy/apps/desktop/src/tests/rasterValidators.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/rasterIllustrationRenderer.test.tsx`

**Interfaces:**
- Consumes: `VisualizationProviderGateway.generateImage()` from plan 02, `RasterIllustrationSpecV1`, evidence claims, and artifact submission boundary.
- Produces: `generateRasterIllustration()`, `validateRasterImage()`, `renderRasterIllustration()`.

- [ ] **Step 1: Write failing provider and image tests**

```js
test("normalizes a provider image without exposing provider fields", async () => {
  const result = await generateRasterIllustration({ provider: imageAdapter({ bytes: validPngBytes(), width: 1024, height: 768 }) });
  assert.deepEqual(Object.keys(result), ["assetRef", "width", "height", "mimeType", "sha256"]);
});
```

```ts
test("rejects a raster with a mismatched digest or forbidden external reference", async () => {
  await expect(validateRasterImage({ bytes: validPngBytes(), declaredSha256: "wrong", spec: rasterFixture() })).rejects.toThrow("raster_digest_mismatch");
  await expect(validateRasterImage({ bytes: svgWithExternalImage(), declaredSha256: "", spec: rasterFixture() })).rejects.toThrow("raster_external_reference");
});
```

Define `validPngBytes()`, `svgWithExternalImage()`, `imageAdapter()`, and `rasterFixture()` in their respective test fixture modules; fixtures contain no secrets or real paper content.

- [ ] **Step 2: Run tests and verify red**

Run: `cd products/liteasy/services/api && node --test src/visualizationRasterService.test.mjs`; then `cd products/liteasy/apps/desktop && npm test -- src/tests/rasterValidators.test.ts`

Expected: FAIL because the service, validators, and renderer do not exist.

- [ ] **Step 3: Implement normalized image handling and hard checks**

The service requests only the typed prompt/schema projection, enforces route limits and `AbortSignal`, stores bytes through the existing S3 boundary, and returns an opaque asset reference. Validators check MIME allowlist, dimensions, byte limit, digest, decodeability, transparency policy, OCR labels against typed labels, no scripts/external references, and source-figure identity separation. A raster cannot pass when labels lack evidence bindings.

- [ ] **Step 4: Render with fixed dimensions and source distinction**

The renderer lazy-loads image bytes from the asset client, provides alt text and a structured label table, supports zoom/pan/highlight/select, and visibly distinguishes generated raster from original paper figures without exposing provider terminology.

- [ ] **Step 5: Run tests and commit**

Run: `cd products/liteasy/services/api && node --test src/visualizationRasterService.test.mjs`; `cd products/liteasy/apps/desktop && npm test -- src/tests/rasterValidators.test.ts src/tests/rasterIllustrationRenderer.test.tsx`

Expected: PASS.

```bash
git add products/liteasy/services/api/src/visualizationRasterService.mjs products/liteasy/services/api/src/visualizationRasterService.test.mjs products/liteasy/apps/desktop/src/app/features/visualization/validators/rasterValidators.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/rasterIllustrationRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/raster-illustration products/liteasy/apps/desktop/src/tests/rasterValidators.test.ts products/liteasy/apps/desktop/src/tests/rasterIllustrationRenderer.test.tsx
git commit -m "feat: govern raster illustration generation"
```

### Task 4: Authoritative Process And Raster Compilers

**Files:**
- Create: `products/liteasy/services/api/src/processRasterVisualizationCompilers.mjs`
- Test: `products/liteasy/services/api/src/processRasterVisualizationCompilers.test.mjs`
- Test: `products/liteasy/services/api/src/processRasterReleaseGate.test.mjs`
- Create: `development/test-data/thin-reading-multimodal/process-raster-conformance.v1.json`
- Test: `products/liteasy/apps/desktop/src/tests/processRasterConformance.test.ts`
- Modify: `products/liteasy/packages/shared/visualizationBuiltins.v1.json`

**Interfaces:**
- Consumes: `PhysicsProcessSpecV1`, `ReactionProcessSpecV1`, `RasterIllustrationSpecV1`, shared JSON Schema, process/raster validators, and normalized raster assets.
- Produces: service compiler descriptors, server domain hard validation, process/raster conformance fixtures, and catalog enablement only when the complete chain exists.

- [ ] **Step 1: Write failing service compiler and catalog tests**

The tests must reject process timelines with missing evidence, unbounded frame counts, non-finite states, failed physics invariants, unbalanced reactions, unsupported mechanisms, raster labels without evidence, source-figure identity collisions, external references, and catalog entries with no compiler.

- [ ] **Step 2: Implement service compiler descriptors and hard validators**

Add immutable compiler descriptors for `physics_process`, `reaction_process`, and `raster_illustration`. Process compilers validate typed specs only, enforce deterministic replay metadata, and reject arbitrary animation scripts or DOM. The raster compiler accepts only normalized image metadata plus typed evidence-bound labels, verifies digest and asset boundaries through the raster service, and rejects provider-specific fields.

- [ ] **Step 3: Add cross-runtime conformance fixtures**

Fixtures cover normal, refusal/fallback, invalid evidence, invalid process bounds, invalid chemistry conservation, invalid raster digest/reference, and interaction metadata for all three generated modalities. Desktop and API tests must agree on pass/fail/omit outcomes.

- [ ] **Step 4: Enable catalog entries and commit**

Only this task may enable `physics_process`, `reaction_process`, and `raster_illustration` in the shared production catalog, and only in the same focused change that proves the service compiler registry and desktop implementation chain are complete.

```bash
cd products/liteasy/services/api && node --test src/processRasterVisualizationCompilers.test.mjs src/processRasterReleaseGate.test.mjs
cd products/liteasy/apps/desktop && npm test -- src/tests/processRasterConformance.test.ts
git add products/liteasy/services/api/src/processRasterVisualizationCompilers.mjs products/liteasy/services/api/src/processRasterVisualizationCompilers.test.mjs products/liteasy/services/api/src/processRasterReleaseGate.test.mjs development/test-data/thin-reading-multimodal/process-raster-conformance.v1.json products/liteasy/apps/desktop/src/tests/processRasterConformance.test.ts products/liteasy/packages/shared/visualizationBuiltins.v1.json
git commit -m "feat: validate process and raster artifacts on server"
```

### Task 5: Fixture Evaluator And Performance Benchmarks

**Files:**
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/multimodalEvaluationFixtures.ts`
- Create: `products/liteasy/apps/desktop/src/tests/multimodalEvaluation.test.ts`
- Create: `products/liteasy/apps/desktop/scripts/benchmark-visualization.mjs`
- Create: `products/liteasy/apps/desktop/src/tests/visualizationPerformance.test.ts`

**Interfaces:**
- Consumes: all modality validators/renderers, the browser fixture harness, and capability/fallback projections.
- Produces: `runMultimodalEvaluation()`, JSON benchmark output, and CI-readable acceptance thresholds.

- [ ] **Step 1: Define complete acceptance fixtures**

Include at least one fixture per requested modality: flowchart, mindmap, circuit, physics diagram, neural structure, plane geometry, 3D geometry, function plot, physics process, reaction process, raster illustration, and source figure. Each fixture declares expected object IDs, evidence claim IDs, fallback modality, accessibility summary, and maximum render dimensions.

- [ ] **Step 2: Write failing evaluation assertions**

```ts
test("every requested modality has a passing fixture or explicit fail-closed result", async () => {
  const report = await runMultimodalEvaluation(multimodalEvaluationFixtures);
  expect(report.missingModalities).toEqual([]);
  expect(report.results.every((result) => result.hardGate === "pass" || result.status === "omitted")).toBe(true);
});
```

- [ ] **Step 3: Implement evaluator and thresholds**

Measure schema validity, evidence recall/precision, hard-gate outcomes, accessibility projection completeness, deterministic replay, screenshot pixel variance, deep-dive target validity, p50/p95 generation-to-first-render latency, worker cancellation latency, and JS/Three.js chunk sizes. Include an expert-labelled decision set with necessary-generation recall at least 85% and unnecessary-generation rate at most 5%, so the planner cannot pass by always omitting visuals. Set initial gates: hard-gate pass 100%, evidence binding 100% for factual objects, deterministic replay 100%, first render p95 under 1.5 seconds for local fixtures, and no initial Three.js chunk.

The evaluator also runs offline scenarios: cached ready artifacts remain readable with document access, new generation is omitted without a provider call, and reconnecting does not auto-submit the stale request. It exercises reduced-motion preferences for process renderers and marks revoked validator/renderer artifacts for revalidation before display.

- [ ] **Step 4: Add benchmark command and run it**

`node scripts/benchmark-visualization.mjs --fixtures src/tests/fixtures --out ../../../../development/test-data/visualization-benchmark.json` writes only generated test data, prints machine-readable JSON, and exits nonzero on a gate failure. Do not commit generated output.

- [ ] **Step 5: Commit**

```bash
git add products/liteasy/apps/desktop/src/tests/fixtures/multimodalEvaluationFixtures.ts products/liteasy/apps/desktop/src/tests/multimodalEvaluation.test.ts products/liteasy/apps/desktop/scripts/benchmark-visualization.mjs products/liteasy/apps/desktop/src/tests/visualizationPerformance.test.ts
git commit -m "test: add multimodal evaluation gates"
```

### Task 6: Final Release Gate And Provider Smoke Verification

**Files:**
- Create: `products/liteasy/apps/desktop/src/tests/multimodalReleaseGate.test.ts`
- Create: `products/liteasy/services/api/src/visualizationProviderSmoke.test.mjs`
- Modify: `products/liteasy/apps/desktop/package.json`
- Modify: `products/liteasy/services/api/package.json`
- Modify: `docs/superpowers/plans/2026-08-09-thin-reading-multimodal-implementation-index.md`

**Interfaces:**
- Consumes: plans 01–05 registries, control-plane capability projection, reader integration, evaluation fixtures, and configured test provider route.
- Produces: a single fail-closed release command and a documented production-readiness decision without claiming external provider availability.

- [ ] **Step 1: Write the cross-modality release test**

```ts
test("requires every advertised modality to have the complete implementation chain", async () => {
  const report = await runReleaseGate({ includeBrowserPixels: true, includeBenchmarks: true });
  expect(report.advertisedMissingChain).toEqual([]);
  expect(report.readerOrder).toEqual(["visualization", "prose", "source_figures"]);
  expect(report.unauthorizedProjection.generatedEnabled).toBe(false);
});
```

- [ ] **Step 2: Run and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/multimodalReleaseGate.test.ts`

Expected: FAIL until all modality registrations, reader order, and capability projections are present.

- [ ] **Step 3: Implement release command and provider smoke test**

Add `npm run test:multimodal-release` to run focused unit tests, browser pixel tests, the benchmark script, the production build, offline/revalidation tests, reduced-motion checks, and cross-runtime catalog/compiler/desktop-chain consistency for every advertised modality. The API smoke test uses an administrator-provided test route only when `LITEASY_VISUALIZATION_SMOKE_ROUTE` is set; otherwise it reports `skipped_configuration` and does not fabricate a pass. It checks route revision, reservation/settlement/rollback, normalized structured/image output, redacted logs, cancellation, and idempotency.

- [ ] **Step 4: Document the gates and run the full affected suite**

Run:

```bash
cd products/liteasy/apps/desktop && npm test && npm run build && npm run test:multimodal-release
cd products/liteasy/services/api && npm test
```

Record only observed results in the implementation index. Keep provider smoke status separate from local fixture status and do not describe readiness as production acceptance until a deployment administrator supplies the route and reviews the audit output.

- [ ] **Step 5: Commit the release gate**

```bash
git add products/liteasy/apps/desktop/src/tests/multimodalReleaseGate.test.ts products/liteasy/services/api/src/visualizationProviderSmoke.test.mjs products/liteasy/apps/desktop/package.json products/liteasy/services/api/package.json docs/superpowers/plans/2026-08-09-thin-reading-multimodal-implementation-index.md
git commit -m "test: add multimodal release gate"
```
