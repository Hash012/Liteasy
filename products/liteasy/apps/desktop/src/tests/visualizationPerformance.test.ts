import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  evaluateVisualizationBenchmark,
  generatedBenchmarkedVisualizationModalities
} from "../../scripts/benchmark-visualization.mjs";
import { runVisualizationBenchmark } from "../../scripts/benchmark-visualization-runtime";

type VisualizationBenchmarkReport = {
  deterministicReplay: number;
  diagnostics: string[];
  evidenceBinding: number;
  firstRenderP95Ms: number | null;
  hardGate: "pass" | "fail";
  modalities: string[];
  threeInitialChunk: boolean | null;
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function buildFixture({ threeInEntry = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "liteasy-visualization-benchmark-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "index.html"), '<script type="module" src="/assets/index.js"></script>');
  writeFileSync(join(directory, "assets/index.js"), threeInEntry ? "const WebGLRenderer = 1; const Matrix4 = 1;" : "const initial = true;");
  if (!threeInEntry) writeFileSync(join(directory, "assets/geometry3d.js"), "const WebGLRenderer = 1; const Matrix4 = 1;");
  return directory;
}

describe("visualization performance gate", () => {
  test("measures real conformance renderer output instead of returning fixed metrics", () => {
    const report = runVisualizationBenchmark({
      distDirectory: buildFixture(),
      iterations: 2
    }) as VisualizationBenchmarkReport;

    expect(report.hardGate).toBe("pass");
    expect(report.evidenceBinding).toBe(1);
    expect(report.deterministicReplay).toBe(1);
    expect(report.firstRenderP95Ms).not.toBeNull();
    expect(report.firstRenderP95Ms!).toBeLessThanOrEqual(1500);
    expect(report.threeInitialChunk).toBe(false);
    expect(report.modalities).toEqual(generatedBenchmarkedVisualizationModalities);
  });

  test("fails closed when measured replay, evidence, latency, or build isolation regresses", () => {
    const results = generatedBenchmarkedVisualizationModalities.map((modality, index) => ({
      evidenceBoundObjectCount: index === 0 ? 0 : 1,
      factualObjectCount: 1,
      hardGate: "pass",
      modality,
      outputDigests: index === 1 ? ["digest-a", "digest-b"] : ["digest-a", "digest-a"],
      renderSamplesMs: index === 2 ? [1600] : [10]
    }));
    const report = evaluateVisualizationBenchmark({
      build: { diagnostics: [], inspected: true, threeInitialChunk: true },
      diagnostics: [],
      results
    }) as VisualizationBenchmarkReport;

    expect(report.hardGate).toBe("fail");
    expect(report.evidenceBinding).toBeLessThan(1);
    expect(report.deterministicReplay).toBeLessThan(1);
    expect(report.firstRenderP95Ms).toBe(1600);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      "visualization_evidence_binding_incomplete",
      "visualization_replay_nondeterministic",
      "visualization_render_latency_exceeded",
      "visualization_three_initial_chunk_detected"
    ]));
  });

  test("detects Three.js code in the initial production entry", () => {
    const report = runVisualizationBenchmark({
      distDirectory: buildFixture({ threeInEntry: true }),
      iterations: 2
    }) as VisualizationBenchmarkReport;

    expect(report.hardGate).toBe("fail");
    expect(report.threeInitialChunk).toBe(true);
    expect(report.diagnostics).toContain("visualization_three_initial_chunk_detected");
  });
});
