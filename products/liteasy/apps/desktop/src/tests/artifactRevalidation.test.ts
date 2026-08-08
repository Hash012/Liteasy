import { expect, test, vi } from "vitest";
import {
  loadVisualizationArtifact,
  parseVisualizationArtifactEnvelope
} from "../app/features/visualization/visualizationRuntime";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";
import { registerVisualizationKernel, registerVisualizationRenderer } from "../app/features/visualization/visualizationRendererRegistry";
import { registerVisualizationValidator } from "../app/features/visualization/visualizationValidatorRegistry";

registerVisualizationRenderer({
  id: "safe-svg",
  load: async () => ({ id: "safe-svg", modality: "semantic_graph", version: "1.0.0" }),
  modality: "semantic_graph",
  version: "1.0.0"
});

registerVisualizationValidator({
  gate: "hard",
  id: "test-current-validator",
  validate: async () => ({ gate: "hard", outcome: "pass", validatorId: "test-current-validator", validatorVersion: "2" }),
  version: "2"
});

const cachedArtifact = makeVisualizationArtifactFixture({
  validation: { outcome: "pass" }
});
cachedArtifact.validation = {
  checks: [{ gate: "hard", outcome: "pass", validatorId: "artifact-schema", validatorVersion: "1.0.0" }],
  outcome: "pass",
  repairCount: 0
};

const cachedEnvelope = parseVisualizationArtifactEnvelope({
  artifact: cachedArtifact,
  artifactIndex: {
    evidenceHash: "evidence-1",
    hardValidatorVersions: { "artifact-schema": "1.0.0" },
    rendererVersion: "1.0.0",
    skillVersion: "1.0.0",
    specHash: "spec-1"
  },
  safePreview: { kind: "static", imageRef: "preview-1" },
  status: "ready"
});

test("requires revalidation after a hard-validator version changes", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { "artifact-schema": "2.0.0" },
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
    currentValidatorVersions: { "artifact-schema": "1.0.0" },
    offline: true
  });
  expect(state.status).toBe("ready");
  expect(state.canGenerate).toBe(false);
  expect(state.canRender).toBe(true);
});

test("does not enable a changed renderer from validator-only revalidation", async () => {
  const outdatedRendererEnvelope = parseVisualizationArtifactEnvelope({
    ...cachedEnvelope,
    artifact: {
      ...cachedEnvelope.artifact,
      implementation: { ...cachedEnvelope.artifact.implementation, rendererVersion: "0.9.0" }
    },
    artifactIndex: { ...cachedEnvelope.artifactIndex, rendererVersion: "0.9.0" }
  });
  const revalidationService = {
    revalidate: vi.fn(async () => ({ outcome: "pass" as const, usedHardValidatorVersions: { "artifact-schema": "2.0.0" } })),
    terminate: () => undefined
  };
  const state = await loadVisualizationArtifact(outdatedRendererEnvelope, {
    currentValidatorVersions: { "artifact-schema": "2.0.0" },
    revalidationService
  });
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
  expect(state.status).toBe("needs_revalidation");
  expect(state.artifactIndex.hardValidatorVersions).toEqual({ "artifact-schema": "1.0.0" });
  expect(revalidationService.revalidate).toHaveBeenCalledOnce();
});

test("keeps a stale artifact preview-only when hard-gate revalidation fails", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { "artifact-schema": "2.0.0" },
    revalidationService: { revalidate: async () => ({ outcome: "fail" as const, usedHardValidatorVersions: {} }), terminate: () => undefined }
  });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("hides a stale artifact when there is no safe preview", async () => {
  const state = await loadVisualizationArtifact({ ...cachedEnvelope, safePreview: undefined }, {
    currentValidatorVersions: { "artifact-schema": "2.0.0" }
  });
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(false);
});

test("blocks artifact and preview rendering when document access is lost", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { "artifact-schema": "1.0.0" },
    documentAccess: false,
    offline: true
  });
  expect(state.canGenerate).toBe(false);
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(false);
});

test("marks a revoked renderer for revalidation", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { "artifact-schema": "1.0.0" },
    revokedRendererIds: ["safe-svg"]
  });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canRender).toBe(false);
});

