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

export const generatedBenchmarkedVisualizationModalities = benchmarkedVisualizationModalities
  .filter((modality) => modality !== "source_figure");

export const visualizationBenchmarkThresholds = Object.freeze({
  deterministicReplay: 1,
  evidenceBinding: 1,
  firstRenderP95Ms: 1500
});

function percentile95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

export function evaluateVisualizationBenchmark(measurement) {
  const results = Array.isArray(measurement?.results) ? measurement.results : [];
  const resultByModality = new Map(results.map((result) => [result.modality, result]));
  const missingModalities = generatedBenchmarkedVisualizationModalities
    .filter((modality) => !resultByModality.has(modality));
  const unexpectedModalities = results
    .map((result) => result.modality)
    .filter((modality) => !generatedBenchmarkedVisualizationModalities.includes(modality));
  const firstRenderSamples = results.flatMap((result) => Array.isArray(result.renderSamplesMs) ? result.renderSamplesMs.slice(0, 1) : []);
  const deterministicResults = results.filter((result) => {
    const digests = Array.isArray(result.outputDigests) ? result.outputDigests : [];
    return digests.length > 0 && new Set(digests).size === 1;
  }).length;
  const factualObjectCount = results.reduce((sum, result) => sum + Number(result.factualObjectCount ?? 0), 0);
  const evidenceBoundObjectCount = results.reduce((sum, result) => sum + Number(result.evidenceBoundObjectCount ?? 0), 0);
  const deterministicReplay = results.length === 0 ? 0 : deterministicResults / results.length;
  const evidenceBinding = factualObjectCount === 0 ? 0 : evidenceBoundObjectCount / factualObjectCount;
  const firstRenderP95Ms = percentile95(firstRenderSamples);
  const rendererFailures = results
    .filter((result) => result.hardGate !== "pass")
    .map((result) => result.modality);
  const build = measurement?.build ?? { diagnostics: ["visualization_build_unmeasured"], inspected: false, threeInitialChunk: null };
  const diagnostics = [
    ...(Array.isArray(measurement?.diagnostics) ? measurement.diagnostics : []),
    ...(Array.isArray(build.diagnostics) ? build.diagnostics : [])
  ];
  if (missingModalities.length > 0) diagnostics.push(`visualization_modalities_missing:${missingModalities.join(",")}`);
  if (unexpectedModalities.length > 0) diagnostics.push(`visualization_modalities_unexpected:${unexpectedModalities.join(",")}`);
  if (rendererFailures.length > 0) diagnostics.push(`visualization_renderer_gate_failed:${rendererFailures.join(",")}`);
  if (deterministicReplay < visualizationBenchmarkThresholds.deterministicReplay) diagnostics.push("visualization_replay_nondeterministic");
  if (evidenceBinding < visualizationBenchmarkThresholds.evidenceBinding) diagnostics.push("visualization_evidence_binding_incomplete");
  if (firstRenderP95Ms === null) diagnostics.push("visualization_render_latency_unmeasured");
  else if (firstRenderP95Ms > visualizationBenchmarkThresholds.firstRenderP95Ms) diagnostics.push("visualization_render_latency_exceeded");
  if (build.threeInitialChunk === true) diagnostics.push("visualization_three_initial_chunk_detected");

  const hardGate = diagnostics.length === 0 &&
    missingModalities.length === 0 &&
    unexpectedModalities.length === 0 &&
    rendererFailures.length === 0 &&
    deterministicReplay === visualizationBenchmarkThresholds.deterministicReplay &&
    evidenceBinding === visualizationBenchmarkThresholds.evidenceBinding &&
    firstRenderP95Ms !== null &&
    firstRenderP95Ms <= visualizationBenchmarkThresholds.firstRenderP95Ms &&
    build.inspected === true &&
    build.threeInitialChunk === false
    ? "pass"
    : "fail";

  return {
    build,
    deterministicReplay,
    diagnostics: [...new Set(diagnostics)],
    evidenceBinding,
    excludedModalities: [{ modality: "source_figure", reason: "source_projection_uses_reader_pipeline" }],
    firstRenderSamplesMs: firstRenderSamples,
    firstRenderP95Ms,
    hardGate,
    measurementKind: "local_fixture_renderer_projection",
    modalities: results.map((result) => result.modality),
    results,
    threeInitialChunk: build.threeInitialChunk
  };
}
