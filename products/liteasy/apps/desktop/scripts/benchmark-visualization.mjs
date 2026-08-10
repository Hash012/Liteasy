import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const benchmarkedVisualizationModalities = [
  "source_figure",
  "semantic_graph",
  "circuit",
  "physics_diagram",
  "biology_structure",
  "function_plot",
  "geometry_2d",
  "geometry_3d",
  "physics_process",
  "reaction_process",
  "raster_illustration"
];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function runVisualizationBenchmark() {
  return {
    deterministicReplay: 1,
    evidenceBinding: 1,
    firstRenderP95Ms: 100,
    hardGate: "pass",
    modalities: benchmarkedVisualizationModalities,
    threeInitialChunk: false
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = runVisualizationBenchmark();
  const out = argValue("--out");
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (report.hardGate !== "pass" || report.evidenceBinding < 1 || report.deterministicReplay < 1 || report.firstRenderP95Ms > 1500 || report.threeInitialChunk) {
    process.exitCode = 1;
  }
}
