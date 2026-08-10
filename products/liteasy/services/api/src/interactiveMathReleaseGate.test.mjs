import assert from "node:assert/strict";
import test from "node:test";
import { productionInteractiveMathVisualizationCompilers } from "./interactiveMathVisualizationCompilers.mjs";

const mathModalities = ["function_plot", "geometry_2d", "geometry_3d"];
const expectedSkillIds = {
  function_plot: "function-plot",
  geometry_2d: "geometry-2d",
  geometry_3d: "geometry-3d"
};

test("every interactive math modality has a matching server compiler descriptor", () => {
  for (const modality of mathModalities) {
    const compiler = productionInteractiveMathVisualizationCompilers[modality];
    assert.equal(compiler.implementation.skillId, expectedSkillIds[modality]);
    assert.equal(compiler.modality, modality);
    assert.ok(compiler.proposalSchema);
    assert.ok(compiler.hardValidators.length > 0);
  }
});
