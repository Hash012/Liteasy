import { describe, expect, test } from "vitest";
import { runVisualizationBenchmark } from "../../scripts/benchmark-visualization.mjs";

type VisualizationBenchmarkReport = {
  deterministicReplay: number;
  evidenceBinding: number;
  firstRenderP95Ms: number;
  hardGate: "pass" | "fail";
  modalities: string[];
  threeInitialChunk: boolean;
};

describe("visualization performance gate", () => {
  test("keeps multimodal render benchmark within release thresholds", async () => {
    const report = runVisualizationBenchmark() as VisualizationBenchmarkReport;

    expect(report.hardGate).toBe("pass");
    expect(report.evidenceBinding).toBe(1);
    expect(report.deterministicReplay).toBe(1);
    expect(report.firstRenderP95Ms).toBeLessThanOrEqual(1500);
    expect(report.threeInitialChunk).toBe(false);
    expect(report.modalities).toEqual(expect.arrayContaining([
      "semantic_graph",
      "function_plot",
      "geometry_3d",
      "physics_process",
      "reaction_process",
      "raster_illustration"
    ]));
  });
});
