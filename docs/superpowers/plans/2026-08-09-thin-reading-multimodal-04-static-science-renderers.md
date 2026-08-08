# Thin Reading Static Science Renderers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement production paths for semantic graphs, circuits and physics diagrams, and biology/neural structures with deterministic trusted renderers, domain validators, accessibility projections, and visual regression fixtures.

**Architecture:** Each modality owns a bounded kernel, a validator adapter, and a renderer that consumes only the parsed `VisualizationSpecV1`. The shared visualization runtime performs evidence and safety gates before a renderer is loaded. SVG output is constructed through an internal escaped scene builder with stable IDs; React Flow and Canvas are projections of the same validated scene metadata, never alternate sources of scientific facts.

**Tech Stack:** TypeScript 5.8, Zod 4, React 18, Fluent UI 9, SVG, Canvas 2D, React Testing Library, Playwright, Vitest.

## Global Constraints

- Preserve `layout -> controllers -> features -> shared types / clients` and keep all modality code under `features/visualization/`.
- Models provide typed specs only; no SVG strings, HTML, scripts, event handlers, external URLs, or unbounded layout values enter a renderer.
- Every factual node, edge, component, vector, structure, and label has an evidence binding; layout-only relations are explicitly marked non-factual.
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

Use numeric bounds, allowlisted attributes, no XML declarations, no stylesheets, no fragments, no event attributes, and stable object IDs. `stableLayoutGraph` uses seeded ordering plus deterministic topological layering and returns diagnostics when a graph cannot be laid out without overlap.

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
  modality: "semantic_graph", subtype: "flowchart", direction: "down",
  nodes: [{ id: "start", label: "输入", kind: "step" }, { id: "end", label: "输出", kind: "step" }],
  edges: [{ id: "edge-1", from: "start", to: "end", relation: "sequence", factual: true }],
  groups: [], timeline: []
} as const;
test("rejects a cycle in a flowchart", () => expect(() => validateSemanticGraph({ ...validFlowchartFixture, edges: [{ id: "e1", from: "start", to: "end", relation: "sequence", factual: true }, { id: "e2", from: "end", to: "start", relation: "sequence", factual: true }] })).toThrow("semantic_graph_cycle"));
test("renders selectable objects with accessible reading order", () => { const artifact = renderSemanticGraph(validFlowchartFixture, { evidenceBindings: [], semanticObjects: [] }); expect(artifact.svg).toContain('role="img"'); expect(artifact.selectableObjectIds).toEqual(["start", "end"]); });
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/semanticGraphKernel.test.ts src/tests/semanticGraphRenderer.test.tsx`

Expected: FAIL because the kernel and renderer do not exist.

- [ ] **Step 3: Implement graph invariants and stable layout**

Enforce unique IDs, bounded node/edge/group counts, valid endpoints, subtype-specific rules (tree for mindmap, DAG for flowchart/causal graph, monotonic timestamps for timeline), and factual edges with at least one claim binding. Return a normalized scene with semantic object paths and collision diagnostics; organization edges must have `factual: false`.

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
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/physics-diagram/skill.json`
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

Require known ontology IDs, unique parent paths, valid connection endpoints, direction labels where supplied, confidence values, and a hard evidence binding for every factual relation. Reject unsupported fine-grained reconstruction instead of guessing it.

- [ ] **Step 4: Implement layered SVG/Canvas projection and accessibility**

Render structures and connections in deterministic layers; use Canvas only when the validated object count exceeds the SVG threshold, while retaining an SVG/text accessibility projection. Provide focusable objects, `aria-label`, reading order, visibility toggles, connection highlighting, and deep-dive events.

- [ ] **Step 5: Run visual tests and commit**

Playwright verifies neural labels remain legible on mobile, selected connections have a non-color cue, SVG and Canvas projections expose the same object IDs, and repeated rendering has identical scene metadata.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/kernels/biologyStructureKernel.ts products/liteasy/apps/desktop/src/app/features/visualization/renderers/biologyStructureRenderer.tsx products/liteasy/apps/desktop/src/app/features/visualization/skills/biology-structure products/liteasy/apps/desktop/src/tests/biologyStructureKernel.test.ts products/liteasy/apps/desktop/src/tests/biologyStructureRenderer.test.tsx products/liteasy/apps/desktop/src/tests/browser/biologyStructure.browser.spec.ts products/liteasy/apps/desktop/src/tests/fixtures/staticScienceFixtures.ts
git commit -m "feat: render evidence-bound biology structures"
```

### Task 5: Static Renderer Registration And Cross-Modality Gate

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationRendererRegistry.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationValidatorRegistry.ts`
- Create: `products/liteasy/apps/desktop/src/tests/staticScienceReleaseGate.test.ts`

**Interfaces:**
- Consumes: all four kernels/renderers and Skill manifests from Tasks 2–4.
- Produces: complete availability for `semantic_graph`, `circuit`, `physics_diagram`, and `biology_structure` only when every chain element is registered.

- [ ] **Step 1: Write the registration gate test**

```ts
test("advertises only modalities with skill, kernel, validators, renderer, and fixture", () => {
  expect(getAvailableVisualizationModalities()).toEqual(expect.arrayContaining(["semantic_graph", "circuit", "physics_diagram", "biology_structure"]));
  expect(getUnavailableReasons()).not.toHaveProperty("semantic_graph");
});
```

- [ ] **Step 2: Run red, wire registrations, then verify**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/staticScienceReleaseGate.test.ts`

Expected initially FAIL, then PASS after registrations are loaded from built-in manifests and all hard validators are present.

- [ ] **Step 3: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/visualizationRendererRegistry.ts products/liteasy/apps/desktop/src/app/features/visualization/visualizationValidatorRegistry.ts products/liteasy/apps/desktop/src/tests/staticScienceReleaseGate.test.ts
git commit -m "feat: enable static science modalities"
```
