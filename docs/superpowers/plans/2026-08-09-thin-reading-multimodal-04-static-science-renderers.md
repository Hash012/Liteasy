# Thin Reading Static Science Renderers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement production paths for semantic graphs, circuits and physics diagrams, and biology/neural structures with deterministic trusted renderers, domain validators, accessibility projections, and visual regression fixtures.

**Architecture:** Each modality owns a bounded kernel, a validator adapter, and a renderer that consumes only the parsed `VisualizationSpecV1`. The Liteasy API compiler is the authoritative publication boundary: it accepts only allowlisted structured proposals, runs server-side evidence and domain hard gates, and publishes the canonical artifact consumed by the desktop renderer. Desktop kernels repeat deterministic checks needed for rendering and revalidation but do not replace the server hard gates. SVG output is constructed through an internal escaped scene builder with stable IDs; React Flow and Canvas are projections of the same validated scene metadata, never alternate sources of scientific facts. The shared built-in catalog is the final release switch, and a modality is available only when the catalog, service compiler, and complete desktop chain agree.

**Tech Stack:** TypeScript 5.8, Zod 4, React 18, Fluent UI 9, SVG, Canvas 2D, Node.js 20, AJV 8, React Testing Library, Playwright, Vitest, Node test runner.

## Global Constraints

- Preserve `layout -> controllers -> features -> shared types / clients` and keep all modality code under `features/visualization/`.
- Treat `visualizationArtifact.types.ts`, `visualizationArtifact.schema.ts`, and the generated shared JSON Schema as the canonical v1 contract. Plan snippets are illustrative and must not introduce semantic-graph aliases such as `relation`, `factual`, a top-level `direction`, or `timeline` where the merged semantic-graph payload uses `kind`, `evidenceClaimIds`, `hierarchy`, and `timeOrder`.
- Models provide typed specs only; no SVG strings, HTML, scripts, event handlers, external URLs, or unbounded layout values enter a renderer.
- Every factual node, edge, component, vector, structure, and label has an evidence binding; layout-only relations are explicitly marked non-factual.
- Server compiler descriptors must run modality-specific hard validators before publication. Desktop-only validation is insufficient because the desktop consumes server-validated artifacts.
- Keep all generated static catalog entries disabled until Tasks 1-5 pass and Task 6 verifies the complete server/client chain. Merely registering a local Skill or renderer must not advertise the modality.
- Hard validator failure omits the artifact; advisory diagnostics never publish unsupported scientific claims.
- Rendering is deterministic for the same spec, kernel version, renderer version, and seed.
- Keep the user-facing surface minimal; implementation, ontology, validator, and source details belong to accessibility projections or admin diagnostics.

---

### Task 1: Shared Scene Builder And Stable Layout Utilities

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/rendering/scene.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/rendering/safeSvgScene.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/rendering/stableLayout.ts`
- Test: `products/liteasy/apps/desktop/src/tests/safeSvgScene.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/stableLayout.test.ts`

**Interfaces:**
- Consumes: `SemanticObjectV1`, normalized bounds, and renderer registrations from plan 01.
- Produces: `SvgSceneV1`, `SceneNodeV1`, `SceneEdgeV1`, `createSafeSvgScene()`, `layoutStableGraph()`.

- [ ] **Step 1: Write failing escaping and determinism tests**

```ts
test("escapes labels and rejects external resources", () => {
  const scene = createSafeSvgScene({
    width: 640,
    height: 360,
    nodes: [{ id: "n-1", label: "<script>alert(1)</script>", x: 20, y: 20, width: 120, height: 40 }],
    edges: []
  });
  expect(scene.svg).not.toContain("<script>");
  expect(scene.svg).not.toContain("href=");
});

test("layoutStableGraph returns byte-identical output for equal input", () => {
  const graph = { nodes: [{ id: "a" }, { id: "b" }], edges: [{ id: "e", from: "a", to: "b" }] };
  expect(layoutStableGraph(graph, "fixture-seed")).toEqual(layoutStableGraph(graph, "fixture-seed"));
});
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/safeSvgScene.test.ts src/tests/stableLayout.test.ts`

Expected: FAIL because the scene modules do not exist.

- [ ] **Step 3: Implement a bounded escaped scene model**

```ts
export type SceneNodeV1 = { id: string; label: string; x: number; y: number; width: number; height: number; role?: string };
export type SceneEdgeV1 = { id: string; from: string; to: string; label?: string; factual: boolean };
export type SvgSceneV1 = { width: number; height: number; nodes: SceneNodeV1[]; edges: SceneEdgeV1[]; svg: string };