test("marks a revoked hard validator for revalidation", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { "artifact-schema": "1.0.0" },
    revokedValidatorIds: ["artifact-schema"]
  });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("does not re-enable a revoked renderer after a passing worker result", async () => {
  const revalidationService = {
    revalidate: vi.fn(async () => ({ outcome: "pass" as const, usedHardValidatorVersions: { "artifact-schema": "1.0.0" } })),
    terminate: () => undefined
  };
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { "artifact-schema": "1.0.0" },
    revokedRendererIds: ["safe-svg"],
    revalidationService
  });
  expect(revalidationService.revalidate).not.toHaveBeenCalled();
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("does not re-enable a revoked validator after a passing worker result", async () => {
  const revalidationService = {
    revalidate: vi.fn(async () => ({ outcome: "pass" as const, usedHardValidatorVersions: { "artifact-schema": "1.0.0" } })),
    terminate: () => undefined
  };
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { "artifact-schema": "1.0.0" },
    revokedValidatorIds: ["artifact-schema"],
    revalidationService
  });
  expect(revalidationService.revalidate).not.toHaveBeenCalled();
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("fails closed when the current validator map is omitted and a registered version changed", async () => {
  const upgradedEnvelope = parseVisualizationArtifactEnvelope({
    ...cachedEnvelope,
    artifactIndex: {
      ...cachedEnvelope.artifactIndex,
      hardValidatorVersions: { "test-current-validator": "1" }
    }
  });
  const state = await loadVisualizationArtifact(upgradedEnvelope);
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

test("rejects an artifact envelope with an empty hard-validator set", () => {
  expect(() => parseVisualizationArtifactEnvelope({
    ...cachedEnvelope,
    artifactIndex: { ...cachedEnvelope.artifactIndex, hardValidatorVersions: {} }
  })).toThrow("visualization_artifact_envelope_invalid");
});

test("requires revalidation when the current validator set adds an ID", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: {
      "artifact-schema": "1.0.0",
      "test-current-validator": "2"
    }
  });
  expect(state.status).toBe("needs_revalidation");
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("requires revalidation when an indexed kernel version changes", async () => {
  registerVisualizationKernel({ id: "fixture-kernel", version: "2" });
  const kernelEnvelope = parseVisualizationArtifactEnvelope({
    ...cachedEnvelope,
    artifact: {
      ...cachedEnvelope.artifact,
      implementation: {
        ...cachedEnvelope.artifact.implementation,
        kernelId: "fixture-kernel",
        kernelVersion: "1"
      }
    },
    artifactIndex: { ...cachedEnvelope.artifactIndex, kernelVersion: "1" }
  });
  const state = await loadVisualizationArtifact(kernelEnvelope);
  expect(state.status).toBe("needs_revalidation");
  expect(state.canRender).toBe(false);
});

test("does not enable a changed kernel from validator-only revalidation", async () => {
  const kernelEnvelope = parseVisualizationArtifactEnvelope({
    ...cachedEnvelope,
    artifact: {
      ...cachedEnvelope.artifact,
      implementation: { ...cachedEnvelope.artifact.implementation, kernelId: "fixture-kernel", kernelVersion: "1" }
    },
    artifactIndex: { ...cachedEnvelope.artifactIndex, kernelVersion: "1" }
  });
  const state = await loadVisualizationArtifact(kernelEnvelope, {
    currentValidatorVersions: { "artifact-schema": "1.0.0" },
    revalidationService: {
      revalidate: async () => ({ outcome: "pass" as const, usedHardValidatorVersions: { "artifact-schema": "1.0.0" } }),
      terminate: () => undefined
    }
  });
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("does not enable a revoked kernel after a passing worker result", async () => {
  const kernelEnvelope = parseVisualizationArtifactEnvelope({
    ...cachedEnvelope,
    artifact: {
      ...cachedEnvelope.artifact,
      implementation: { ...cachedEnvelope.artifact.implementation, kernelId: "fixture-kernel", kernelVersion: "2" }
    },
    artifactIndex: { ...cachedEnvelope.artifactIndex, kernelVersion: "2" }
  });
  const state = await loadVisualizationArtifact(kernelEnvelope, {
    currentValidatorVersions: { "artifact-schema": "1.0.0" },
    revokedKernelIds: ["fixture-kernel"],
    revalidationService: {
      revalidate: vi.fn(async () => ({ outcome: "pass" as const, usedHardValidatorVersions: { "artifact-schema": "1.0.0" } })),
      terminate: () => undefined
    }
  });
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});

test("rejects a passing revalidation result with an incomplete validator set", async () => {
  const state = await loadVisualizationArtifact(cachedEnvelope, {
    currentValidatorVersions: { "artifact-schema": "2.0.0" },
    revalidationService: {
      revalidate: async () => ({ outcome: "pass" as const, usedHardValidatorVersions: {} }),
      terminate: () => undefined
    }
  });
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
  expect(state.status).toBe("needs_revalidation");
});

test("does not enable an artifact whose renderer is missing from the registry", async () => {
  const missingRendererEnvelope = parseVisualizationArtifactEnvelope({
    ...cachedEnvelope,
    artifact: {
      ...cachedEnvelope.artifact,
      implementation: { ...cachedEnvelope.artifact.implementation, rendererId: "missing-renderer" }
    }
  });
  const state = await loadVisualizationArtifact(missingRendererEnvelope, {
    currentValidatorVersions: { "artifact-schema": "1.0.0" },
    revalidationService: {
      revalidate: async () => ({ outcome: "pass" as const, usedHardValidatorVersions: { "artifact-schema": "1.0.0" } }),
      terminate: () => undefined
    }
  });
  expect(state.canRender).toBe(false);
  expect(state.canRenderSafePreview).toBe(true);
});
