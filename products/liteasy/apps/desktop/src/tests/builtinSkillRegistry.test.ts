import {
  getBuiltinSkillSummary,
  getVisualizationBuiltinCatalog,
  loadBuiltinSkill,
  registerBuiltinSkill
} from "../app/features/skills/builtinSkillRegistry";
import type {
  BuiltinSkillManifestV1,
  BuiltinSkillPackageV1
} from "../app/features/skills/builtinSkill.types";

const validManifest: BuiltinSkillManifestV1 = {
  costClass: "none",
  evidenceRequirements: ["source_figure"],
  fallbackModalities: [],
  id: "test-source-figure",
  integrityRules: ["source_identity_required"],
  modality: "source_figure",
  outputSchemaId: "liteasy.visualization/source-figure/v1",
  remote: false,
  rendererId: "source-figure",
  runtimeVersion: "liteasy.visualization-runtime/v1",
  styleLock: ["preserve_source_pixels"],
  validatorIds: ["evidence.claims", "source.figure.identity"],
  version: "1.0.0"
};

const validPackage: BuiltinSkillPackageV1 = {
  manifest: validManifest,
  instructions: "Return a typed source figure reference."
};

const invalidManifest: BuiltinSkillManifestV1 = {
  ...validManifest,
  validatorIds: [...validManifest.validatorIds, "validator.undeclared"]
};

const invalidPackage: BuiltinSkillPackageV1 = {
  ...validPackage,
  manifest: invalidManifest
};

test("loads only registered built-in packages", async () => {
  expect(getBuiltinSkillSummary()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "source-figure", remote: false })
  ]));
  await expect(loadBuiltinSkill("https://example.test/skill")).rejects.toThrow("builtin_skill_not_found");
});

test("loads the enabled semantic graph package", async () => {
  await expect(loadBuiltinSkill("semantic-graph")).resolves.toMatchObject({
    manifest: expect.objectContaining({
      id: "semantic-graph",
      modality: "semantic_graph",
      rendererId: "semantic-graph-svg"
    }),
    instructions: expect.stringContaining("semantic_graph")
  });
  expect(getVisualizationBuiltinCatalog().entries.filter(({ enabled, generated }) => enabled && generated).map((entry) => entry.modality))
    .toContain("semantic_graph");
});

test("loads enabled circuit and physics diagram packages", async () => {
  await expect(loadBuiltinSkill("circuit")).resolves.toMatchObject({
    manifest: expect.objectContaining({ id: "circuit", modality: "circuit", rendererId: "circuit-svg" })
  });
  await expect(loadBuiltinSkill("physics-diagram")).resolves.toMatchObject({
    manifest: expect.objectContaining({ id: "physics-diagram", modality: "physics_diagram", rendererId: "physics-diagram-svg" })
  });
  expect(getVisualizationBuiltinCatalog().entries.filter(({ enabled, generated }) => enabled && generated).map((entry) => entry.modality))
    .toEqual(expect.arrayContaining(["circuit", "physics_diagram"]));
});

test("loads the enabled biology structure package", async () => {
  await expect(loadBuiltinSkill("biology-structure")).resolves.toMatchObject({
    manifest: expect.objectContaining({
      id: "biology-structure",
      modality: "biology_structure",
      rendererId: "biology-structure-svg"
    })
  });
  expect(getVisualizationBuiltinCatalog().entries.filter(({ enabled, generated }) => enabled && generated).map((entry) => entry.modality))
    .toContain("biology_structure");
});

test("matches every enabled shared catalog entry to a local built-in package", () => {
  const summaries = getBuiltinSkillSummary();
  const catalog = getVisualizationBuiltinCatalog();
  expect(catalog.version).toBe("liteasy.visualization-builtins/v1");
  expect(catalog.entries.filter(({ enabled }) => enabled).every((entry) => (
    summaries.some((summary) => summary.id === entry.skillId && summary.modality === entry.modality)
  ))).toBe(true);
  expect(catalog.entries.filter(({ enabled, generated }) => enabled && generated).map((entry) => entry.modality).sort()).toEqual([
    "biology_structure", "circuit", "function_plot", "geometry_2d", "geometry_3d",
    "physics_diagram", "physics_process", "raster_illustration", "reaction_process", "semantic_graph"
  ]);
});

test("loads a registered package without invoking an action", async () => {
  const loader = async () => validPackage;
  registerBuiltinSkill(validManifest, loader);

  await expect(loadBuiltinSkill(validManifest.id)).resolves.toMatchObject({
    manifest: validManifest,
    instructions: expect.any(String)
  });
});

test("rejects manifests whose fallback or validator IDs are undeclared", () => {
  expect(() => registerBuiltinSkill(invalidManifest, async () => invalidPackage))
    .toThrow("builtin_skill_manifest_invalid");
});