export function createSafeSvgScene(input: Omit<SvgSceneV1, "svg">): SvgSceneV1 {
  if (input.width < 160 || input.width > 1600 || input.height < 120 || input.height > 1200) throw new Error("scene_size_invalid");
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  if (nodeIds.size !== input.nodes.length || input.edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) throw new Error("scene_reference_invalid");
  const escaped = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  const svg = `<svg viewBox="0 0 ${input.width} ${input.height}" role="img">${input.edges.map((edge) => `<path id="edge-${escaped(edge.id)}" d="M0 0"/>`).join("")}${input.nodes.map((node) => `<g id="object-${escaped(node.id)}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/><text>${escaped(node.label)}</text></g>`).join("")}</svg>`;
  return { ...input, svg };
}
```

Use numeric bounds, allowlisted attributes, no XML declarations, no stylesheets, no fragments, no event attributes, and stable object IDs. `layoutStableGraph` uses seeded ordering plus deterministic topological layering and returns diagnostics when a graph cannot be laid out without overlap.

- [ ] **Step 4: Run tests and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/safeSvgScene.test.ts src/tests/stableLayout.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/rendering products/liteasy/apps/desktop/src/tests/safeSvgScene.test.ts products/liteasy/apps/desktop/src/tests/stableLayout.test.ts
git commit -m "feat: add safe deterministic science scenes"
```

### Task 2: Semantic Graph Kernel And Renderer

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/kernels/semanticGraphKernel.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/semanticGraphRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/semantic-graph/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/semantic-graph/instructions.md`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/semantic-graph/fixtures/flowchart.json`
- Test: `products/liteasy/apps/desktop/src/tests/semanticGraphKernel.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/semanticGraphRenderer.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/browser/semanticGraph.browser.spec.ts`

**Interfaces:**
- Consumes: `SemanticGraphSpecV1`, evidence bindings, `createSafeSvgScene`, and the renderer registry.
- Produces: `validateSemanticGraph()`, `renderSemanticGraph()`, and `semantic-graph` built-in Skill registration covering `flowchart`, `mindmap`, `causal_graph`, and `timeline`.

- [ ] **Step 1: Add an invalid-cycle fixture and renderer smoke test**

```ts
const validFlowchartFixture = {
  subtype: "flowchart",
  nodes: [
    { id: "start", label: "输入", kind: "step", objectPath: ["start"], evidenceClaimIds: ["claim-1"] },
    { id: "end", label: "输出", kind: "step", objectPath: ["end"], evidenceClaimIds: ["claim-1"] }
  ],
  edges: [{ id: "edge-1", from: "start", to: "end", kind: "precedes", evidenceClaimIds: ["claim-1"] }],
  groups: [], hierarchy: [], timeOrder: [],
  claims: [{ id: "claim-1", text: "输入先于输出", evidenceIds: ["evidence-1"] }]
} as const satisfies SemanticGraphSpecV1;
test("rejects a cycle in a flowchart", () => expect(() => validateSemanticGraph({
  ...validFlowchartFixture,
  edges: [
    { id: "e1", from: "start", to: "end", kind: "precedes", evidenceClaimIds: ["claim-1"] },
    { id: "e2", from: "end", to: "start", kind: "precedes", evidenceClaimIds: ["claim-1"] }
  ]
})).toThrow("semantic_graph_cycle"));
test("renders selectable objects with accessible reading order", () => { const artifact = renderSemanticGraph(validFlowchartFixture, { evidenceBindings: [], semanticObjects: [] }); expect(artifact.svg).toContain('role="img"'); expect(artifact.selectableObjectIds).toEqual(["start", "end"]); });
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/semanticGraphKernel.test.ts src/tests/semanticGraphRenderer.test.tsx`

Expected: FAIL because the kernel and renderer do not exist.

- [ ] **Step 3: Implement graph invariants and stable layout**

