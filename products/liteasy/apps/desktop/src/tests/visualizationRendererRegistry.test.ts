import { expect, test, vi } from "vitest";
import { registerBuiltinSkill } from "../app/features/skills/builtinSkillRegistry";
import {
  getAvailableVisualizationModalities,
  loadVisualizationRenderer,
  registerVisualizationRenderer
} from "../app/features/visualization/visualizationRendererRegistry";
import type { VisualizationRenderer } from "../app/features/visualization/visualizationRendererRegistry";

const renderer: VisualizationRenderer = {
  id: "source-figure",
  modality: "source_figure",
  render: () => undefined,
  version: "1"
};

test("does not load renderer chunks while enumerating capabilities", async () => {
  const load = vi.fn(async () => renderer);
  registerVisualizationRenderer({ id: "source-figure", load, modality: "source_figure", version: "1" });
  expect(getAvailableVisualizationModalities()).toContain("source_figure");
  expect(load).not.toHaveBeenCalled();
  await loadVisualizationRenderer("source-figure");
  expect(load).toHaveBeenCalledOnce();
});

test("excludes a skill when its validator or renderer chain is incomplete", () => {
  registerBuiltinSkill({
    costClass: "none",
    evidenceRequirements: [],
    fallbackModalities: [],
    id: "test-incomplete-renderer-chain",
    integrityRules: [],
    modality: "semantic_graph",
    outputSchemaId: "test",
    remote: false,
    rendererId: "missing-renderer",
    runtimeVersion: "liteasy.visualization-runtime/v1",
    styleLock: [],
    validatorIds: ["artifact-schema"],
    version: "1"
  }, async () => ({
    instructions: "test",
    manifest: {
      costClass: "none",
      evidenceRequirements: [],
      fallbackModalities: [],
      id: "test-incomplete-renderer-chain",
      integrityRules: [],
      modality: "semantic_graph",
      outputSchemaId: "test",
      remote: false,
      rendererId: "missing-renderer",
      runtimeVersion: "liteasy.visualization-runtime/v1",
      styleLock: [],
      validatorIds: ["artifact-schema"],
      version: "1"
    }
  }));

  expect(getAvailableVisualizationModalities()).not.toContain("semantic_graph");
});

test("retries a renderer load after a transient failure", async () => {
  const retryRenderer: VisualizationRenderer = {
    id: "test-retry-renderer",
    modality: "semantic_graph",
    version: "1"
  };
  const load = vi.fn()
    .mockRejectedValueOnce(new Error("transient"))
    .mockResolvedValueOnce(retryRenderer);
  registerVisualizationRenderer({
    id: "test-retry-renderer",
    load,
    modality: "semantic_graph",
    version: "1"
  });

  await expect(loadVisualizationRenderer("test-retry-renderer")).rejects.toThrow("transient");
  await expect(loadVisualizationRenderer("test-retry-renderer")).resolves.toBe(retryRenderer);
  expect(load).toHaveBeenCalledTimes(2);
});
