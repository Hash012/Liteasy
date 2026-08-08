# Thin Reading Interactive Mathematics Renderers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement safe, reproducible function plots, interactive 2D geometry, and lazy-loaded 3D geometry with bounded kernels, worker isolation, keyboard-accessible controls, and browser pixel checks.

**Architecture:** Mathematical content is parsed into an allowlisted expression/geometry AST and evaluated by deterministic kernels with explicit domains, sample limits, and cancellation. SVG/Canvas renderers consume normalized kernel output. Three.js is loaded only after a validated 3D artifact is visible and remains isolated from the initial desktop bundle; unsupported or numerically unstable cases fall back to a static 2D projection or formula/table.

**Tech Stack:** TypeScript 5.8, Chevrotain (existing parser), KaTeX, SVG/Canvas, Three.js as a lazy dependency, Web Workers, Vitest, React Testing Library, Playwright.

## Global Constraints

- Never use `eval`, `new Function`, generated scripts, shader strings, remote resources, or unbounded recursion.
- Every expression, point, constraint, parameter, and derived value has a stable ID and evidence relation where it is a claim from the source.
- Kernel limits are explicit: expression depth 32, AST nodes 128, 10,000 samples per curve, 120 animation frames, and a 2-second worker budget.
- A numerical result is labelled derived and is valid only within the declared model, domain, precision, and error bounds.
- Interactions are observation-only: pan, zoom, rotate, sliders, playback, visibility, highlighting, and selection; editing creates a new request.
- The UI remains minimal and does not expose parser, kernel, renderer, or numerical implementation terms.

---

### Task 1: Bounded Expression AST And Evaluator

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/math/expressionAst.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/math/expressionParser.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/math/boundedEvaluator.ts`
- Test: `products/liteasy/apps/desktop/src/tests/boundedExpressionEvaluator.test.ts`

**Interfaces:**
- Consumes: `FunctionPlotSpecV1` expression source and parameter bounds.
- Produces: `ExpressionAstV1`, `parseBoundedExpression()`, `evaluateBoundedExpression()`, and structured diagnostics.

- [ ] **Step 1: Write failing parser and security tests**

```ts
test("accepts allowlisted arithmetic and rejects executable syntax", () => {
  expect(parseBoundedExpression("sin(x) + x^2").kind).toBe("binary");
  expect(() => parseBoundedExpression("globalThis.alert(1)")).toThrow("expression_token_forbidden");
  expect(() => parseBoundedExpression("x".repeat(300))).toThrow("expression_limit_exceeded");
});

test("returns a bounded non-finite diagnostic at a pole", () => {
  const ast = parseBoundedExpression("1 / x");
  expect(evaluateBoundedExpression(ast, { x: 0 })).toMatchObject({ status: "non_finite" });
});
```

- [ ] **Step 2: Run focused test and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/boundedExpressionEvaluator.test.ts`

Expected: FAIL because the AST and evaluator do not exist.

- [ ] **Step 3: Implement the allowlist and exact limits**

Define literal, variable, unary, binary, function, and piecewise nodes. Permit `+ - * / ^`, `sin cos tan exp log sqrt abs`, and comparisons used by piecewise domains. Reject identifiers outside declared variables, implicit network access, strings, member access, assignment, and calls with more than two arguments. Count nodes/depth during parse and use `Math.fround` only when the spec requests single precision.

- [ ] **Step 4: Run tests and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/boundedExpressionEvaluator.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/math products/liteasy/apps/desktop/src/tests/boundedExpressionEvaluator.test.ts
git commit -m "feat: add bounded math expressions"
```

### Task 2: Function Plot Kernel And Renderer

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/kernels/functionPlotKernel.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/functionPlotRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/function-plot/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/function-plot/fixtures/quadratic.json`
- Test: `products/liteasy/apps/desktop/src/tests/functionPlotKernel.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/functionPlotRenderer.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/browser/functionPlot.browser.spec.ts`

**Interfaces:**
- Consumes: `FunctionPlotSpecV1`, bounded evaluator, evidence bindings, and safe scene builder from plan 04.
- Produces: `sampleFunctionPlot()`, `validateFunctionPlot()`, `renderFunctionPlot()`.

- [ ] **Step 1: Write failing sampling and singularity tests**

