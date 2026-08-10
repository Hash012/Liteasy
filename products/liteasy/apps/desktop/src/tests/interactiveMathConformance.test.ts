import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { validateFunctionPlot } from "../app/features/visualization/kernels/functionPlotKernel";
import { validateGeometry2D } from "../app/features/visualization/kernels/geometry2dKernel";
import { validateGeometry3D } from "../app/features/visualization/kernels/geometry3dKernel";
import type { VisualizationModality, VisualizationSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

const fixture = JSON.parse(readFileSync(resolve(
  process.cwd(),
  "../../../../development/test-data/thin-reading-multimodal/interactive-math-conformance.v1.json"
), "utf8"));

const validators = {
  function_plot: (spec: VisualizationSpecV1) => validateFunctionPlot(spec.payload as never),
  geometry_2d: (spec: VisualizationSpecV1) => validateGeometry2D(spec.payload as never),
  geometry_3d: (spec: VisualizationSpecV1) => validateGeometry3D(spec.payload as never)
} satisfies Record<string, (spec: VisualizationSpecV1) => unknown>;

function mergePatch(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const output = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    output[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergePatch(output[key], value)
      : value;
  }
  return output;
}

describe("interactive math cross-runtime conformance", () => {
  test("accepts every valid interactive math fixture", () => {
    for (const modality of Object.keys(validators) as VisualizationModality[]) {
      expect(() => validators[modality](fixture.modalities[modality].valid.spec)).not.toThrow();
    }
  });

  test("rejects domain-invalid fixtures with the shared diagnostic code", () => {
    for (const modality of Object.keys(validators) as VisualizationModality[]) {
      const invalid = fixture.modalities[modality].invalid.domain;
      const proposal = mergePatch(fixture.modalities[modality].valid, invalid.patch) as { spec: VisualizationSpecV1 };
      expect(() => validators[modality](proposal.spec)).toThrow(invalid.diagnosticCode);
    }
  });
});
