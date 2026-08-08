# Thin Reading Multimodal Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the typed, evidence-bound, cancellable visualization runtime that later modality and UI plans consume.

**Architecture:** Add a focused `features/visualization/` domain. Model output is parsed into discriminated specs; built-in Skill packages declare evidence, validator, kernel, renderer, and fallback requirements; the workflow harness permits one repair and only publishes hard-gate-passing artifacts. No renderer is advertised as available until a later plan registers a complete implementation.

**Tech Stack:** TypeScript 5.8, Zod 4, React 18 contracts, Vitest 3, existing Agent Core and ArtifactWorkflowHarness.

## Global Constraints

- Preserve `layout -> controllers -> features -> shared types / clients`.
- New TypeScript uses two spaces, double quotes, semicolons, and strict types.
- V1 loads deployment-built-in Skills only; no remote installation or dynamic code execution.
- Models produce typed specs, never production SVG, HTML, scripts, shaders, or event handlers.
- Hard-gate failure cannot publish an artifact; model critique is advisory only.
- Maximum repair count is exactly one.
- User-visible copy must not expose provider, Skill, Kernel, Renderer, schema, versions, or quota units.
- Do not edit or discard unrelated dirty thin-reading changes.

---

### Task 1: Artifact Types And Runtime Schema

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationArtifact.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationArtifact.schema.ts`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/visualizationArtifactFixtures.ts`
- Test: `products/liteasy/apps/desktop/src/tests/visualizationArtifactSchema.test.ts`

**Interfaces:**
- Produces: `VisualizationArtifactV1`, `VisualizationSpecV1`, `GeneratedVisualizationModality`, `DeepDiveTargetV1`, `parseVisualizationArtifact(value)`.
- Consumed by: every later plan, persistence, validator, renderer, and deep-dive code.

- [ ] **Step 1: Write failing schema tests**

```ts
import { parseVisualizationArtifact } from "../app/features/visualization/visualizationArtifact.schema";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";

const validSemanticGraphArtifact = () => makeVisualizationArtifactFixture({ modality: "semantic_graph" });

test("rejects a modality/spec mismatch and executable fields", () => {
  expect(() => parseVisualizationArtifact({
    artifactId: "viz-1",
    artifactVersion: "liteasy.visualization/v1",
    modality: "function_plot",
    nodeId: "node-1",
    locale: "zh-CN",
    spec: { modality: "semantic_graph", payload: { edges: [], nodes: [], subtype: "flowchart" } },
    script: "alert(1)"
  })).toThrow("visualization_artifact_invalid");
});

test("accepts a complete evidence-bound semantic graph artifact", () => {
  expect(parseVisualizationArtifact(validSemanticGraphArtifact()).modality).toBe("semantic_graph");
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/visualizationArtifactSchema.test.ts`

Expected: FAIL because `visualizationArtifact.schema.ts` does not exist.

- [ ] **Step 3: Define the exact discriminated contract**

```ts
export const generatedVisualizationModalities = [
  "semantic_graph", "circuit", "physics_diagram", "biology_structure",
  "geometry_2d", "function_plot", "geometry_3d", "physics_process",
  "reaction_process", "raster_illustration"
] as const;

export type GeneratedVisualizationModality = typeof generatedVisualizationModalities[number];
export type VisualizationModality = GeneratedVisualizationModality | "source_figure";

export type VisualizationSpecV1 =
  | { modality: "semantic_graph"; payload: SemanticGraphSpecV1 }
  | { modality: "circuit"; payload: CircuitSpecV1 }
  | { modality: "physics_diagram"; payload: PhysicsDiagramSpecV1 }
  | { modality: "biology_structure"; payload: BiologyStructureSpecV1 }
  | { modality: "geometry_2d"; payload: Geometry2DSpecV1 }
  | { modality: "function_plot"; payload: FunctionPlotSpecV1 }
  | { modality: "geometry_3d"; payload: Geometry3DSpecV1 }
  | { modality: "physics_process"; payload: PhysicsProcessSpecV1 }
  | { modality: "reaction_process"; payload: ReactionProcessSpecV1 }
  | { modality: "raster_illustration"; payload: RasterIllustrationSpecV1 }
  | { modality: "source_figure"; payload: SourceFigureRefV1 };
```

Define every referenced payload as a concrete type with bounded arrays and stable IDs. Mirror the approved spec for evidence bindings, semantic objects, interaction, accessibility, validation, fallback, usage link, and normalized bounding boxes.

- [ ] **Step 4: Parse with strict Zod objects and cross-field refinements**