Enforce unique IDs, bounded node/edge/group counts, valid endpoints, subtype-specific rules (tree for mindmap, DAG for flowchart/causal graph, and an exact `timeOrder` permutation for timelines), and factual edges with at least one claim binding. Return a normalized scene with semantic object paths and collision diagnostics; organization edges use `kind: "layout"` and must not carry unsupported factual claims.

- [ ] **Step 4: Implement trusted SVG plus observation-only React interactions**

Render through `createSafeSvgScene`; expose keyboard and pointer selection, zoom, pan, collapse, focus, and highlight. Selection emits `DeepDiveTargetV1` with the original object ID and evidence claims. Do not permit node dragging or label editing. Add `aria-label`, `aria-describedby`, focus rings, and a deterministic text projection for screen readers.

- [ ] **Step 5: Register the Skill and run browser pixels**

Register the manifest with `rendererId: "semantic-graph-svg"`, `kernelId: "semantic-graph/v1"`, evidence validators, and fallback to `source_figure`. Playwright captures 1280x800 and 390x844 fixtures, asserts no blank SVG pixels, fixed dimensions, selectable nodes, and identical screenshots across two renders.

- [ ] **Step 6: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/kernels/semanticGraphKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/semanticGraphRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/semantic-graph products/liteasy/apps/desktop/src/tests/semanticGraphKernel.test.ts products/liteasy/apps/desktop/src/tests/semanticGraphRenderer.test.tsx products/liteasy/apps/desktop/src/tests/browser/semanticGraph.browser.spec.ts
git commit -m "feat: render evidence-bound semantic graphs"
```

### Task 3: Circuit And Physics Diagram Kernels

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/kernels/circuitKernel.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/kernels/physicsDiagramKernel.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/circuitRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/physicsDiagramRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/circuit/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/circuit/instructions.md`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/physics-diagram/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/physics-diagram/instructions.md`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/circuit/fixtures/ohms-law.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/physics-diagram/fixtures/projectile.json`
- Test: `products/liteasy/apps/desktop/src/tests/circuitKernel.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/physicsDiagramKernel.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/circuitRenderer.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/browser/scienceDiagram.browser.spec.ts`

**Interfaces:**
- Consumes: `CircuitSpecV1`, `PhysicsDiagramSpecV1`, scene builder, evidence validator registry.
- Produces: `validateCircuit()`, `validatePhysicsDiagram()`, `renderCircuit()`, `renderPhysicsDiagram()`.

- [ ] **Step 1: Write failing domain tests**

```ts
test("rejects a wire connected to a nonexistent port", () => expect(() => validateCircuit(ohmsLawFixture({ wire: { from: "missing", to: "r1.in" } }))).toThrow("circuit_port_unknown"));
test("checks KCL only when the spec supplies compatible current values", () => expect(validateCircuit(ohmsLawFixture({ currents: [{ nodeId: "junction", values: [2, 1, 1] }] })).invariants.kcl).toBe("pass"));
test("rejects a physics vector with incompatible dimensions", () => expect(() => validatePhysicsDiagram(projectileFixture({ vectorUnit: "kg" }))).toThrow("physics_dimension_mismatch"));
```

Define `ohmsLawFixture(overrides = {})` and `projectileFixture(overrides = {})` in `src/tests/fixtures/staticScienceFixtures.ts`; each returns a complete `CircuitSpecV1` or `PhysicsDiagramSpecV1` with evidence IDs.

- [ ] **Step 2: Run tests and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/circuitKernel.test.ts src/tests/physicsDiagramKernel.test.ts`

Expected: FAIL because kernels do not exist.

- [ ] **Step 3: Implement bounded topology, dimensions, and constraint checks**

Validate component/port uniqueness, wire endpoints, connected networks, optional KCL/KVL equations, finite values, SI unit dimensions, vector directions, optical rays, and geometric constraints. Report `not_applicable` when a law cannot be checked from supplied evidence; never infer missing parameters.

- [ ] **Step 4: Implement controlled symbols and selection**

Use an allowlisted symbol map for resistors, sources, switches, masses, forces, rays, and measurement points. Render labels as escaped text and vectors as marker-free paths or a fixed marker set. Map component/vector IDs to `DeepDiveTargetV1`; support highlight, pan, zoom, and keyboard focus only.

- [ ] **Step 5: Run visual fixtures and commit**

Playwright asserts circuit ports align with wires, vector arrowheads remain inside bounds, mobile layout remains readable, and the rendered SVG contains no scripts, external references, or duplicate IDs.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/kernels/circuitKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/kernels/physicsDiagramKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/circuitRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/renderers/physicsDiagramRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/circuit products/liteasy/apps/desktop/src/app/features/visualization/skills/physics-diagram products/liteasy/apps/desktop/src/tests/circuitKernel.test.ts products/liteasy/apps/desktop/src/tests/physicsDiagramKernel.test.ts products/liteasy/apps/desktop/src/tests/circuitRenderer.test.tsx products/liteasy/apps/desktop/src/tests/browser/scienceDiagram.browser.spec.ts products/liteasy/apps/desktop/src/tests/fixtures/staticScienceFixtures.ts
git commit -m "feat: add circuit and physics diagrams"
```

