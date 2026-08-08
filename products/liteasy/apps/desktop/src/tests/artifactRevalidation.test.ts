import { expect, test } from "vitest";
import { loadVisualizationArtifact } from "../app/features/visualization/visualizationRuntime";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";
import { registerVisualizationRenderer } from "../app/features/visualization/visualizationRendererRegistry";

registerVisualizationRenderer({
  id: "safe-svg",
  load: async () => ({ id: "safe-svg", modality: "semantic_graph", version: "1.0.0" }),
  modality: "semantic_graph",
  version: "1.0.0"
});

const cachedArtifact = {
  ...makeVisualizationArtifactFixture(),
  validation: {
    checks: [{ gate: "hard" as const, outcome: "pass" as const, validatorId: "evidence", validatorVersion: "1" }],
    outcome: "pass" as const,
    repairCount: 0 as const
  },
  evidenceHash: "evidence-1",
  safePreview: { kind: "static", imageRef: "preview-1" },
  status: "ready" as const,
  specHash: "spec-1"
};

test("requires revalidation after a hard-validator version changes", async () => {
  const state = await loadVisualizationArtifact(cachedArtifact, {
    currentValidatorVersions: { evidence: "2" },
    offline: true
  });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canGenerate).toBe(false);
  expect(state.safePreview).toEqual(cachedArtifact.safePreview);
});

test("does not generate while offline when a cached artifact is still valid", async () => {
  const state = await loadVisualizationArtifact(cachedArtifact, {
    currentValidatorVersions: { evidence: "1" },
    offline: true
  });
  expect(state.status).toBe("ready");
  expect(state.canGenerate).toBe(false);
  expect(state.canRender).toBe(true);
});
