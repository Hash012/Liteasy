import {
  getBuiltinSkillSummary,
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