### Task 4: Biology And Neural Structure Renderer

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/kernels/biologyStructureKernel.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/renderers/biologyStructureRenderer.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/biology-structure/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/biology-structure/instructions.md`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/biology-structure/fixtures/neural-connection.json`
- Test: `products/liteasy/apps/desktop/src/tests/biologyStructureKernel.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/biologyStructureRenderer.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/browser/biologyStructure.browser.spec.ts`

**Interfaces:**
- Consumes: `BiologyStructureSpecV1`, versioned built-in ontology entries, evidence bindings, and safe scene builder.
- Produces: `validateBiologyStructure()`, `renderBiologyStructure()` with selectable structures, regions, and neural connections.

- [ ] **Step 1: Write failing evidence and topology tests**

```ts
test("rejects an unknown controlled-ontology ID", () => expect(() => validateBiologyStructure(neuralFixture({ ontologyId: "unimplemented:cell-x" }))).toThrow("biology_ontology_unknown"));
test("requires evidence for each neural connection endpoint", () => expect(() => validateBiologyStructure(neuralFixture({ connections: [{ id: "c1", from: "unknown", to: "axon", evidenceClaimIds: [] }] })).toThrow("biology_connection_unbound"));
```

Define `neuralFixture(overrides = {})` in `staticScienceFixtures.ts` with a small offline ontology (`neuron`, `soma`, `axon`, `synapse`) and direct/derived evidence examples.

- [ ] **Step 2: Run tests and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/biologyStructureKernel.test.ts src/tests/biologyStructureRenderer.test.tsx`

Expected: FAIL because the biology modules do not exist.

- [ ] **Step 3: Implement offline ontology, structure bounds, and connection invariants**

Require known ontology IDs, unique parent paths, valid connection endpoints, direction labels where supplied, and a hard evidence binding for every factual relation. Evidence confidence is read from the artifact's `EvidenceBindingV1`, not invented as an extra biology-spec field. Reject unsupported fine-grained reconstruction instead of guessing it.

- [ ] **Step 4: Implement layered SVG/Canvas projection and accessibility**

Render structures and connections in deterministic layers; use Canvas only when the validated object count exceeds the SVG threshold, while retaining an SVG/text accessibility projection. Provide focusable objects, `aria-label`, reading order, visibility toggles, connection highlighting, and deep-dive events.

- [ ] **Step 5: Run visual tests and commit**

Playwright verifies neural labels remain legible on mobile, selected connections have a non-color cue, SVG and Canvas projections expose the same object IDs, and repeated rendering has identical scene metadata.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/kernels/biologyStructureKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/biologyStructureRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/biology-structure products/liteasy/apps/desktop/src/tests/biologyStructureKernel.test.ts products/liteasy/apps/desktop/src/tests/biologyStructureRenderer.test.tsx products/liteasy/apps/desktop/src/tests/browser/biologyStructure.browser.spec.ts products/liteasy/apps/desktop/src/tests/fixtures/staticScienceFixtures.ts
git commit -m "feat: render evidence-bound biology structures"
```

### Task 5: Authoritative Static Science Compilers

**Files:**
- Create: `development/test-data/thin-reading-multimodal/static-science-conformance.v1.json`
- Create: `products/liteasy/services/api/src/staticScienceVisualizationCompilers.mjs`
- Create: `products/liteasy/services/api/src/staticScienceVisualizationCompilers.test.mjs`
- Modify: `products/liteasy/services/api/src/runtime.mjs`
- Modify: `products/liteasy/services/api/src/runtime.test.mjs`

