import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { simulatePhysicsProcess } from "../app/features/visualization/kernels/physicsProcessKernel";
import { validateReactionProcess } from "../app/features/visualization/kernels/reactionProcessKernel";
import { renderRasterIllustration } from "../app/features/visualization/renderers/rasterIllustrationRenderer";
import type { VisualizationModality, VisualizationSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

const fixture = JSON.parse(readFileSync(resolve(
  process.cwd(),
  "../../../../development/test-data/thin-reading-multimodal/process-raster-conformance.v1.json"
), "utf8"));

const validators = {
  physics_process: (spec: VisualizationSpecV1) => simulatePhysicsProcess(spec.payload as never),
  raster_illustration: (spec: VisualizationSpecV1) => renderRasterIllustration(spec.payload as never),
  reaction_process: (spec: VisualizationSpecV1) => validateReactionProcess(spec.payload as never)
} satisfies Record<string, (spec: VisualizationSpecV1) => unknown>;

function publishedSpec(modality: VisualizationModality): VisualizationSpecV1 {
  const spec = fixture.modalities[modality].valid.spec as VisualizationSpecV1;
  if (spec.modality !== "raster_illustration") return spec;
  const sha256 = "a".repeat(64);
  return {
    ...spec,
    payload: {
      ...spec.payload,
      asset: {
        assetRef: `raster:${sha256}`,
        byteLength: 1024,
        height: spec.payload.composition.height,
        labelVerification: {
          engine: "fixture-ocr/v1",
          verifiedLabelIds: spec.payload.labels.map((label) => label.id)
        },
        mimeType: "image/png",
        sha256,
        width: spec.payload.composition.width
      }
    }
  };
}

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

describe("process/raster cross-runtime conformance", () => {
  test("accepts every valid process/raster fixture", () => {
    for (const modality of Object.keys(validators) as VisualizationModality[]) {
      expect(() => validators[modality](publishedSpec(modality))).not.toThrow();
    }
  });

  test("rejects a generation-stage raster proposal before the server binds its asset", () => {
    expect(() => validators.raster_illustration(
      fixture.modalities.raster_illustration.valid.spec
    )).toThrow("raster_asset_metadata_invalid");
  });

  test("rejects domain-invalid fixtures with the shared diagnostic code", () => {
    for (const modality of Object.keys(validators) as VisualizationModality[]) {
      const invalid = fixture.modalities[modality].invalid.domain;
      const proposal = mergePatch(fixture.modalities[modality].valid, invalid.patch) as { spec: VisualizationSpecV1 };
      expect(() => validators[modality](proposal.spec)).toThrow(invalid.diagnosticCode);
    }
  });
});
