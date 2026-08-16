import { describe, expect, test } from "vitest";
import { getBuiltinSkillSummary, getVisualizationBuiltinCatalog } from "../app/features/skills/builtinSkillRegistry";
import {
  getAvailableVisualizationModalities,
  getUnavailableVisualizationModalityReasons,
  loadVisualizationRenderer
} from "../app/features/visualization/visualizationRendererRegistry";

const processModalities = ["physics_process", "raster_illustration", "reaction_process"] as const;

function catalogWithProcess(enabled: boolean) {
  const catalog = getVisualizationBuiltinCatalog();
  return {
    ...catalog,
    entries: catalog.entries.map((entry) => (
      processModalities.includes(entry.modality as never) ? { ...entry, enabled } : entry
    ))
  };
}

describe("process/raster release gate", () => {
  test("does not advertise locally complete process/raster modalities while catalog entries are disabled", () => {
    const disabledCatalog = catalogWithProcess(false);

    expect(getAvailableVisualizationModalities(disabledCatalog)).not.toContain("physics_process");
    expect(getUnavailableVisualizationModalityReasons(disabledCatalog).physics_process).toBe("catalog_disabled");
  });

  test("publishes process/raster modalities after their end-to-end release gates pass", () => {
    expect(getAvailableVisualizationModalities()).toEqual(expect.arrayContaining([...processModalities]));
    for (const modality of processModalities) {
      expect(getUnavailableVisualizationModalityReasons()).not.toHaveProperty(modality);
    }
  });

  test.each(processModalities)("loads the published %s renderer implementation", async (modality) => {
    const summaries = getBuiltinSkillSummary();
    const skill = summaries.find((item) => item.modality === modality);
    expect(skill).toBeTruthy();
    await expect(loadVisualizationRenderer(skill!.rendererId)).resolves.toMatchObject({
      id: skill!.rendererId,
      modality,
      version: "1.0.0"
    });
  }, 120_000);
});