**Interfaces:**
- Consumes: the canonical shared artifact JSON Schema, the four Skill implementation IDs from Tasks 2-4, structured provider proposals, and the immutable `VisualizationArtifactCompilerRegistry` from Phase 3.
- Produces: `productionStaticScienceVisualizationCompilers`, strict proposal schemas, and authoritative server hard validators for `semantic_graph`, `circuit`, `physics_diagram`, and `biology_structure`.

- [ ] **Step 1: Add cross-runtime conformance fixtures and failing compiler tests**

The versioned conformance fixture contains, for every static modality, one valid proposal and focused invalid proposals for schema drift, missing evidence, unsupported references, topology/domain failure, and resource overflow. Desktop kernel tests and API compiler tests must read the same fixture and agree on pass/fail plus the stable diagnostic code.

```js
test("rejects a schema-valid proposal that fails a static domain hard gate", async () => {
  const registry = staticScienceRegistry();
  await assert.rejects(
    () => registry.compile(semanticGraphCycleInput),
    /visualization_hard_validation_failed/
  );
});

test("provides a production compiler for every static catalog candidate", () => {
  assert.deepEqual(
    Object.keys(productionStaticScienceVisualizationCompilers).sort(),
    ["biology_structure", "circuit", "physics_diagram", "semantic_graph"]
  );
});
```

- [ ] **Step 2: Run the service tests and verify red**

Run: `cd products/liteasy/services/api && node --test src/staticScienceVisualizationCompilers.test.mjs src/runtime.test.mjs`

Expected: FAIL because production descriptors and runtime wiring do not exist.

- [ ] **Step 3: Implement strict descriptors and server hard validators**

Each immutable descriptor supplies the exact Skill/Kernel/Renderer versions, a closed proposal schema derived from the canonical v1 contract, and at least one modality-specific hard validator. The validators independently enforce the evidence and domain invariants from Tasks 2-4; they must not trust desktop validation or provider-supplied validation reports. `runtime.mjs` passes `productionStaticScienceVisualizationCompilers` by default while preserving explicit dependency injection in tests.

The production shared catalog remains unchanged in this task, so descriptors can be tested with an explicit test catalog without advertising a generated modality. A hard-gate failure rolls back the reservation and publishes no artifact; the existing reader source-figure lane remains the safe fallback. Tests must prove the failure does not create a ready artifact or a second provider charge.

- [ ] **Step 4: Run focused API and desktop conformance tests**

Run:

```bash
cd products/liteasy/services/api && node --test src/staticScienceVisualizationCompilers.test.mjs src/visualizationArtifactCompiler.test.mjs src/runtime.test.mjs
cd products/liteasy/apps/desktop && npm test -- src/tests/semanticGraphKernel.test.ts src/tests/circuitKernel.test.ts src/tests/physicsDiagramKernel.test.ts src/tests/biologyStructureKernel.test.ts
```

Expected: PASS with identical fixture decisions across runtimes and no generated modality advertised by the production catalog.

- [ ] **Step 5: Commit**

```bash
git add development/test-data/thin-reading-multimodal/static-science-conformance.v1.json products/liteasy/services/api/src/staticScienceVisualizationCompilers.mjs products/liteasy/services/api/src/staticScienceVisualizationCompilers.test.mjs products/liteasy/services/api/src/runtime.mjs products/liteasy/services/api/src/runtime.test.mjs
git commit -m "feat: validate static science artifacts on server"
```

### Task 6: Catalog Registration And Cross-Runtime Release Gate

**Files:**
- Modify: `products/liteasy/packages/shared/visualizationBuiltins.v1.json`
- Modify: `products/liteasy/apps/desktop/src/app/features/skills/builtinSkillRegistry.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationRendererRegistry.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationValidatorRegistry.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/builtinSkillRegistry.test.ts`
- Create: `products/liteasy/apps/desktop/src/tests/staticScienceFallback.test.ts`
- Create: `products/liteasy/apps/desktop/src/tests/staticScienceReleaseGate.test.ts`
- Create: `products/liteasy/services/api/src/staticScienceReleaseGate.test.mjs`

