import { expect, test, vi } from "vitest";
import {
  loadVisualizationArtifact,
  parseVisualizationArtifactEnvelope
} from "../app/features/visualization/visualizationRuntime";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";
import { registerVisualizationRenderer } from "../app/features/visualization/visualizationRendererRegistry";

registerVisualizationRenderer({
  id: "safe-svg",
  load: async () => ({ id: "safe-svg", modality: "semantic_graph", version: "1.0.0" }),
  modality: "semantic_graph",
  version: "1.0.0"
});

const cachedArtifact = makeVisualizationArtifactFixture({
  validation: { outcome: "pass" }
});
cachedArtifact.validation = {
  checks: [{ gate: "hard", outcome: "pass", validatorId: "evidence", validatorVersion: "1" }],
  outcome: "pass",
  repairCount: 0
};

const cachedEnvelope = parseVisualizationArtifactEnvelope({
  artifact: cachedArtifact,
  artifactIndex: {
    evidenceHash: "evidence-1",
    hardValidatorVersions: { evidence: "1" },
    rendererVersion: "1.0.0",
    skillVersion: "1.0.0",
    specHash: "spec-1"
  },
  safePreview: { kind: "static", imageRef: "preview-1" },
  status: "ready"
});

test("requires revalidation after a hard-validator version changes", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { evidence: "2" },
    offline: true
  });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canGenerate).toBe(false);
  expect(state.safePreview).toEqual(cachedEnvelope.safePreview);
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("does not generate while offline when a cached artifact is still valid", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { evidence: "1" },
    offline: true
  });
  expect(state.status).toBe("ready");
  expect(state.canGenerate).toBe(false);
  expect(state.canRender).toBe(true);
});

test("enables a renderer only after its changed version passes hard-gate revalidation", async () => {
  const outdatedRendererEnvelope = parseVisualizationArtifactEnvelope({
    ...cachedEnvelope,
    artifact: {
      ...cachedEnvelope.artifact,
      implementation: { ...cachedEnvelope.artifact.implementation, rendererVersion: "0.9.0" }
    },
    artifactIndex: { ...cachedEnvelope.artifactIndex, rendererVersion: "0.9.0" }
  });
  const revalidateHardGates = vi.fn(async () => "pass" as const);
  const state = await loadVisualizationArtifact(outdatedRendererEnvelope, {
    currentValidatorVersions: { evidence: "1" },
    revalidateHardGates
  });
  expect(state.canRender).toBe(true);
  expect(state.canRenderSafePreview).toBe(false);
  expect(state.status).toBe("ready");
  expect(revalidateHardGates).toHaveBeenCalledOnce();
});

test("keeps a stale artifact preview-only when hard-gate revalidation fails", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { evidence: "2" },
    revalidateHardGates: async () => "fail"
  });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("hides a stale artifact when there is no safe preview", async () => {
  const state = await loadVisualizationArtifact({ ...cachedEnvelope, safePreview: undefined }, {
    currentValidatorVersions: { evidence: "2" }
  });
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(false);
});

test("blocks artifact and preview rendering when document access is lost", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { evidence: "1" },
    documentAccess: false,
    offline: true
  });
  expect(state.canGenerate).toBe(false);
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(false);
});

test("marks a revoked renderer for revalidation", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { evidence: "1" },
    revokedRendererIds: ["safe-svg"]
  });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canRender).toBe(false);
});

test("marks a revoked hard validator for revalidation", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { evidence: "1" },
    revokedValidatorIds: ["evidence"]
  });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("parses a strict local envelope without weakening the artifact schema", () => {
  expect(parseVisualizationArtifactEnvelope(cachedEnvelope)).toEqual(cachedEnvelope);
  expect(() => parseVisualizationArtifactEnvelope({ ...cachedEnvelope, unexpected: true }))
    .toThrow("visualization_artifact_envelope_invalid");
  expect(() => parseVisualizationArtifactEnvelope({
    ...cachedEnvelope,
    artifact: { ...cachedEnvelope.artifact, unexpected: true }
  })).toThrow("visualization_artifact_envelope_invalid");
});
