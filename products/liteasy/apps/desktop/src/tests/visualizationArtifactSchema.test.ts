import { describe, expect, test } from "vitest";
import { parseVisualizationArtifact } from "../app/features/visualization/visualizationArtifact.schema";
import { makeVisualizationArtifactFixture } from "./fixtures/visualizationArtifactFixtures";

describe("visualization artifact schema", () => {
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