```ts
const artifactSchema = z.strictObject({
  artifactId: stableIdSchema,
  artifactVersion: z.literal("liteasy.visualization/v1"),
  modality: modalitySchema,
  nodeId: stableIdSchema,
  locale: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  spec: visualizationSpecSchema,
  implementation: implementationSchema,
  evidenceBindings: z.array(evidenceBindingSchema).max(256),
  semanticObjects: z.array(semanticObjectSchema).max(512),
  interaction: interactionSchema,
  accessibility: accessibilitySchema,
  validation: validationReportSchema,
  fallbackHistory: z.array(fallbackRecordSchema).max(4),
  usage: usageRecordLinkSchema,
  createdAt: z.string().datetime()
}).superRefine((artifact, context) => {
  if (artifact.modality !== artifact.spec.modality || artifact.validation.outcome === "fail") {
    context.addIssue({ code: "custom", message: "visualization_artifact_invalid" });
  }
});

export function parseVisualizationArtifact(value: unknown): VisualizationArtifactV1 {
  const result = artifactSchema.safeParse(value);
  if (!result.success) throw new Error("visualization_artifact_invalid");
  return result.data as VisualizationArtifactV1;
}
```

- [ ] **Step 5: Run schema tests and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/visualizationArtifactSchema.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/visualizationArtifact.types.ts products/liteasy/apps/desktop/src/app/features/visualization/visualizationArtifact.schema.ts products/liteasy/apps/desktop/src/tests/visualizationArtifactSchema.test.ts
git commit -m "feat: add visualization artifact contract"
```

### Task 2: Built-In Skill Package Registry

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/skills/builtinSkill.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/skills/builtinSkillRegistry.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/source-figure/skill.json`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/skills/source-figure/instructions.md`
- Modify: `products/liteasy/apps/desktop/src/app/features/skills/skillRegistry.ts`
- Test: `products/liteasy/apps/desktop/src/tests/builtinSkillRegistry.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/skillRegistry.test.ts`

**Interfaces:**
- Consumes: `VisualizationModality` from Task 1.
- Produces: `BuiltinSkillManifestV1`, `registerBuiltinSkill()`, `getBuiltinSkillSummary()`, `loadBuiltinSkill(id)`.
- Preserves: existing `executeSkill()` action delegation unchanged.
- Test fixtures: the registry test declares `invalidManifest` and `invalidPackage` as complete manifest/package objects differing only by an undeclared validator ID.

- [ ] **Step 1: Write failing registry tests**

```ts
test("loads only registered built-in packages", async () => {
  expect(getBuiltinSkillSummary()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "source-figure", remote: false })
  ]));
  await expect(loadBuiltinSkill("https://example.test/skill")).rejects.toThrow("builtin_skill_not_found");
});

