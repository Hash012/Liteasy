import { describe, expect, test } from "vitest";
import { getBuiltinSkillSummary, getVisualizationBuiltinCatalog } from "../app/features/skills/builtinSkillRegistry";
import {
  getAvailableVisualizationModalities,
  getUnavailableVisualizationModalityReasons,
  loadVisualizationRenderer
} from "../app/features/visualization/visualizationRendererRegistry";

const mathModalities = ["function_plot", "geometry_2d", "geometry_3d"] as const;

function catalogWithMath(enabled: boolean) {
  const catalog = getVisualizationBuiltinCatalog();
  return {
    ...catalog,
    entries: catalog.entries.map((entry) => (
      mathModalities.includes(entry.modality as never) ? { ...entry, enabled } : entry
    ))
  };
}

describe("interactive math release gate", () => {
  test("does not advertise locally complete math modalities while catalog entries are disabled", () => {
    const disabledCatalog = catalogWithMath(false);

    expect(getAvailableVisualizationModalities(disabledCatalog)).not.toContain("function_plot");
    expect(getUnavailableVisualizationModalityReasons(disabledCatalog).function_plot).toBe("catalog_disabled");
  });

  test("publishes interactive math after its runtime, visual, provider, and decision gates pass", () => {
    expect(getAvailableVisualizationModalities()).toEqual(expect.arrayContaining([...mathModalities]));
    for (const modality of mathModalities) {
      expect(getUnavailableVisualizationModalityReasons()).not.toHaveProperty(modality);
    }
  });

  test.each(mathModalities)("loads the published %s renderer implementation", async (modality) => {
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
