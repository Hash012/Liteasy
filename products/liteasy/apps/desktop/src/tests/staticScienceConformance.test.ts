import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { validateBiologyStructure } from "../app/features/visualization/kernels/biologyStructureKernel";
import { validateCircuit } from "../app/features/visualization/kernels/circuitKernel";
import { validatePhysicsDiagram } from "../app/features/visualization/kernels/physicsDiagramKernel";
import { validateSemanticGraph } from "../app/features/visualization/kernels/semanticGraphKernel";
import type { VisualizationModality, VisualizationSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

const fixture = JSON.parse(readFileSync(resolve(
  process.cwd(),
  "../../../../development/test-data/thin-reading-multimodal/static-science-conformance.v1.json"
), "utf8"));

const validators = {
  biology_structure: (spec: VisualizationSpecV1) => validateBiologyStructure(spec.payload as never),
  circuit: (spec: VisualizationSpecV1) => validateCircuit(spec.payload as never),
  physics_diagram: (spec: VisualizationSpecV1) => validatePhysicsDiagram(spec.payload as never),
  semantic_graph: (spec: VisualizationSpecV1) => validateSemanticGraph(spec.payload as never)
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

describe("static science cross-runtime conformance", () => {
  test("accepts every valid static science fixture", () => {
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