**Interfaces:**
- Consumes: all four Skill packages, kernels, renderers, validators, browser fixtures, server compiler descriptors, and the shared built-in catalog.
- Produces: fail-closed availability for `semantic_graph`, `circuit`, `physics_diagram`, and `biology_structure`, with exact agreement between the enabled catalog, server compiler registry, and complete desktop implementation chain.

- [ ] **Step 1: Write fail-closed availability tests before changing the catalog**

```ts
test("does not advertise a locally complete modality while its catalog entry is disabled", () => {
  expect(getAvailableVisualizationModalities()).not.toContain("semantic_graph");
  expect(getUnavailableReasons().semantic_graph).toBe("catalog_disabled");
});

test("advertises every enabled static modality only with its complete chain", () => {
  expect(getAvailableVisualizationModalities()).toEqual(
    expect.arrayContaining(["semantic_graph", "circuit", "physics_diagram", "biology_structure"])
  );
  expect(getUnavailableReasons()).not.toHaveProperty("semantic_graph");
});
```

The API release test loads the same production catalog and asserts that every `enabled && generated` static entry has a compiler descriptor with matching `skillId`, implementation versions, proposal schema, and hard validators. It also asserts that no service compiler or locally registered renderer can make a catalog-disabled modality available.

`staticScienceFallback.test.ts` runs each Skill's declared `source_figure` fallback through the existing workflow harness. It proves that an invalid generated proposal cannot be published, the fallback carries only source-bound claims, and a missing or invalid source figure ends as omitted rather than displaying a partial generated artifact.

- [ ] **Step 2: Make desktop availability catalog-aware and wire lazy registrations**

Register all four Skill manifests, kernels, hard validators, and lazy renderer loaders. `getAvailableVisualizationModalities()` returns only the intersection of enabled catalog entries and complete local chains. `getUnavailableReasons()` reports stable internal reason codes for missing catalog, Skill, kernel, validator, renderer, fixture, or runtime support; these codes are diagnostics and not permanent user-facing copy.

Add the four generated entries to the shared catalog with `enabled: false` first. Run the component, conformance, fallback, accessibility, and browser visual tests from Tasks 1-5. Only after they pass may the same focused change flip those four entries to `enabled: true`.

- [ ] **Step 3: Run the static release gates**

Run:

```bash
cd products/liteasy/services/api && node --test src/staticScienceVisualizationCompilers.test.mjs src/staticScienceReleaseGate.test.mjs src/visualizationArtifactCompiler.test.mjs src/runtime.test.mjs
cd products/liteasy/apps/desktop && npm test -- src/tests/builtinSkillRegistry.test.ts src/tests/staticScienceFallback.test.ts src/tests/staticScienceReleaseGate.test.ts src/tests/safeSvgScene.test.ts src/tests/stableLayout.test.ts src/tests/semanticGraphKernel.test.ts src/tests/semanticGraphRenderer.test.tsx src/tests/circuitKernel.test.ts src/tests/physicsDiagramKernel.test.ts src/tests/circuitRenderer.test.tsx src/tests/biologyStructureKernel.test.ts src/tests/biologyStructureRenderer.test.tsx
npx playwright test src/tests/browser/semanticGraph.browser.spec.ts src/tests/browser/scienceDiagram.browser.spec.ts src/tests/browser/biologyStructure.browser.spec.ts
npm run build
```

Expected: all checks pass; the server and desktop advertise exactly the four enabled static modalities; repeated desktop/mobile renders are nonblank and deterministic; source-figure fallback fixtures pass; no catalog-disabled modality appears.

- [ ] **Step 4: Commit**

```bash
git add products/liteasy/packages/shared/visualizationBuiltins.v1.json products/liteasy/apps/desktop/src/app/features/skills/builtinSkillRegistry.ts products/liteasy/apps/desktop/src/app/features/visualization/visualizationRendererRegistry.ts products/liteasy/apps/desktop/src/app/features/visualization/visualizationValidatorRegistry.ts products/liteasy/apps/desktop/src/tests/builtinSkillRegistry.test.ts products/liteasy/apps/desktop/src/tests/staticScienceFallback.test.ts products/liteasy/apps/desktop/src/tests/staticScienceReleaseGate.test.ts products/liteasy/services/api/src/staticScienceReleaseGate.test.mjs
git commit -m "feat: enable verified static science modalities"
```