```ts
const quadraticFixture = {
  modality: "function_plot", expression: "x^2", variable: "x", domain: { min: -2, max: 2 },
  parameters: [], axes: { xLabel: "x", yLabel: "f(x)" }, keyPoints: [], auxiliaryCurves: []
} as const;
test("samples a bounded plot and marks derived points", () => { const result = sampleFunctionPlot(quadraticFixture); expect(result.points.length).toBeLessThanOrEqual(10000); expect(result.points[0]).toMatchObject({ derived: true }); });
test("splits a curve around a singularity", () => expect(sampleFunctionPlot({ ...quadraticFixture, expression: "1 / x", domain: { min: -1, max: 1 } }).segments).toHaveLength(2));
```

- [ ] **Step 2: Run test and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/functionPlotKernel.test.ts src/tests/functionPlotRenderer.test.tsx`

Expected: FAIL because the function plot kernel and renderer do not exist.

- [ ] **Step 3: Implement sampling, key-property checks, and limits**

Use adaptive subdivision capped at 10,000 points, stop on non-finite or discontinuous intervals, detect declared roots/extrema only by recomputation, and return warnings when a requested property cannot be proven. Validate finite domain bounds, parameter ranges, axis extents, and evidence IDs.

- [ ] **Step 4: Implement accessible interactive rendering**

Render SVG for small plots and Canvas for dense plots with a synchronized text/table projection. Provide zoom, pan, parameter sliders, tangent/key-point highlighting, keyboard focus, and object selection. Sliders clamp to spec ranges and emit a new explicit request only when the user asks to regenerate; they never mutate the artifact.

- [ ] **Step 5: Run browser checks and commit**

Playwright at 1280x800 and 390x844 checks nonblank pixels, axis labels within bounds, keyboard slider operation, no horizontal overflow, and deterministic screenshot output.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/kernels/functionPlotKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/functionPlotRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/function-plot products/liteasy/apps/desktop/src/tests/functionPlotKernel.test.ts products/liteasy/apps/desktop/src/tests/functionPlotRenderer.test.tsx products/liteasy/apps/desktop/src/tests/browser/functionPlot.browser.spec.ts
git commit -m "feat: add safe interactive function plots"
```

### Task 3: 2D Geometry Kernel And Renderer

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/kernels/geometry2dKernel.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/geometry2dRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/geometry-2d/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/geometry-2d/fixtures/circle-tangent.json`
- Test: `products/liteasy/apps/desktop/src/tests/geometry2dKernel.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/geometry2dRenderer.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/browser/geometry2d.browser.spec.ts`

**Interfaces:**
- Consumes: `Geometry2DSpecV1`, bounded numeric primitives, evidence bindings, and stable scene builder.
- Produces: `solveGeometry2D()`, `validateGeometry2D()`, `renderGeometry2D()`.

- [ ] **Step 1: Write failing constraint tests**

```ts
const tangentFixture = { modality: "geometry_2d", objects: [{ id: "c", kind: "circle", center: [0, 0], radius: 1 }, { id: "l", kind: "line", through: [[-1, 1], [1, 1]] }], constraints: [{ id: "t", kind: "tangent", a: "c", b: "l" }], viewport: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 } } as const;
test("solves a tangent point deterministically", () => expect(solveGeometry2D(tangentFixture).derivedPoints).toEqual([{ id: "tangent-point", x: 0, y: 1 }]));
test("rejects a degenerate circle", () => expect(() => validateGeometry2D({ ...tangentFixture, objects: [{ ...tangentFixture.objects[0], radius: 0 }] })).toThrow("geometry_radius_invalid"));
```

- [ ] **Step 2: Run test and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/geometry2dKernel.test.ts src/tests/geometry2dRenderer.test.tsx`

Expected: FAIL because the geometry modules do not exist.

- [ ] **Step 3: Implement deterministic geometry solving**

Support points, segments, lines, circles, arcs, polygons, intersections, parallel/perpendicular, midpoint, tangent, and bounded curve sampling. Use epsilon declared by the spec, reject NaN/infinite/degenerate primitives, and tag all computed values as derived.

- [ ] **Step 4: Render interactions and accessibility**

Render fixed-size SVG with coordinate grid, labels, selected-object outlines, zoom/pan, construction visibility, and keyboard object traversal. Provide a concise summary and data table projection generated from validated objects and derived points.

- [ ] **Step 5: Run visual tests and commit**

