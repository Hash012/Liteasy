import assert from "node:assert/strict";
import test from "node:test";
import { productionInteractiveMathVisualizationCompilers } from "./interactiveMathVisualizationCompilers.mjs";
import { productionProcessRasterVisualizationCompilers } from "./processRasterVisualizationCompilers.mjs";
import { productionStaticScienceVisualizationCompilers } from "./staticScienceVisualizationCompilers.mjs";
import { VisualizationArtifactCompilerRegistry, visualizationBuiltinCatalog } from "./visualizationArtifactCompiler.mjs";

const expectedGeneratedModalities = [
  "biology_structure",
  "circuit",
  "function_plot",
  "geometry_2d",
  "geometry_3d",
  "physics_diagram",
  "physics_process",
  "raster_illustration",
  "reaction_process",
  "semantic_graph"
];

const productionCompilers = {
  ...productionStaticScienceVisualizationCompilers,
  ...productionInteractiveMathVisualizationCompilers,
  ...productionProcessRasterVisualizationCompilers
};

test("server release gate publishes exactly the generated shared catalog modalities", () => {
  const catalog = visualizationBuiltinCatalog();
  assert.deepEqual(catalog.entries
    .filter((entry) => entry.enabled && entry.generated)
    .map((entry) => entry.modality)
    .sort(), expectedGeneratedModalities);
  assert.deepEqual(catalog.entries.find((entry) => entry.modality === "source_figure"), {
    enabled: true,
    generated: false,
    modality: "source_figure",
    skillId: "source-figure"
  });

  const registry = new VisualizationArtifactCompilerRegistry({ compilers: productionCompilers });
  assert.deepEqual(registry.availableModalities().sort(), expectedGeneratedModalities);
});

test("server compiler descriptors match every enabled generated catalog entry", () => {
  const catalog = visualizationBuiltinCatalog();
  for (const entry of catalog.entries.filter((item) => item.enabled && item.generated)) {
    const compiler = productionCompilers[entry.modality];
    assert.equal(compiler.modality, entry.modality);
    assert.equal(compiler.implementation.skillId, entry.skillId);
    assert.equal(compiler.implementation.skillVersion, "1.0.0");
    assert.equal(compiler.implementation.rendererVersion, "1.0.0");
    assert.ok(compiler.hardValidators.length > 0);
    assert.ok(compiler.proposalSchema);
  }
});

test("server fails closed when any enabled generated modality lacks a compiler", () => {
  const { semantic_graph: _missing, ...missingSemanticGraph } = productionCompilers;

  assert.throws(
    () => new VisualizationArtifactCompilerRegistry({ compilers: missingSemanticGraph }),
    /visualization_compiler_invalid/
  );
});