test("rejects manifests whose fallback or validator IDs are undeclared", () => {
  expect(() => registerBuiltinSkill(invalidManifest, async () => invalidPackage))
    .toThrow("builtin_skill_manifest_invalid");
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/builtinSkillRegistry.test.ts`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement the package contract and exact registry**

```ts
export type BuiltinSkillManifestV1 = {
  costClass: "none" | "low" | "medium" | "high";
  evidenceRequirements: string[];
  fallbackModalities: VisualizationModality[];
  id: string;
  integrityRules: string[];
  kernelId?: string;
  modality: VisualizationModality;
  outputSchemaId: string;
  remote: false;
  rendererId: string;
  runtimeVersion: "liteasy.visualization-runtime/v1";
  styleLock: string[];
  validatorIds: string[];
  version: string;
};

const packages = new Map<string, BuiltinSkillRegistration>();

export function loadBuiltinSkill(id: string) {
  const registration = packages.get(id);
  if (!registration) return Promise.reject(new Error("builtin_skill_not_found"));
  return registration.load();
}
```

Parse `skill.json` with a strict schema. The source-figure package declares zero provider cost, evidence/source validators, `source-figure` renderer, and no fallback.

- [ ] **Step 4: Keep existing action Skills compatible and expose capability summaries**

In `skillRegistry.ts`, retain `executeSkill()` and re-export only the built-in summary API. Do not route visualization packages through `executeAction`; later plans use Actions only for server-side side effects.

- [ ] **Step 5: Run both registries and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/builtinSkillRegistry.test.ts src/tests/skillRegistry.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/skills products/liteasy/apps/desktop/src/app/features/visualization/skills/source-figure products/liteasy/apps/desktop/src/tests/builtinSkillRegistry.test.ts products/liteasy/apps/desktop/src/tests/skillRegistry.test.ts
git commit -m "feat: add built-in visualization skills"
```

### Task 3: Validator Registry And Hard-Gate Policy

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationValidator.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationValidatorRegistry.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/validators/baseValidators.ts`
- Test: `products/liteasy/apps/desktop/src/tests/visualizationValidatorRegistry.test.ts`

**Interfaces:**
- Consumes: `VisualizationSpecV1`, evidence bindings and Skill validator IDs.
- Produces: `VisualizationValidationContext`, `VisualizationValidator`, `runVisualizationValidators()`.
- Test fixtures: `contextWithUnknownClaim` is a complete context whose sole semantic object references `claim-missing`; `hardFailure` and `advisoryFailure` are validators returning explicit fail/warning checks.

- [ ] **Step 1: Write failing hard/advisory tests**

```ts
test("cannot publish when any hard validator fails", async () => {
  const report = await runVisualizationValidators(context, [hardFailure, advisoryFailure]);
  expect(report.outcome).toBe("fail");
  expect(report.checks.map((check) => check.gate)).toEqual(["hard", "advisory"]);
});

test("requires every scientific semantic object to reference a known claim", async () => {
  expect((await evidenceBindingValidator.validate(contextWithUnknownClaim)).outcome).toBe("fail");
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/visualizationValidatorRegistry.test.ts`

Expected: FAIL because validator modules do not exist.

- [ ] **Step 3: Implement deterministic validator composition**

```ts
export async function runVisualizationValidators(
  context: VisualizationValidationContext,
  validators: readonly VisualizationValidator[]
): Promise<ValidationReportV1> {
  const checks = [];
  for (const validator of validators) checks.push(await validator.validate(context));
  const hardFailed = checks.some((check) => check.gate === "hard" && check.outcome === "fail");
  return { checks, outcome: hardFailed ? "fail" : "pass", repairCount: context.repairCount };
}
```

Base hard validators cover schema identity, evidence claim existence, stable/unique object IDs, interaction allowlist, resource limits, source-figure identity, and accessibility reading order. A model critique adapter may register only with `gate: "advisory"`.

- [ ] **Step 4: Run and commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/visualizationValidatorRegistry.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization products/liteasy/apps/desktop/src/tests/visualizationValidatorRegistry.test.ts
git commit -m "feat: enforce visualization hard gates"
```

### Task 4: Cancellable Workflow Harness With One Repair And Fallback

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationWorkflowHarness.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifact-workflow/artifactWorkflowHarness.ts`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/visualizationWorkflowFixtures.ts`
- Test: `products/liteasy/apps/desktop/src/tests/visualizationWorkflowHarness.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/artifactWorkflowHarness.test.ts`

**Interfaces:**
- Consumes: built-in Skill loader, validator registry, provider draft callback, `AbortSignal`.
- Produces: `runVisualizationWorkflow(input): Promise<VisualizationWorkflowResult>`.
- Test fixtures: `makeVisualizationWorkflowFixture()` returns complete callbacks and a valid source-figure fallback; it also exports `invalidDraft` and `stillInvalidDraft` with schema-valid but hard-gate-failing content.

- [ ] **Step 1: Write failing workflow tests**

```ts
import { makeVisualizationWorkflowFixture, invalidDraft, stillInvalidDraft, validSourceFigure } from "./fixtures/visualizationWorkflowFixtures";

test("repairs once, then falls back and publishes only the verified result", async () => {
  const result = await runVisualizationWorkflow(makeVisualizationWorkflowFixture({
    generate: vi.fn().mockResolvedValue(invalidDraft),
    repair: vi.fn().mockResolvedValue(stillInvalidDraft),
    fallback: vi.fn().mockResolvedValue(validSourceFigure)
  }));
  expect(result.status).toBe("degraded");
  expect(result.artifact.spec.modality).toBe("source_figure");
  expect(result.trace.steps.filter((step) => step.kind === "repair")).toHaveLength(1);
});

test("aborts before publish when the signal changes", async () => {
  const controller = new AbortController();
  controller.abort("preference_disabled");
  await expect(runVisualizationWorkflow(makeVisualizationWorkflowFixture({ signal: controller.signal })))
    .rejects.toThrow("visualization_cancelled");
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/visualizationWorkflowHarness.test.ts`

Expected: FAIL because the workflow harness does not exist.

- [ ] **Step 3: Add cancellation-aware trace steps**

Extend `ArtifactWorkflowHarness.step()` with optional `signal?: AbortSignal`. Check before running and before recording completion; preserve existing callers by keeping it optional.

```ts
if (stepInput.signal?.aborted) throw new Error("artifact_workflow_cancelled");
const value = await stepInput.run();
if (stepInput.signal?.aborted) throw new Error("artifact_workflow_cancelled");
```

- [ ] **Step 4: Implement the exact state sequence**

```ts
const first = await generateDraft(input);
let report = await validate(first, 0);
if (report.outcome === "pass") return verified(first, report);

const repaired = await input.repair(first, report, input.signal);
report = await validate(repaired, 1);
if (report.outcome === "pass") return verified(repaired, report);

for (const modality of input.skill.manifest.fallbackModalities) {
  const fallback = await input.createFallback(modality, repaired, input.signal);
  const fallbackReport = await validate(fallback, 1);
  if (fallbackReport.outcome === "pass") return degraded(fallback, fallbackReport);
}
return omitted(report);
```

- [ ] **Step 5: Run focused and regression tests, then commit**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/visualizationWorkflowHarness.test.ts src/tests/artifactWorkflowHarness.test.ts src/tests/mindmapWorkflowHarness.test.ts`

Expected: PASS.

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/visualizationWorkflowHarness.ts products/liteasy/apps/desktop/src/app/features/artifact-workflow/artifactWorkflowHarness.ts products/liteasy/apps/desktop/src/tests/visualizationWorkflowHarness.test.ts products/liteasy/apps/desktop/src/tests/artifactWorkflowHarness.test.ts
git commit -m "feat: add cancellable visualization workflow"
```

### Task 5: Lazy Renderer Registry And Agent Capability Summary

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationRendererRegistry.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationRuntime.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-core/agentCoreConfig.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-core/contextAssembler.ts`
- Test: `products/liteasy/apps/desktop/src/tests/visualizationRendererRegistry.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentCoreSession.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/artifactRevalidation.test.ts`

**Interfaces:**
- Produces: `registerVisualizationRenderer()`, `loadVisualizationRenderer()`, `getAvailableVisualizationModalities()`.
- Guarantees: summaries expose only fully registered Skill + Validator + Renderer (+ Kernel when required).
- Revalidation test fixture: `cachedArtifact` is a complete ready artifact with a static preview and validator version `"1"`; `loadVisualizationArtifact()` is the repository read/revalidation method added in this task.

- [ ] **Step 1: Write failing lazy-load and availability tests**

```ts
test("does not load renderer chunks while enumerating capabilities", async () => {
  const load = vi.fn(async () => renderer);
  registerVisualizationRenderer({ id: "source-figure", load, modality: "source_figure", version: "1" });
  expect(getAvailableVisualizationModalities()).toContain("source_figure");
  expect(load).not.toHaveBeenCalled();
  await loadVisualizationRenderer("source-figure");
  expect(load).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Verify red**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/visualizationRendererRegistry.test.ts`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement lazy registration and complete-chain availability**

```ts
export type VisualizationRendererRegistration = {
  id: string;
  load: () => Promise<VisualizationRenderer>;
  modality: VisualizationModality;
  version: string;
};

export function getAvailableVisualizationModalities() {
  return getBuiltinSkillSummary()
    .filter((skill) => rendererRegistrations.has(skill.rendererId) && validatorsExist(skill.validatorIds))
    .map((skill) => skill.modality);
}
```

- [ ] **Step 4: Add one compact Agent Core catalog entry**

Add `thin-reading-visualize` as an active Skill summary only when `getAvailableVisualizationModalities()` contains at least one generated modality. Its description states evidence-bound visualization selection; it must not enumerate implementation details or put full Skill instructions into every turn.

- [ ] **Step 5: Add offline read-only and artifact revalidation contracts**

The local artifact repository may render a cached `ready`/`degraded` artifact only when the user still has document access. It never queues a new generation while offline. Store the evidence hash, spec hash, Skill/Kernel/Renderer versions, and hard-validator set in the artifact index; when any renderer or hard-validator version is revoked or upgraded, mark the artifact `needs_revalidation`, rerun hard gates in a worker, and keep the old spec as immutable fallback. A failed revalidation selects the last safe static preview or hides the visual while leaving prose and source figures visible.

```ts
test("requires revalidation after a hard-validator version changes", async () => {
  const state = await loadVisualizationArtifact(cachedArtifact, { currentValidatorVersions: { evidence: "2" }, offline: true });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canGenerate).toBe(false);
  expect(state.safePreview).toEqual(cachedArtifact.safePreview);
});
```

- [ ] **Step 6: Run foundation suite and build**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/visualizationArtifactSchema.test.ts src/tests/builtinSkillRegistry.test.ts src/tests/visualizationValidatorRegistry.test.ts src/tests/visualizationWorkflowHarness.test.ts src/tests/visualizationRendererRegistry.test.ts src/tests/agentCoreSession.test.ts src/tests/artifactRevalidation.test.ts`

Expected: PASS.

Run: `cd products/liteasy/apps/desktop && npm run build`

Expected: TypeScript and Vite production build PASS; no Three.js chunk exists yet.

- [ ] **Step 7: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization products/liteasy/apps/desktop/src/app/features/agent-core products/liteasy/apps/desktop/src/tests
git commit -m "feat: complete visualization runtime foundation"
```
