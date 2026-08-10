import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createVisualizationArtifactJsonSchema,
  parseVisualizationArtifact,
} from "../app/features/visualization/visualizationArtifact.schema";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";

describe("visualization artifact schema", () => {
  test("matches the committed cross-runtime JSON schema byte for byte", async () => {
    const committed = await readFile(resolve(
      process.cwd(),
      "../../packages/shared/visualizationArtifact.v1.schema.json"
    ), "utf8");
    const generated = `${JSON.stringify(createVisualizationArtifactJsonSchema(), null, 2)}\n`;
    expect(generated).toBe(committed);
  });

  test("rejects a modality/spec mismatch and executable fields", () => {
    expect(() => parseVisualizationArtifact({
      artifactId: "viz-1",
      artifactVersion: "liteasy.visualization/v1",
      modality: "function_plot",
      nodeId: "node-1",
      locale: "zh-CN",
      spec: {
        modality: "semantic_graph",
        payload: { edges: [], nodes: [], subtype: "flowchart" }
      },
      script: "alert(1)"
    })).toThrow("visualization_artifact_invalid");
  });

  test("accepts a complete evidence-bound semantic graph artifact", () => {
    expect(parseVisualizationArtifact(makeVisualizationArtifactFixture({ modality: "semantic_graph" })).modality)
      .toBe("semantic_graph");
  });

  test("rejects a hard validation failure", () => {
    expect(() => parseVisualizationArtifact(makeVisualizationArtifactFixture({
      validation: { outcome: "fail" }
    }))).toThrow("visualization_artifact_invalid");
  });

  test("rejects a hard warning because hard gates must pass", () => {
    const artifact = makeVisualizationArtifactFixture();
    artifact.validation = {
      outcome: "degraded",
      checks: [{
        gate: "hard",
        validatorId: "artifact-schema",
        validatorVersion: "1.0.0",
        outcome: "warning"
      }],
      repairCount: 0
    };
    expect(() => parseVisualizationArtifact(artifact)).toThrow("visualization_artifact_invalid");
  });

  test("accepts an advisory failure while preserving a degraded artifact", () => {
    const artifact = makeVisualizationArtifactFixture();
    artifact.validation = {
      outcome: "degraded",
      checks: [{
        gate: "advisory",
        validatorId: "artifact-schema",
        validatorVersion: "1.0.0",
        outcome: "fail"
      }, {
        gate: "hard",
        validatorId: "artifact-schema",
        validatorVersion: "1.0.0",
        outcome: "pass"
      }],
      repairCount: 0
    };
    expect(parseVisualizationArtifact(artifact).validation.outcome).toBe("degraded");
  });

  test("rejects an artifact without a hard validation check", () => {
    const artifact = makeVisualizationArtifactFixture();
    artifact.validation = { outcome: "pass", checks: [], repairCount: 0 };
    expect(() => parseVisualizationArtifact(artifact)).toThrow("visualization_artifact_invalid");
  });

  test("accepts the bounded fixture for each declared modality", () => {
    const modalities = [
      "semantic_graph", "circuit", "physics_diagram", "biology_structure", "geometry_2d",
      "function_plot", "geometry_3d", "physics_process", "reaction_process", "raster_illustration", "source_figure"
    ] as const;
    for (const modality of modalities) {
      expect(parseVisualizationArtifact(makeVisualizationArtifactFixture({ modality })).modality).toBe(modality);
    }
  });
});
