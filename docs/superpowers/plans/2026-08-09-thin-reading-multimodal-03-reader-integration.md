# Thin Reading V2 Reader Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate governed visualization artifacts and selectable source figures into thin-reading v2 with the fixed visual order, persisted user toggle, cancellation, and recursive deep dive.

**Architecture:** ThinReadingAgent emits prose/evidence plus a compact intent, never Mermaid or HTML. A controller submits eligible intents to the control plane without blocking prose persistence. Focused components render a top visualization region, the existing reading body, then a bottom source-figure region; all deep-dive targets reuse the existing branch-generation path.

**Tech Stack:** React 18, TypeScript, Fluent UI 9, existing Agent API/artifact stores, Zod, Vitest, Testing Library, Playwright.

## Global Constraints

- New nodes use `liteasy.thin-reading/v2`; v1 remains read-only and is never changed in place.
- Generated artifact count: automatic 1, explicit request 2; source figures 2.
- Layout order is always generated visualization, prose, source figures.
- Turning generation off cancels uncommitted tasks and never hides ready history.
- Missing/invalid capability fails closed for generation but does not hide source figures.
- User interface is minimal: icon/switch, short state, `生成`, `论文原图`, and on-demand short reasons.
- Source-figure whole-image and normalized rectangular-region selection must work with keyboard equivalents.
- Existing user edits in `thinReadingAgent.ts`, `thinReading.types.ts`, `thinReadingProjection.ts`, `ThinReadingTab.tsx`, CSS, and tests must be merged, not overwritten.

---

### Task 1: Thin-Reading V2 Contract And Read-Only V1 Compatibility

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingVersioning.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingProjection.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/artifactLocalRepository.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/artifactTaskRecovery.ts`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingVersionFixtures.ts`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingVersioning.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/artifactLocalRepository.test.ts`

**Interfaces:**
- Consumes: `VisualizationArtifactV1`, `DeepDiveTargetV1`, `VisualizationIntentV1` from plan 01.
- Produces: `ThinReadingDocumentV2`, `isThinReadingV1()`, `parseThinReadingDocument()`, `cloneThinReadingV1AsV2()`.

- [ ] **Step 1: Write failing versioning tests**

```ts
import { branchInput, now, v1Fixture } from "./fixtures/thinReadingVersionFixtures";

test("parses v1 for display but refuses an in-place branch mutation", () => {
  const oldDocument = parseThinReadingDocument(v1Fixture);
  expect(oldDocument.version).toBe("liteasy.thin-reading/v1");
  expect(() => advanceThinReadingDocument(oldDocument, branchInput))
    .toThrow("thin_reading_v1_read_only");
});

