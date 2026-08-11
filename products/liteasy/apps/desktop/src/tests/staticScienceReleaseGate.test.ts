import { describe, expect, test } from "vitest";
import { getBuiltinSkillSummary, getVisualizationBuiltinCatalog } from "../app/features/skills/builtinSkillRegistry";
import {
  getAvailableVisualizationModalities,
  getUnavailableVisualizationModalityReasons,
  loadVisualizationRenderer
} from "../app/features/visualization/visualizationRendererRegistry";

const staticModalities = ["biology_structure", "circuit", "physics_diagram", "semantic_graph"] as const;

function catalogWithStatic(enabled: boolean) {
  const catalog = getVisualizationBuiltinCatalog();
  return {
    ...catalog,
    entries: catalog.entries.map((entry) => (
      staticModalities.includes(entry.modality as never) ? { ...entry, enabled } : entry
    ))
  };
}

describe("static science release gate", () => {
  test("does not advertise locally complete generated modalities while catalog entries are disabled", () => {
    const disabledCatalog = catalogWithStatic(false);

    expect(getAvailableVisualizationModalities(disabledCatalog)).not.toContain("semantic_graph");
    expect(getUnavailableVisualizationModalityReasons(disabledCatalog).semantic_graph).toBe("catalog_disabled");
  });

  test("advertises every enabled static modality only with its complete local chain", async () => {
    expect(getAvailableVisualizationModalities()).toEqual(expect.arrayContaining([...staticModalities]));
    for (const modality of staticModalities) {
      expect(getUnavailableVisualizationModalityReasons()).not.toHaveProperty(modality);
    }
    const summaries = getBuiltinSkillSummary();
    for (const modality of staticModalities) {
      const skill = summaries.find((item) => item.modality === modality);
      expect(skill).toBeTruthy();
      await expect(loadVisualizationRenderer(skill!.rendererId)).resolves.toMatchObject({
        id: skill!.rendererId,
        modality,
        version: "1.0.0"
      });
    }
  });
});
