import { describe, expect, test } from "vitest";
import { getBuiltinSkillSummary, getVisualizationBuiltinCatalog, loadBuiltinSkill } from "../app/features/skills/builtinSkillRegistry";
import {
  getAvailableVisualizationModalities,
  getUnavailableVisualizationModalityReasons,
  loadVisualizationRenderer
} from "../app/features/visualization/visualizationRendererRegistry";
import { validatorsExist } from "../app/features/visualization/visualizationValidatorRegistry";

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

describe("multimodal release gate", () => {
  test("publishes exactly the generated modalities in the shared catalog", () => {
    const catalog = getVisualizationBuiltinCatalog();
    const enabledGenerated = catalog.entries
      .filter((entry) => entry.enabled && entry.generated)
      .map((entry) => entry.modality)
      .sort();

    expect(enabledGenerated).toEqual(expectedGeneratedModalities);
    expect(catalog.entries.find((entry) => entry.modality === "source_figure")).toMatchObject({
      enabled: true,
      generated: false
    });
    expect(getAvailableVisualizationModalities().sort()).toEqual(expectedGeneratedModalities);
    const unavailableReasons = getUnavailableVisualizationModalityReasons();
    for (const modality of expectedGeneratedModalities) {
      expect(unavailableReasons).not.toHaveProperty(modality);
    }
  });

  test("requires every generated catalog entry to have a complete local skill, validator, and renderer chain", async () => {
    const catalog = getVisualizationBuiltinCatalog();
    const summaries = getBuiltinSkillSummary();

    for (const entry of catalog.entries.filter((item) => item.enabled && item.generated)) {
      const skill = summaries.find((item) => item.id === entry.skillId && item.modality === entry.modality);
      expect(skill).toBeTruthy();
      expect(validatorsExist(skill!.validatorIds)).toBe(true);

      const loadedSkill = await loadBuiltinSkill(entry.skillId);
      expect(loadedSkill.manifest).toMatchObject({
        id: entry.skillId,
        modality: entry.modality,
        rendererId: skill!.rendererId,
        version: skill!.version
      });
      expect(loadedSkill.fallbackModalities?.length).toBeGreaterThan(0);
      for (const fallback of loadedSkill.fallbackModalities ?? []) {
        expect(catalog.entries.some((candidate) => candidate.enabled && candidate.modality === fallback)).toBe(true);
      }

      await expect(loadVisualizationRenderer(skill!.rendererId)).resolves.toMatchObject({
        id: skill!.rendererId,
        modality: entry.modality,
        version: skill!.version
      });
    }
  }, 120_000);

  test("fails closed when a generated catalog modality is disabled at release time", () => {
    const catalog = getVisualizationBuiltinCatalog();
    const disabledCatalog = {
      ...catalog,
      entries: catalog.entries.map((entry) => entry.modality === "semantic_graph" ? { ...entry, enabled: false } : entry)
    };

    expect(getAvailableVisualizationModalities(disabledCatalog)).not.toContain("semantic_graph");
    expect(getUnavailableVisualizationModalityReasons(disabledCatalog).semantic_graph).toBe("catalog_disabled");
  });
});
