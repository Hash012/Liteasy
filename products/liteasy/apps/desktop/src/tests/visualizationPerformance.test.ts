import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

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
    const { stdout } = await execFileAsync(
      process.execPath,
      ["scripts/benchmark-visualization.mjs", "--fixtures", "src/tests/fixtures"],
      { cwd: process.cwd() }
    );
    const report = JSON.parse(stdout) as VisualizationBenchmarkReport;

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
