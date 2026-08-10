import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { productionStaticScienceVisualizationCompilers } from "./staticScienceVisualizationCompilers.mjs";
import { VisualizationArtifactCompilerRegistry, visualizationBuiltinCatalog } from "./visualizationArtifactCompiler.mjs";

const staticModalities = ["biology_structure", "circuit", "physics_diagram", "semantic_graph"];
const catalog = visualizationBuiltinCatalog();
const skillByModality = Object.fromEntries(catalog.entries.map((entry) => [entry.modality, entry.skillId]));
const expectedSkillIds = {
  biology_structure: "biology-structure",
  circuit: "circuit",
  physics_diagram: "physics-diagram",
  semantic_graph: "semantic-graph"
};

test("shared catalog enables exactly the verified static generated modalities", () => {
  const enabledGenerated = catalog.entries
    .filter((entry) => entry.enabled && entry.generated)
    .map((entry) => entry.modality)
    .sort();
  assert.deepEqual(enabledGenerated, staticModalities);
});

test("every enabled static catalog entry has a matching server compiler descriptor", () => {
  for (const modality of staticModalities) {
    const compiler = productionStaticScienceVisualizationCompilers[modality];
    assert.equal(skillByModality[modality], expectedSkillIds[modality]);
    assert.equal(compiler.implementation.skillId, expectedSkillIds[modality]);
    assert.equal(compiler.modality, modality);
    assert.ok(compiler.proposalSchema);
    assert.ok(compiler.hardValidators.length > 0);
  }
});

test("server advertises only catalog-enabled generated modalities", () => {
  const registry = new VisualizationArtifactCompilerRegistry({
    compilers: productionStaticScienceVisualizationCompilers
  });
  assert.deepEqual(registry.availableModalities().sort(), staticModalities);
});

test("shared catalog remains valid JSON", () => {
  const raw = readFileSync(new URL("../../../packages/shared/visualizationBuiltins.v1.json", import.meta.url), "utf8");
  assert.equal(JSON.parse(raw).version, "liteasy.visualization-builtins/v1");
});
