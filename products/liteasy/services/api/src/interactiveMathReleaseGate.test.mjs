import assert from "node:assert/strict";
import test from "node:test";
import { productionStaticScienceVisualizationCompilers } from "./staticScienceVisualizationCompilers.mjs";
import { productionInteractiveMathVisualizationCompilers } from "./interactiveMathVisualizationCompilers.mjs";
import { productionProcessRasterVisualizationCompilers } from "./processRasterVisualizationCompilers.mjs";
import { VisualizationArtifactCompilerRegistry, visualizationBuiltinCatalog } from "./visualizationArtifactCompiler.mjs";

const mathModalities = ["function_plot", "geometry_2d", "geometry_3d"];
const catalog = visualizationBuiltinCatalog();
const skillByModality = Object.fromEntries(catalog.entries.map((entry) => [entry.modality, entry.skillId]));
const expectedSkillIds = {
  function_plot: "function-plot",
  geometry_2d: "geometry-2d",
  geometry_3d: "geometry-3d"
};

test("shared catalog enables exactly the verified interactive math generated modalities", () => {
  const enabledMath = catalog.entries
    .filter((entry) => entry.enabled && mathModalities.includes(entry.modality))
    .map((entry) => entry.modality)
    .sort();
  assert.deepEqual(enabledMath, mathModalities);
});

test("every interactive math modality has a matching server compiler descriptor", () => {
  for (const modality of mathModalities) {
    const compiler = productionInteractiveMathVisualizationCompilers[modality];
    assert.equal(skillByModality[modality], expectedSkillIds[modality]);
    assert.equal(compiler.implementation.skillId, expectedSkillIds[modality]);
    assert.equal(compiler.modality, modality);
    assert.ok(compiler.proposalSchema);
    assert.ok(compiler.hardValidators.length > 0);
  }
});

test("server advertises catalog-enabled static and math generated modalities", () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    compilers: {
      ...productionStaticScienceVisualizationCompilers,
      ...productionInteractiveMathVisualizationCompilers,
      ...productionProcessRasterVisualizationCompilers
    }
  });
  assert.deepEqual(registry.availableModalities().filter((modality) => mathModalities.includes(modality)).sort(), mathModalities);
});
