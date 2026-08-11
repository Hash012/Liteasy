import assert from "node:assert/strict";
import test from "node:test";
import { productionInteractiveMathVisualizationCompilers } from "./interactiveMathVisualizationCompilers.mjs";
import { productionProcessRasterVisualizationCompilers } from "./processRasterVisualizationCompilers.mjs";
import { productionStaticScienceVisualizationCompilers } from "./staticScienceVisualizationCompilers.mjs";
import { VisualizationArtifactCompilerRegistry, visualizationBuiltinCatalog } from "./visualizationArtifactCompiler.mjs";

const processModalities = ["physics_process", "raster_illustration", "reaction_process"];
const expectedSkillIds = {
  physics_process: "physics-process",
  raster_illustration: "raster-illustration",
  reaction_process: "reaction-process"
};

test("shared catalog publishes process/raster modalities after end-to-end gates pass", () => {
  const catalog = visualizationBuiltinCatalog();
  assert.deepEqual(catalog.entries
    .filter((entry) => entry.enabled && processModalities.includes(entry.modality))
    .map((entry) => entry.modality)
    .sort(), [...processModalities].sort());
});

test("server advertises published process/raster modalities", () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    compilers: {
      ...productionStaticScienceVisualizationCompilers,
      ...productionInteractiveMathVisualizationCompilers,
      ...productionProcessRasterVisualizationCompilers
    }
  });
  assert.deepEqual(registry.availableModalities().filter((modality) => processModalities.includes(modality)).sort(), [...processModalities].sort());
  for (const modality of processModalities) {
    assert.equal(productionProcessRasterVisualizationCompilers[modality].implementation.skillId, expectedSkillIds[modality]);
  }
});