test("clones v1 into a new v2 artifact before deepening", () => {
  const next = cloneThinReadingV1AsV2(v1Fixture, { artifactId: "thin-copy-1", createdAt: now });
  expect(next.version).toBe("liteasy.thin-reading/v2");
  expect(next.artifactId).toBe("thin-copy-1");
  expect(next.nodes[next.rootNodeId].visualizations).toEqual([]);
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingVersioning.test.ts src/tests/artifactLocalRepository.test.ts`

Expected: FAIL because v2/versioning helpers do not exist.

- [ ] **Step 3: Add explicit document versions and v2 node fields**

```ts
export type ThinReadingNodeV2 = ThinReadingNodeBase & {
  visualizationDecision?: VisualizationDecisionV1;
  visualizations: readonly VisualizationArtifactV1[];
};

export type ThinReadingDocumentV2 = ThinReadingDocumentBase<ThinReadingNodeV2> & {
  version: "liteasy.thin-reading/v2";
};

export type ThinReadingDocument = ThinReadingDocumentV1 | ThinReadingDocumentV2;
```

Keep `mermaid` and `interactiveDemo` only in the v1 evidence type. Do not make them legal v2 fields. New `createThinReadingDocument()` returns v2.

- [ ] **Step 4: Implement strict parse, clone, and recovery rules**

V1 parser retains existing bounds. V2 parser calls `parseVisualizationArtifact()` for every artifact. Clone copies prose, evidence, annotations, navigation, and source figures, drops executable legacy HTML/Mermaid from the v2 data model, and records the old artifact ID in migration provenance.

- [ ] **Step 5: Run and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingVersioning.test.ts src/tests/thinReadingProjection.test.ts src/tests/artifactLocalRepository.test.ts src/tests/artifactTaskRecovery.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/thin-reading products/liteasy/apps/desktop/src/app/features/artifacts/artifactLocalRepository.ts products/liteasy/apps/desktop/src/app/features/artifacts/artifactTaskRecovery.ts products/liteasy/apps/desktop/src/tests
git commit -m "feat: add thin reading v2 documents"
```

### Task 2: Replace Mermaid And HTML Output With Visualization Intent

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingAgent.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingPromptRegistry.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts`
- Modify: `products/liteasy/apps/desktop/src/app/controllers/agent/runAgentArtifactAnalysis.ts`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingAgent.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingPromptRegistry.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/generateAssistantAnswer.test.ts`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingAgentFixtures.ts`

**Interfaces:**
- Produces: optional `VisualizationIntentV1` next to validated prose/evidence.
- Removes for v2 generation: `interactiveDemo`, `mermaid`, `html_demo`, `mermaid_causal` output requirements.
- Test fixtures: `thinReadingAgentFixtures.ts` exports `v2ModelOutput`, `intentWithUnknownEvidence`, and `modelReturning(output)`.

- [ ] **Step 1: Write failing output-boundary tests**

```ts
test("v2 output contains a compact intent and no executable visual fields", async () => {
  const seed = await generateThinReadingSeed(modelReturning(v2ModelOutput));
  expect(seed.visualizationIntent).toEqual(expect.objectContaining({
    requestedBy: "automatic",
    candidateModalities: ["semantic_graph"]
  }));
  expect(JSON.stringify(seed)).not.toContain("interactiveDemo");
  expect(JSON.stringify(seed)).not.toContain("mermaid");
});

test("rejects an intent whose evidence IDs are outside the reviewed set", async () => {
  await expect(generateThinReadingSeed(modelReturning(intentWithUnknownEvidence)))
    .rejects.toThrow("thin_reading_visualization_intent_invalid");
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingAgent.test.ts src/tests/thinReadingPromptRegistry.test.ts`

Expected: FAIL because the old schema still requires Mermaid/HTML fields.

- [ ] **Step 3: Replace the Zod and JSON output schemas**

```ts
visualizationIntent: z.strictObject({
  purpose: z.enum(["explain_structure", "compare", "show_process", "show_geometry", "show_evidence"]),
  candidateModalities: z.array(generatedModalitySchema).min(1).max(3),
  evidenceIds: z.array(z.string()).min(1).max(32),
  requestedBy: z.enum(["automatic", "explicit_user_request"]),
  expectedLearningGain: z.enum(["low", "medium", "high"])
}).nullable()
```

The prompt says null when unnecessary, evidence-insufficient, redundant, or mismatched. It never asks for SVG/HTML/Mermaid source.

- [ ] **Step 4: Map existing quick commands to explicit typed intents**

Replace quick commands with `visualize_flow`, `visualize_structure`, and `visualize_process`. Old v1 sources remain parseable but are not emitted. The existing prompt input remains the entry for an explicit modality request.

- [ ] **Step 5: Remove the v2 Mermaid repair path and run tests**

Keep legacy Mermaid rendering isolated to v1 display. Remove `mermaid.parse()` from new thin-reading answer generation so the no-generation path does not load Mermaid.

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingAgent.test.ts src/tests/thinReadingPromptRegistry.test.ts src/tests/generateAssistantAnswer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/thin-reading products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts products/liteasy/apps/desktop/src/app/controllers/agent/runAgentArtifactAnalysis.ts products/liteasy/apps/desktop/src/tests
git commit -m "feat: plan typed thin reading visuals"
```

### Task 3: Non-Blocking Visualization Controller And Cancellation

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/controllers/useThinReadingVisualizationController.ts`
- Modify: `products/liteasy/apps/desktop/src/app/controllers/useArtifactWorkflowController.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/useArtifactActions.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/artifact.types.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useThinReadingVisualizationController.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useArtifactWorkflowController.test.ts`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/visualizationControllerFixtures.ts`

**Interfaces:**
- Consumes: account capability, v2 node intent, visualization control-plane client, Agent cancel callback.
- Produces: `startVisualization(node)`, `cancelVisualization(nodeId, reason)`, `setEnabled(enabled)`, per-node minimal status.
- Test fixtures: `visualizationControllerFixtures.ts` exports `nodeWithIntent`, `readyArtifact`, `saveThinReadingDocument`, `generateVisualization`, and `cancelGeneration` spies used by the tests.

- [ ] **Step 1: Write failing policy/cancellation tests**

```ts
test("persists prose before starting an eligible visualization request", async () => {
  await controller.commitGeneratedNode(nodeWithIntent);
  expect(saveThinReadingDocument).toHaveBeenCalledBefore(generateVisualization);
});

test("turning off cancels all uncommitted requests and keeps ready artifacts", async () => {
  await controller.setEnabled(false);
  expect(cancelGeneration).toHaveBeenCalledWith(expect.objectContaining({ reason: "preference_disabled" }));
  expect(result.current.readyArtifacts).toEqual([readyArtifact]);
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/useThinReadingVisualizationController.test.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement fail-closed eligibility**

```ts
const eligible = capability.allowed && capability.enabled && capability.serviceAvailable &&
  capability.quota.available && intent.candidateModalities.some(
    (modality) => capability.availableModalities.includes(modality)
  );
if (!eligible) return { status: "omitted", reasonCode: omissionReason(capability) };
```

Clamp requested artifacts to 1 automatic or 2 explicit. Do not call the service for null intents, disabled capability, unavailable route, or zero quota.

- [ ] **Step 4: Propagate AbortController and guard late commits**

Store controllers by `artifactId:nodeId`. Before applying a result, re-read capability and node generation request ID; ignore responses for cancelled/stale requests.

- [ ] **Step 5: Run and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/useThinReadingVisualizationController.test.ts src/tests/useArtifactWorkflowController.test.ts src/tests/useArtifactActions.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/controllers products/liteasy/apps/desktop/src/app/features/artifacts products/liteasy/apps/desktop/src/tests
git commit -m "feat: orchestrate thin reading visuals"
```

### Task 4: Fixed Reader Layout And Minimal Toggle

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingVisualizationRegion.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingSourceFigures.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/VisualizationArtifactHost.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingTab.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.css`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactTabs.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingTab.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingVisualProps.tsx`

**Interfaces:**
- Consumes: capability/controller and lazy renderer registry.
- Produces: stable top visualization region and bottom source figure gallery.

- [ ] **Step 1: Write failing order and permission tests**

```tsx
import { propsWithVisualAndFigure, unauthorizedProps } from "./fixtures/thinReadingVisualProps";

test("renders generated visuals before prose and source figures after prose", () => {
  render(<ThinReadingTab {...propsWithVisualAndFigure} />);
  const order = within(screen.getByTestId("thin-reading-node"))
    .getAllByTestId(/thin-reading-(visuals|prose|source-figures)/)
    .map((element) => element.dataset.testid);
  expect(order).toEqual([
    "thin-reading-visuals", "thin-reading-prose", "thin-reading-source-figures"
  ]);
});

test("shows a disabled off switch without hiding source figures when unauthorized", () => {
  render(<ThinReadingTab {...unauthorizedProps} />);
  expect(screen.getByRole("switch", { name: "多模态" })).toBeDisabled();
  expect(screen.getByText("论文原图")).toBeVisible();
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingTab.test.tsx src/tests/layoutStyleContract.test.ts`

Expected: FAIL because figures are inline and visuals are below prose.

- [ ] **Step 3: Extract focused regions and remove inline figure placement**

`ThinReadingTab` composes:

```tsx
<ThinReadingVisualizationRegion artifacts={activeVisualizations} status={visualizationStatus} />
<ThinReadingProse node={activeNode} />
<ThinReadingSourceFigures figures={selectedFigures.slice(0, 2)} />
```

Remove `fallbackFigureSentenceIndex()` and `data-thin-reading-ignore-selection` from source figures. Legacy v1 Mermaid/HTML stays in a separate read-only legacy projection below a visible legacy source label, never in v2.

- [ ] **Step 4: Add minimal Fluent state control**

Use `Switch` with accessible name `多模态`, a `Tooltip`, and an adjacent short state only for `暂不可用`, `生成中`, `已简化`, or `未生成`. Do not show provider/model/cost/version text. Use existing Fluent icons.

- [ ] **Step 5: Stabilize responsive dimensions**

Use aspect-ratio/min-height for artifact and source-image stages, one reading column, no nested cards, and mobile stacking. Ensure loading labels cannot resize the grid.

- [ ] **Step 6: Run and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingTab.test.tsx src/tests/ArtifactTabs.test.tsx src/tests/layoutStyleContract.test.ts src/tests/thinReadingStyleContract.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/thin-reading products/liteasy/apps/desktop/src/app/features/visualization/VisualizationArtifactHost.tsx products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactTabs.tsx products/liteasy/apps/desktop/src/app/layout/AppShell.tsx products/liteasy/apps/desktop/src/tests
git commit -m "feat: place visuals around thin reading prose"
```

### Task 5: Whole-Figure, Region, And Semantic-Object Deep Dive

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/thin-reading/SourceFigureSelectionOverlay.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingDeepDiveTarget.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.types.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingProjection.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/useArtifactActions.ts`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingDeepDiveTarget.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/SourceFigureSelectionOverlay.test.tsx`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/visualizationFixtures.ts`

**Interfaces:**
- Produces: `createGeneratedObjectTarget()`, `createSourceFigureTarget()`, `createSourceRegionTarget()`, new branch source `{ kind: "visualization_target"; target: DeepDiveTargetV1 }`.
- Test fixtures: `products/liteasy/apps/desktop/src/tests/fixtures/visualizationFixtures.ts` exports `artifactWithSelectedObject` and `unknownObject`.

- [ ] **Step 1: Write failing coordinate and evidence tests**

```ts
import { artifactWithSelectedObject, unknownObject } from "./fixtures/visualizationFixtures";

test("normalizes a drag rectangle against intrinsic image dimensions", () => {
  expect(createSourceRegionTarget({
    displayRect: { left: 100, top: 50, width: 400, height: 200 },
    drag: { startX: 200, startY: 100, endX: 360, endY: 190 },
    evidenceIds: ["e-1"], figureId: "fig-1", nodeId: "node-1",
    sourcePixelSize: { width: 1600, height: 800 }
  }).bbox).toEqual({ x: 0.25, y: 0.25, width: 0.4, height: 0.45 });
});

test("rejects an object whose claim IDs are not present on the artifact", () => {
  expect(() => createGeneratedObjectTarget(artifactWithSelectedObject, unknownObject))
    .toThrow("deep_dive_target_evidence_invalid");
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingDeepDiveTarget.test.ts src/tests/SourceFigureSelectionOverlay.test.tsx`

Expected: FAIL because target builders and overlay do not exist.

- [ ] **Step 3: Implement bounded target builders**

Clamp pointer coordinates to the rendered content box, normalize to `[0,1]`, reject zero/tiny/out-of-bounds rectangles, preserve intrinsic pixel size, and require source figure identity plus evidence IDs. Generated objects resolve by stable object ID, never canvas coordinates alone.

- [ ] **Step 4: Implement pointer and keyboard selection**

Pointer drag creates a rectangular overlay. Keyboard focus on a source figure exposes `深入整图` and `选择区域`; the latter uses four bounded percentage inputs in a Fluent `Popover`, providing an equivalent non-pointer path.

- [ ] **Step 5: Reuse branch generation**

Map target evidence and excerpt into `ThinReadingGenerationContext`. A v1 target first calls `cloneThinReadingV1AsV2()` and saves a new artifact ID; v2 adds a child node normally.

- [ ] **Step 6: Run and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingDeepDiveTarget.test.ts src/tests/SourceFigureSelectionOverlay.test.tsx src/tests/thinReadingProjection.test.ts src/tests/useArtifactActions.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/thin-reading products/liteasy/apps/desktop/src/app/features/artifacts/useArtifactActions.ts products/liteasy/apps/desktop/src/tests
git commit -m "feat: deepen thin reading visual objects"
```

### Task 6: Persistence, Export, Browser, And Build Gate

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/artifactDocumentExport.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingFixtures.ts`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/visualizationFixtures.ts`
- Test: `products/liteasy/apps/desktop/src/tests/artifactDocumentExport.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts`

**Interfaces:**
- Produces: safe v2 export with semantic summaries and source attribution; no executable HTML/Mermaid export for v2.

- [ ] **Step 1: Write failing export and browser assertions**

```ts
test("exports v2 visual semantics and source attribution without executable markup", () => {
  const markdown = exportArtifactDocument(v2Fixture);
  expect(markdown).toContain("生成可视化");
  expect(markdown).toContain("论文原图");
  expect(markdown).not.toContain("<script");
  expect(markdown).not.toContain("```html");
});
```

Browser assertions must compare the bounding boxes of `thin-reading-visuals`, `thin-reading-prose`, and `thin-reading-source-figures`, exercise the switch, select a whole figure and region, click a semantic object, and capture desktop/mobile screenshots.

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/artifactDocumentExport.test.ts`

Expected: FAIL because v2 export is not implemented.

- [ ] **Step 3: Implement safe export and stable fixtures**

Export accessibility summaries, object labels, evidence IDs, paper/page/figure/caption, and normalized region coordinates as Markdown text/tables. Do not export renderer internals, provider data, scripts, or raw generated image URLs.

- [ ] **Step 4: Run unit, browser, and production builds**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingVersioning.test.ts src/tests/thinReadingAgent.test.ts src/tests/useThinReadingVisualizationController.test.ts src/tests/thinReadingTab.test.tsx src/tests/thinReadingDeepDiveTarget.test.ts src/tests/artifactDocumentExport.test.ts`

Run: `cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/thinReading.browser.spec.ts`

Run: `cd products/liteasy/apps/desktop && npm run build`

Expected: all PASS; screenshots show no overlap and the required top/body/bottom order on desktop and mobile.

- [ ] **Step 5: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/artifacts/artifactDocumentExport.ts products/liteasy/apps/desktop/src/tests
git commit -m "test: gate thin reading visual integration"
```