Browser tests assert tangent alignment, pointer and keyboard selection, stable aspect ratio, no viewport overflow, and a nonblank canvas/SVG at desktop and mobile sizes.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/kernels/geometry2dKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/geometry2dRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/geometry-2d products/liteasy/apps/desktop/src/tests/geometry2dKernel.test.ts products/liteasy/apps/desktop/src/tests/geometry2dRenderer.test.tsx products/liteasy/apps/desktop/src/tests/browser/geometry2d.browser.spec.ts
git commit -m "feat: add interactive plane geometry"
```

### Task 4: Lazy 3D Geometry Worker And Renderer

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/kernels/geometry3dKernel.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/workers/geometry3d.worker.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/geometry3dRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/geometry-3d/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/geometry-3d/fixtures/cube-section.json`
- Modify: `products/liteasy/apps/desktop/package.json`
- Test: `products/liteasy/apps/desktop/src/tests/geometry3dKernel.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/geometry3dWorker.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/browser/geometry3d.browser.spec.ts`

**Interfaces:**
- Consumes: `Geometry3DSpecV1`, vector/matrix helpers, `AbortSignal`, and lazy renderer registry.
- Produces: `solveGeometry3D()`, worker message protocol `{ requestId, spec } -> { requestId, result | diagnostic }`, `renderGeometry3D()`.

- [ ] **Step 1: Write failing 3D and worker tests**

```ts
test("computes a cube-plane section without degenerate faces", () => expect(solveGeometry3D(cubeSectionFixture).sections[0].vertices.length).toBe(6));
test("cancels a stale worker request", async () => { const controller = new AbortController(); const pending = runGeometry3DWorker(cubeSectionFixture, controller.signal); controller.abort(); await expect(pending).rejects.toThrow("geometry_worker_cancelled"); });
```

Define `cubeSectionFixture` in `src/tests/fixtures/interactiveMathFixtures.ts` as a unit cube with a bounded diagonal cutting plane and explicit camera limits.

- [ ] **Step 2: Run tests and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/geometry3dKernel.test.ts src/tests/geometry3dWorker.test.ts`

Expected: FAIL because the 3D kernel and worker do not exist.

- [ ] **Step 3: Implement bounded vector/matrix and mesh checks**

Support points, lines, planes, prisms, cylinders, meshes, intersections, projections, sections, normals, and camera hints. Reject non-manifold meshes, zero-area faces, non-finite coordinates, and more than 50,000 vertices. Return a deterministic 2D multi-view projection for fallback.

- [ ] **Step 4: Isolate execution and load Three.js lazily**

The worker owns numeric solving and enforces a 2-second deadline plus cancellation. `geometry3dRenderer.tsx` dynamically imports Three.js only after the artifact is selected for display; model data cannot supply shaders, URLs, or event handlers. Pointer rotation, zoom, pan, section slider, visibility, and keyboard focus operate on a read-only scene.

- [ ] **Step 5: Run WebGL pixel checks and commit**

Playwright asserts the canvas has nonzero pixel variance, camera framing contains the whole fixture, section slider updates the scene, mobile controls do not overlap, and the first-load bundle has no Three.js module before a 3D artifact is opened.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/kernels/geometry3dKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/workers/geometry3d.worker.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/geometry3dRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/geometry-3d products/liteasy/apps/desktop/package.json products/liteasy/apps/desktop/src/tests/geometry3dKernel.test.ts products/liteasy/apps/desktop/src/tests/geometry3dWorker.test.ts products/liteasy/apps/desktop/src/tests/browser/geometry3d.browser.spec.ts products/liteasy/apps/desktop/src/tests/fixtures/interactiveMathFixtures.ts
git commit -m "feat: add lazy interactive 3d geometry"
```

### Task 5: Math Modality Availability Gate

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationRendererRegistry.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationValidatorRegistry.ts`
- Create: `products/liteasy/apps/desktop/src/tests/interactiveMathReleaseGate.test.ts`

**Interfaces:**
- Consumes: function plot, geometry 2D, and geometry 3D registrations.
- Produces: complete availability projection with explicit unavailability reasons for failed worker, WebGL, validator, or fixture checks.

- [ ] **Step 1: Write the release gate test**

```ts
test("does not advertise 3d when WebGL or worker health is unavailable", () => {
  expect(getAvailableVisualizationModalities({ webgl: false, worker: true })).not.toContain("geometry_3d");
  expect(getUnavailableReasons({ webgl: false }).geometry_3d).toBe("runtime_unavailable");
});
```

- [ ] **Step 2: Run, wire, and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/interactiveMathReleaseGate.test.ts`

Expected: PASS with fail-closed math capability projection.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/visualizationRendererRegistry.ts products/liteasy/apps/desktop/src/app/features/visualization/visualizationValidatorRegistry.ts products/liteasy/apps/desktop/src/tests/interactiveMathReleaseGate.test.ts
git commit -m "feat: gate interactive math capabilities"
```
